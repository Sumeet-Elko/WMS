import { sb, watch } from '../db.js';
import { esc, badge, openForm, toast, confirmTwoStep } from '../ui.js';

export async function render(root) {
  root.innerHTML = `<div class="head"><h2>Stores &amp; Workshops</h2><button class="btn" id="add">+ Add location</button></div>
    <p class="muted">Each location is an isolated unit with exactly one head (Stores Head for a store, Workshop Head for a workshop).</p>
    <div class="tablewrap"><table id="t"></table></div>`;
  let rows = [];

  async function load() {
    const [{ data: locs, error }, { data: heads }] = await Promise.all([
      sb.from('locations').select('*').order('code'),
      sb.from('profiles').select('full_name,location_id,role').in('role', ['stores_head', 'workshop_head']).eq('is_active', true),
    ]);
    if (error) return toast(error.message, 'error');
    rows = locs;
    const headOf = Object.fromEntries((heads || []).map((h) => [h.location_id, h.full_name]));
    root.querySelector('#t').innerHTML = '<tr><th>Code</th><th>Name</th><th>Type</th><th>Head</th><th>Status</th><th></th></tr>' +
      (rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.type)}</td>
        <td>${esc(headOf[r.id] || '— not assigned —')}</td>
        <td>${badge(r.is_active ? 'Active' : 'Inactive', r.is_active ? 'active' : 'inactive')}</td>
        <td class="acts"><button class="link" data-edit="${r.id}">Edit</button>
        <button class="link" data-tog="${r.id}">${r.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') ||
      '<tr><td colspan="6" class="muted">No locations yet. Add your first store or workshop.</td></tr>');
  }

  const fields = (r = {}) => [
    { name: 'code', label: 'Code', required: true, value: r.code, hint: 'Short unique code, e.g. ST01 or WS01' },
    { name: 'name', label: 'Name', required: true, value: r.name },
    { name: 'type', label: 'Type', type: 'select', value: r.type || 'store', options: [{ value: 'store', label: 'Store' }, { value: 'workshop', label: 'Workshop' }] },
  ];

  root.querySelector('#add').onclick = async () => {
    const v = await openForm({ title: 'Add location', fields: fields() });
    if (!v) return;
    const { error } = await sb.from('locations').insert(v);
    error ? toast(error.message, 'error') : toast('Location added', 'ok');
  };
  root.onclick = async (e) => {
    const edit = e.target.dataset.edit, tog = e.target.dataset.tog;
    if (edit) {
      const r = rows.find((x) => x.id === edit);
      const v = await openForm({ title: 'Edit location', fields: fields(r) });
      if (!v) return;
      const { error } = await sb.from('locations').update(v).eq('id', edit);
      error ? toast(error.message, 'error') : toast('Saved', 'ok');
    }
    if (tog) {
      const r = rows.find((x) => x.id === tog);
      if (!(await confirmTwoStep({ title: `${r.is_active ? 'Deactivate' : 'Activate'} ${r.code}?`, message: 'This changes the location for everyone using it.' }))) return;
      const { error } = await sb.from('locations').update({ is_active: !r.is_active }).eq('id', tog);
      error ? toast(error.message, 'error') : toast('Updated', 'ok');
    }
  };
  await load();
  watch('locations', load);
  watch('profiles', load);
}
