import { sb, isolatedClient, watch } from '../db.js';
import { getState } from '../auth.js';
import { toLoginEmail, validLoginId } from '../config.js';
import { esc, badge, fmtDate, openForm, toast, confirmTwoStep } from '../ui.js';

const ROLES = [
  { value: 'admin', label: 'Admin (no location)' },
  { value: 'stores_head', label: 'Stores Head' },
  { value: 'workshop_head', label: 'Workshop Head' },
  { value: 'staff', label: 'Staff' },
];
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label.replace(' (no location)', '') || r;

export async function render(root) {
  root.innerHTML = `<div class="head"><h2>Users &amp; Access</h2><button class="btn" id="add">+ Add user</button></div>
    <p class="muted">Every login is bound to one location and one role. Deactivating a user logs them out instantly.</p>
    <div class="tablewrap"><table id="t"></table></div>`;
  let users = [], locs = [], emps = [];

  async function load() {
    const [u, l, e, s] = await Promise.all([
      sb.from('profiles').select('*, locations(code,name)').order('full_name'),
      sb.from('locations').select('id,code,name,type').eq('is_active', true).order('code'),
      sb.from('employees').select('emp_id,name').eq('is_active', true).order('name'),
      sb.from('user_sessions').select('user_id,last_seen').eq('status', 'active'),
    ]);
    if (u.error) return toast(u.error.message, 'error');
    users = u.data; locs = l.data || []; emps = e.data || [];
    const online = {};
    (s.data || []).forEach((x) => { online[x.user_id] = x.last_seen; });
    root.querySelector('#t').innerHTML =
      '<tr><th>Name</th><th>User ID</th><th>Emp ID</th><th>Role</th><th>Location</th><th>Account</th><th>Session</th><th></th></tr>' +
      users.map((p) => `<tr>
        <td>${esc(p.full_name)}</td><td><b>${esc(p.login_id || '—')}</b></td><td>${esc(p.emp_id || '—')}</td>
        <td>${esc(roleLabel(p.role))}</td><td>${esc(p.locations ? `${p.locations.code} · ${p.locations.name}` : '—')}</td>
        <td>${badge(p.is_active ? 'Active' : 'Inactive', p.is_active ? 'active' : 'inactive')}</td>
        <td>${online[p.id] ? badge('Online', 'online') + ' <small class="muted">' + fmtDate(online[p.id]) + '</small>' : '<span class="muted">Offline</span>'}</td>
        <td class="acts"><button class="link" data-edit="${p.id}">Edit</button>
          <button class="link" data-tog="${p.id}">${p.is_active ? 'Deactivate' : 'Activate'}</button>
          <button class="link" data-pw="${p.id}">Reset password</button>
          ${online[p.id] ? `<button class="link danger-t" data-kick="${p.id}">Force logout</button>` : ''}</td></tr>`).join('');
  }

  const locOptions = [{ value: '', label: '— none (admin only) —' }, ...locs.map((l) => ({ value: l.id, label: `${l.code} · ${l.name} (${l.type})` }))];
  const empOptions = () => [{ value: '', label: '— not linked —' }, ...emps.map((e) => ({ value: e.emp_id, label: `${e.emp_id} · ${e.name}` }))];
  const locOpts = () => [{ value: '', label: '— none (admin only) —' }, ...locs.map((l) => ({ value: l.id, label: `${l.code} · ${l.name} (${l.type})` }))];

  function checkRule(v) {
    if (v.role !== 'admin' && !v.location_id) return 'Choose a location for this role.';
    if (v.role === 'admin') v.location_id = null;
    return null;
  }

  root.querySelector('#add').onclick = async () => {
    const v = await openForm({
      title: 'Add user', submitText: 'Create user',
      fields: [
        { name: 'login_id', label: 'User ID', required: true, hint: '3-30 letters/numbers (e.g. ramesh01). No email needed. Cannot be changed later.' },
        { name: 'password', label: 'Password', type: 'password', required: true, hint: 'At least 8 characters. Hand it to the user privately. You can reset it later.' },
        { name: 'full_name', label: 'Full name', required: true },
        { name: 'emp_id', label: 'Employee (from Employee Master)', type: 'select', options: empOptions() },
        { name: 'role', label: 'Role', type: 'select', value: 'staff', options: ROLES },
        { name: 'location_id', label: 'Location', type: 'select', options: locOpts(), hint: 'Required for every role except Admin.' },
      ],
    });
    if (!v) return;
    if (!validLoginId(v.login_id)) return toast('User ID: 3-30 letters, numbers, dot, dash or underscore', 'error');
    v.login_id = v.login_id.trim().toLowerCase();
    if (v.password.length < 8) return toast('Password must be at least 8 characters', 'error');
    const bad = checkRule(v); if (bad) return toast(bad, 'error');
    // 1) create the login using a separate connection (so the admin stays logged in)
    const tmp = isolatedClient();
    const { data, error } = await tmp.auth.signUp({ email: toLoginEmail(v.login_id), password: v.password });
    if (error) return toast(/already/i.test(error.message) ? 'That User ID is already taken.' : error.message, 'error');
    if (!data.user) return toast('Could not create the login.', 'error');
    // 2) create the profile (role + location)
    const { error: e2 } = await sb.from('profiles').insert({
      id: data.user.id, login_id: v.login_id, email: toLoginEmail(v.login_id), full_name: v.full_name, emp_id: v.emp_id, role: v.role, location_id: v.location_id,
    });
    if (e2) return toast('Login created but profile failed: ' + e2.message, 'error');
    toast('User created', 'ok');
  };

  root.onclick = async (e) => {
    const { edit, tog, kick, pw } = e.target.dataset;
    const me = getState().profile;
    if (edit) {
      const p = users.find((x) => x.id === edit);
      const v = await openForm({
        title: 'Edit user',
        fields: [
          { name: 'full_name', label: 'Full name', required: true, value: p.full_name },
          { name: 'emp_id', label: 'Employee', type: 'select', value: p.emp_id || '', options: empOptions() },
          { name: 'role', label: 'Role', type: 'select', value: p.role, options: ROLES },
          { name: 'location_id', label: 'Location', type: 'select', value: p.location_id || '', options: locOpts() },
        ],
      });
      if (!v) return;
      if (p.id === me.id && v.role !== 'admin') return toast('You cannot remove your own admin role.', 'error');
      const bad = checkRule(v); if (bad) return toast(bad, 'error');
      const { error } = await sb.from('profiles').update(v).eq('id', edit);
      error ? toast(error.message, 'error') : toast('Saved', 'ok');
    }
    if (tog) {
      const p = users.find((x) => x.id === tog);
      if (p.id === me.id) return toast('You cannot deactivate your own account.', 'error');
      if (!(await confirmTwoStep({ title: `${p.is_active ? 'Deactivate' : 'Activate'} ${p.full_name}?`,
        message: p.is_active ? 'They will be logged out immediately and cannot sign in again.' : 'They will be able to sign in again.' }))) return;
      const { error } = await sb.from('profiles').update({ is_active: !p.is_active }).eq('id', tog);
      error ? toast(error.message, 'error') : toast('Updated', 'ok');
    }
    if (pw) {
      const p = users.find((x) => x.id === pw);
      const v = await openForm({ title: `Reset password for ${p.full_name} (${p.login_id})`, submitText: 'Set password', fields: [
        { name: 'password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters. Their open sessions are ended.' }] });
      if (!v) return;
      if (v.password.length < 8) return toast('Password must be at least 8 characters', 'error');
      const { error } = await sb.rpc('admin_set_password', { p_user: pw, p_password: v.password });
      error ? toast(error.message, 'error') : toast('Password changed', 'ok');
    }
    if (kick) {
      const p = users.find((x) => x.id === kick);
      if (!(await confirmTwoStep({ title: `Force logout ${p.full_name}?`, message: 'All their open sessions will end now.' }))) return;
      const { error } = await sb.rpc('admin_revoke_user', { p_user: kick });
      error ? toast(error.message, 'error') : toast('User logged out', 'ok');
    }
  };

  await load();
  watch('profiles', load); watch('user_sessions', load); watch('locations', load);
}
