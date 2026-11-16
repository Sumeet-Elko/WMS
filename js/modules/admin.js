// Administration: workshops, stores, users, dropdown lists, settings, audit log
import { sb, S, run, rpc, reload, fetchAll, setting, adminFn, isAdmin, VIEWER_PAGES, wsName, storeName, userName } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, toggle, act, toast, activeBadge, badge, confirmBox, promptBox, banner, kv, pills, sectionTitle, emptyState, errMsg } from '../core/ui.js';
import { selectBox, strOpts } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { fmtDateTime, ROLE_LABEL, toDateInput, esc } from '../core/format.js';

/* =================================================================== WORKSHOPS / STORES */
function masterPage(kind) {
  const isWsKind = kind === 'workshops'; const label = isWsKind ? 'Workshop' : 'Store'; const key = isWsKind ? 'workshops' : 'stores';
  return async function () {
    const root = h('div');
    const tbl = dataTable({
      exportName: key, defaultSort: { key: 'name', dir: 'asc' }, rowClass: (r) => (r.active ? '' : 'row-muted'), searchPlaceholder: `Search ${label.toLowerCase()}...`,
      columns: [
        { key: 'code', label: isWsKind ? 'Code' : 'Code (DC prefix)', render: (r) => h('span', { class: 'badge b-info plain mono' }, r.code) }, { key: 'name', label: 'Name', render: (r) => h('span', { class: 'cell-main' }, r.name) },
        { key: 'address', label: 'Address' }, { key: 'contact_name', label: 'Contact', value: (r) => [r.contact_name, r.contact_phone].filter(Boolean).join(' · ') }, { key: 'contact_email', label: 'E-mail' },
        { key: 'users', label: 'Users', num: true, value: (r) => S.profiles.filter((p) => p[isWsKind ? 'workshop_id' : 'store_id'] === r.id && p.active).length },
        { key: 'active', label: 'Status', value: (r) => (r.active ? 'Active' : 'Inactive'), render: (r) => activeBadge(r.active) },
        { key: 'x', label: '', sortable: false, exportable: false, render: (r) => h('div', { class: 'actions' }, iconBtn('edit', 'Edit', () => form(r))) },
      ],
      onRowClick: (r) => form(r), toolbar: [btn(`New ${label.toLowerCase()}`, { cls: 'primary sm', icon: 'plus', onClick: () => form() })],
      empty: { icon: isWsKind ? 'factory' : 'store', title: `No ${key} yet`, text: `Create the first ${label.toLowerCase()} and then add its users.` },
    });
    const load = async () => { await Promise.all([reload(key), reload('profiles')]); tbl.setRows(S[key]); };
    root.append(pageHead({ title: isWsKind ? 'Workshops' : 'Stores', sub: isWsKind ? 'Each workshop has its own job card number series and a Manager + Supervisors.' : 'Each store has its own delivery challan series, prefixed with its 2-character code (e.g. UN-000001).' }), h('div', { class: 'card' }, tbl.el));
    tbl.setRows(S[key]);
    return { el: root, refresh: load };

    function form(r) {
      const edit = !!r; const d = r || { active: true };
      const code = inp({ value: d.code || '', maxlength: 2, placeholder: 'e.g. UN', style: { textTransform: 'uppercase', width: '110px' } }); const name = inp({ value: d.name || '' });
      const addr = textarea({ value: d.address || '', rows: 2 }); const cn = inp({ value: d.contact_name || '' }); const cp = inp({ value: d.contact_phone || '' }); const ce = inp({ type: 'email', value: d.contact_email || '' }); const gst = inp({ value: d.gstin || '' });
      const a = toggle({ checked: d.active });
      const m = modal({ title: edit ? `Edit ${r.name}` : `New ${label.toLowerCase()}`, size: 'md', content: h('div', { class: 'col' },
        h('div', { class: 'form-grid' }, field('2-character code', code, { required: true, hint: isWsKind ? 'Prefix of job card numbers' : 'Prefix of delivery challan numbers. Cannot be changed once used.' }), field('Name', name, { required: true, cls: 'span2' }), field('Address', addr, { cls: 'full' }), field('Contact person', cn), field('Phone', cp), field('E-mail', ce), field('GSTIN', gst),
          h('div', { class: 'field' }, h('label', null, 'Active'), a))),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Save', { cls: 'primary', onClick: act(async () => {
        const row = { code: code.value.trim().toUpperCase(), name: name.value.trim(), address: addr.value.trim() || null, contact_name: cn.value.trim() || null, contact_phone: cp.value.trim() || null, contact_email: ce.value.trim() || null, gstin: gst.value.trim() || null, active: a.querySelector('input').checked };
        if (!/^[A-Z0-9]{2}$/.test(row.code)) throw new Error('Code must be exactly 2 letters / digits'); if (!row.name) throw new Error('Name is required');
        if (edit) await run(sb.from(key).update(row).eq('id', r.id)); else await run(sb.from(key).insert({ ...row, created_by: S.user.id }));
        toast(`${label} saved`); m.close(); await load();
      }) })] });
    }
  };
}
export const workshops = masterPage('workshops');
export const stores = masterPage('stores');

/* =================================================================== USERS */
export async function users() {
  const root = h('div');
  const scope = (p) => (p.workshop_id ? wsName(p.workshop_id) : p.store_id ? storeName(p.store_id) : 'All');
  const tbl = dataTable({
    exportName: 'users', defaultSort: { key: 'full_name', dir: 'asc' }, rowClass: (r) => (r.active ? '' : 'row-muted'), searchPlaceholder: 'Search name or User ID...',
    filters: [{ key: 'role', label: 'All roles', options: Object.entries(ROLE_LABEL).map(([k, v]) => ({ value: k, label: v })) }, { key: 'scope', label: 'All workshops / stores', value: scope }],
    columns: [
      { key: 'full_name', label: 'Name', render: (r) => h('div', null, h('div', { class: 'cell-main' }, r.full_name), h('div', { class: 'cell-sub mono' }, r.username || r.email || '')) },
      { key: 'role', label: 'Role', value: (r) => ROLE_LABEL[r.role], render: (r) => badge(ROLE_LABEL[r.role], r.role === 'admin' ? 'danger' : r.role === 'store_user' ? 'teal' : r.role === 'workshop_manager' ? 'purple' : 'info', true) },
      { key: 'scope', label: 'Workshop / store', value: scope }, { key: 'phone', label: 'Phone' }, { key: 'active', label: 'Status', value: (r) => (r.active ? 'Active' : 'Inactive'), render: (r) => activeBadge(r.active) },
      { key: 'created_at', label: 'Created', render: (r) => fmtDateTime(r.created_at) }, { key: 'x', label: '', sortable: false, exportable: false, render: (r) => h('div', { class: 'actions' }, iconBtn('edit', 'Edit', () => form(r))) },
    ],
    onRowClick: (r) => form(r), toolbar: [btn('New user', { cls: 'primary sm', icon: 'plus', onClick: () => form() })],
    empty: { icon: 'users', title: 'No users yet' },
  });
  const load = async () => { await reload('profiles'); tbl.setRows(S.profiles); };
  root.append(pageHead({ title: 'Users', sub: 'Assign each user a role and the workshop or store they belong to. Workshops have a Manager and Supervisors; stores have Store Users.' }), h('div', { class: 'card' }, tbl.el));
  tbl.setRows(S.profiles);
  return { el: root, refresh: load };

  function form(p) {
    const edit = !!p; const d = p || { role: 'workshop_supervisor', active: true };
    const name = inp({ value: d.full_name || '' }); const email = inp({ value: d.username || '', disabled: edit, autocomplete: 'off', placeholder: 'e.g. rajesh.k', style: { textTransform: 'lowercase' } }); const phone = inp({ value: d.phone || '' });
    const pw = inp({ type: 'text', placeholder: edit ? 'Leave blank to keep the current password' : 'Password (min 6 characters)', autocomplete: 'new-password' });
    const roleSel = selectBox({ options: Object.entries(ROLE_LABEL).map(([k, v]) => ({ value: k, label: v })), value: d.role, clearable: false, onChange: sync });
    const ws = selectBox({ options: S.workshops.filter((w) => w.active || w.id === d.workshop_id).map((w) => ({ value: w.id, label: w.name, sub: w.code })), value: d.workshop_id, placeholder: 'Select workshop' });
    const st = selectBox({ options: S.stores.filter((w) => w.active || w.id === d.store_id).map((w) => ({ value: w.id, label: w.name, sub: w.code })), value: d.store_id, placeholder: 'Select store' });
    const wsF = field('Workshop', ws, { required: true }); const stF = field('Store', st, { required: true });
    const a = toggle({ checked: d.active }); if (edit && p.id === S.user.id) a.querySelector('input').disabled = true;
    function sync() { const r = roleSel.getValue(); wsF.classList.toggle('hide', !['workshop_manager', 'workshop_supervisor'].includes(r)); stF.classList.toggle('hide', r !== 'store_user'); }
    sync();
    const m = modal({ title: edit ? `Edit ${p.full_name}` : 'New user', size: 'md', content: h('div', { class: 'col' },
      h('div', { class: 'form-grid' }, field('Full name', name, { required: true }), field('User ID (login)', email, { required: true, hint: edit ? 'The User ID cannot be changed.' : 'Letters, digits, . - _ (3-30). Share it with the user along with the password.' }), field('Phone', phone), field('Role', roleSel, { required: true }), wsF, stF, field(edit ? 'Reset password' : 'Password', pw, { required: !edit }), h('div', { class: 'field' }, h('label', null, 'Active'), a))),
    foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn(edit ? 'Save changes' : 'Create user', { cls: 'primary', onClick: act(async () => {
      const role = roleSel.getValue(); const row = { full_name: name.value.trim(), phone: phone.value.trim() || null, role, workshop_id: ['workshop_manager', 'workshop_supervisor'].includes(role) ? ws.getValue() : null, store_id: role === 'store_user' ? st.getValue() : null, active: a.querySelector('input').checked };
      if (!row.full_name) throw new Error('Name is required'); if (['workshop_manager', 'workshop_supervisor'].includes(role) && !row.workshop_id) throw new Error('Select the workshop'); if (role === 'store_user' && !row.store_id) throw new Error('Select the store');
      if (edit) {
        if (p.id === S.user.id && role !== 'admin') throw new Error('You cannot remove your own admin role');
        await run(sb.from('profiles').update(row).eq('id', p.id));
        if (pw.value) { if (pw.value.length < 6) throw new Error('Password must be at least 6 characters'); await adminFn({ action: 'reset_password', user_id: p.id, password: pw.value }); }
        if (row.active !== p.active) { try { await adminFn({ action: 'set_active', user_id: p.id, active: row.active }); } catch (e) { console.warn(e); } }
      } else {
        const uname = email.value.trim().toLowerCase(); if (!/^[a-z0-9._-]{3,30}$/.test(uname)) throw new Error('User ID must be 3-30 characters: letters, digits, dot, dash or underscore'); if (S.profiles.some((x) => x.username === uname)) throw new Error('That User ID is already taken'); if (pw.value.length < 6) throw new Error('Password must be at least 6 characters');
        await adminFn({ action: 'create', username: uname, password: pw.value, ...row });
      }
      toast(edit ? 'User updated' : 'User created'); m.close(); await load();
    }) })] });
  }
}

/* =================================================================== DROPDOWNS */
const CATS = [['complaint_type', 'Complaint types', 'Shown on the job card'], ['spare_type', 'Spare types', 'Original, Refurbished... used in the product master'], ['vehicle_type', 'Vehicle types', 'Vehicle master'], ['uom', 'Issue units (UOM)', 'Units stores hand over: Nos, Set, Barrel...'], ['base_uom', 'Consumption units', 'Units used up in the workshop: Pcs, Ltr...']];
export async function dropdowns() {
  const root = h('div'); let cat = CATS[0][0]; const body = h('div');
  const pl = pills({ items: CATS.map(([k, l]) => ({ key: k, label: l })), active: cat, onChange: (k) => { cat = k; draw(); } });
  function draw() {
    const meta = CATS.find((c) => c[0] === cat); const rows = S.dropdowns.filter((x) => x.category === cat);
    const nv = inp({ placeholder: `Add a new value (e.g. ${cat === 'complaint_type' ? 'Hydraulic leak' : cat === 'spare_type' ? 'Reconditioned' : '...'})` });
    const add = act(async () => { const v = nv.value.trim(); if (!v) throw new Error('Type a value first'); await run(sb.from('dropdown_options').insert({ category: cat, value: v, sort_order: (rows.reduce((a, r) => Math.max(a, r.sort_order), 0) || 0) + 10 })); nv.value = ''; await reload('dropdowns'); draw(); toast('Value added'); });
    nv.addEventListener('keydown', (e) => e.key === 'Enter' && add({ currentTarget: null }));
    const t = dataTable({ hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 500, rows, defaultSort: { key: 'sort_order', dir: 'asc' }, rowClass: (r) => (r.active ? '' : 'row-muted'),
      columns: [{ key: 'value', label: 'Value', render: (r) => h('span', { class: 'cell-main' }, r.value) },
        { key: 'sort_order', label: 'Order', num: true, render: (r) => { const i = inp({ type: 'number', value: r.sort_order, cls: 'sm', style: { width: '80px', textAlign: 'right' } }); i.onchange = act(async () => { await run(sb.from('dropdown_options').update({ sort_order: parseInt(i.value, 10) || 0 }).eq('id', r.id)); await reload('dropdowns'); draw(); }); return i; } },
        ...(cat === 'spare_type' ? [{ key: 'consumable', label: 'Allowed in Consumable Job Card', value: (r) => (r.consumable ? 'Yes' : 'No'), render: (r) => { const tg = toggle({ checked: !!r.consumable }); tg.querySelector('input').onchange = act(async (e) => { await run(sb.from('dropdown_options').update({ consumable: e.target.checked }).eq('id', r.id)); await reload('dropdowns'); draw(); toast(e.target.checked ? 'Enabled for consumable job cards' : 'Disabled for consumable job cards'); }); return tg; } }] : []),
        ...(cat === 'spare_type' ? [{ key: 'facility', label: 'Allowed in Facility Job Card', value: (r) => (r.facility ? 'Yes' : 'No'), render: (r) => { const tg = toggle({ checked: !!r.facility }); tg.querySelector('input').onchange = act(async (e) => { await run(sb.from('dropdown_options').update({ facility: e.target.checked }).eq('id', r.id)); await reload('dropdowns'); draw(); toast(e.target.checked ? 'Enabled for facility job cards' : 'Disabled for facility job cards'); }); return tg; } }] : []),
        { key: 'active', label: 'Show in lists', value: (r) => (r.active ? 'Yes' : 'No'), render: (r) => { const tg = toggle({ checked: r.active }); tg.querySelector('input').onchange = act(async (e) => { await run(sb.from('dropdown_options').update({ active: e.target.checked }).eq('id', r.id)); await reload('dropdowns'); draw(); }); return tg; } }],
      empty: { icon: 'list', title: 'No values yet' } });
    body.replaceChildren(card({ title: meta[1], actions: null, flush: true, body: h('div', null, h('div', { class: 'toolbar' }, h('div', { class: 'small muted grow' }, meta[2]), h('div', { class: 'row nowrap', style: { minWidth: '320px' } }, nv, btn('Add', { cls: 'primary', icon: 'plus', onClick: add }))), t.el) }));
  }
  draw();
  root.append(pageHead({ title: 'Dropdown Lists', sub: 'Add new values any time - they appear instantly in forms. Values are hidden, never deleted, so old records stay valid.' }), h('div', { class: 'mb' }, pl), body);
  return { el: root };
}

/* =================================================================== SETTINGS */
export async function settings() {
  const root = h('div'); const rows = S.settingRows.slice().sort((a, b) => a.key.localeCompare(b.key));
  const group = (title, keys) => card({ title, cls: 'mb', body: h('div', { class: 'col', style: { gap: '18px' } }, keys.map((k) => { const r = rows.find((x) => x.key === k); return r ? rowEl(r) : null; })) });
  function rowEl(r) {
    let ctl; const v = r.value;
    if (typeof v === 'boolean') { ctl = toggle({ checked: v }); ctl.querySelector('input').onchange = act(async (e) => save(r, e.target.checked)); }
    else {
      const i = inp({ type: typeof v === 'number' ? 'number' : 'text', value: v, style: { maxWidth: '360px' }, min: typeof v === 'number' ? '1' : null });
      const b = btn('Save', { cls: 'sm primary', onClick: act(async () => { const nv = typeof v === 'number' ? Number(i.value) : i.value; if (typeof v === 'number' && !(nv > 0)) throw new Error('Enter a number greater than zero'); await save(r, nv); }) });
      ctl = h('div', { class: 'row nowrap' }, i, b);
    }
    return h('div', { class: 'row between', style: { alignItems: 'flex-start', gap: '20px' } }, h('div', { style: { maxWidth: '520px' } }, h('div', { class: 'bold' }, r.label || r.key), h('div', { class: 'small muted' }, r.description || '')), ctl);
  }
  async function save(r, value) { await run(sb.from('settings').update({ value }).eq('key', r.key)); r.value = value; await reload('settings'); toast('Setting saved'); }
  function logoCard() {
    const cur = () => { const l = setting('company_logo', ''); return l && String(l).startsWith('data:') ? l : new URL('assets/company-logo.png', document.baseURI).href; };
    const img = h('img', { src: cur(), style: { height: '70px', maxWidth: '240px', objectFit: 'contain', background: '#fff', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px' } });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'input', style: { height: 'auto', padding: '8px', maxWidth: '320px' } });
    const store = async (v) => { const { error } = await sb.from('settings').update({ value: v }).eq('key', 'company_logo'); if (error) throw new Error(error.message); await reload('settings'); img.src = cur(); toast('Logo saved'); };
    file.onchange = act(async () => {
      const f = file.files[0]; if (!f) return; const bmp = await createImageBitmap(f); const k = Math.min(1, 500 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      await store(c.toDataURL('image/png')); file.value = '';
    });
    return card({ title: 'Company logo (printed on PDFs)', cls: 'mb', body: h('div', { class: 'row', style: { gap: '20px', alignItems: 'center' } }, img, h('div', { class: 'col' }, file, btn('Use default logo', { cls: 'sm ghost', onClick: act(async () => store('')) }), h('div', { class: 'small muted' }, 'PNG or JPG. It is shown centered above the company name.'))) });
  }
  function viewerCard() {
    const blocked = new Set(Array.isArray(setting('viewer_blocked_pages', [])) ? setting('viewer_blocked_pages', []) : []);
    const boxes = VIEWER_PAGES.filter(([p]) => p !== '/dashboard').map(([path, label]) => {
      const cb = h('input', { type: 'checkbox', checked: !blocked.has(path), style: { width: '18px', height: '18px' } });
      cb.onchange = act(async () => { cb.checked ? blocked.delete(path) : blocked.add(path); await save({ key: 'viewer_blocked_pages' }, [...blocked]); });
      return h('label', { class: 'row nowrap', style: { gap: '8px', cursor: 'pointer', minWidth: '210px' } }, cb, h('span', null, label));
    });
    return card({ title: 'Viewer access (applies to every Viewer user)', cls: 'mb', body: h('div', { class: 'col' },
      h('div', { class: 'small muted' }, 'Viewers are strictly read-only: they can never add, edit, delete or approve anything, and never see Users, Settings, Workshops, Stores, Dropdown Lists, Audit Log or Storage. Untick a page below to hide it from ALL Viewer users.'),
      h('div', { class: 'row', style: { gap: '10px 24px', flexWrap: 'wrap' } }, boxes)) });
  }
  root.append(pageHead({ title: 'Settings', sub: 'Changes apply to everyone immediately.' }), viewerCard(), group('Storage limits (for the Storage & usage page)', ['db_limit_mb', 'storage_limit_mb']),
    group('Security & sessions', ['session_timeout_min', 'idle_draft_min', 'lock_ttl_seconds']), group('Workflow rules', ['enforce_store_stock', 'one_open_jc_per_vehicle', 'block_manhour_overlap', 'display_timezone', 'allow_loose_issue', 'max_images_per_card', 'max_pdfs_per_card']), logoCard(), group('Company details (printed on documents)', ['company_name', 'company_address', 'company_gstin', 'print_footer']));
  return { el: root };
}

/* =================================================================== AUDIT LOG */
export async function audit() {
  const root = h('div'); let rows = [];
  const from = inp({ type: 'date', value: toDateInput(new Date(Date.now() - 7 * 86400000)) }); const to = inp({ type: 'date', value: toDateInput(new Date()) });
  const ent = selectBox({ options: [...new Set(['job_cards', 'jc_manhours', 'jc_spares', 'consumable_jcs', 'cjc_vehicles', 'cjc_spares', 'cjc_manhours', 'mrfs', 'mrf_lines', 'delivery_challans', 'dc_lines', 'return_dcs', 'return_dc_lines', 'return_queue', 'store_inwards', 'products', 'vehicles', 'employees', 'workshops', 'stores', 'profiles', 'settings', 'dropdown_options'])].map((x) => ({ value: x, label: x })), placeholder: 'All records' });
  const tbl = dataTable({
    exportName: 'audit-log', defaultSort: { key: 'id', dir: 'desc' }, searchPlaceholder: 'Search user, document no, summary...', pageSize: 50,
    filters: [{ key: 'action', label: 'All actions', options: ['INSERT', 'UPDATE', 'DELETE', 'EVENT'].map((x) => ({ value: x, label: x })) }, { key: 'user_name', label: 'All users' }],
    columns: [{ key: 'id', label: '#', num: true, render: (r) => h('span', { class: 'mono muted' }, r.id) }, { key: 'ts', label: 'When', render: (r) => fmtDateTime(r.ts) },
      { key: 'user_name', label: 'User', render: (r) => h('div', null, h('div', { class: 'cell-main' }, r.user_name || 'system'), h('div', { class: 'cell-sub' }, ROLE_LABEL[r.user_role] || '')) },
      { key: 'action', label: 'Action', render: (r) => badge(r.action, r.action === 'DELETE' ? 'danger' : r.action === 'EVENT' ? 'purple' : r.action === 'INSERT' ? 'ok' : 'info', true) },
      { key: 'entity', label: 'Record', render: (r) => h('span', { class: 'mono' }, r.entity) }, { key: 'entity_no', label: 'Document / key', render: (r) => h('span', { class: 'mono' }, r.entity_no || '—') }, { key: 'summary', label: 'What happened' }],
    onRowClick: detail, empty: { icon: 'shield', title: 'No audit entries in this period' },
  });
  async function load() {
    rows = await fetchAll(() => { let q = sb.from('audit_log').select('*').gte('ts', new Date(from.value + 'T00:00:00').toISOString()).lte('ts', new Date(to.value + 'T23:59:59').toISOString()).order('id', { ascending: false }); if (ent.getValue()) q = q.eq('entity', ent.getValue()); return q; });
    tbl.setRows(rows);
  }
  function detail(r) {
    const keys = [...new Set([...Object.keys(r.old_data || {}), ...Object.keys(r.new_data || {})])];
    const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const m = modal({ title: `${r.action} · ${r.entity}${r.entity_no ? ' · ' + r.entity_no : ''}`, size: 'md', content: h('div', { class: 'col' },
      kv([['When', fmtDateTime(r.ts)], ['User', `${r.user_name || 'system'} (${ROLE_LABEL[r.user_role] || '-'})`], ['Record id', r.entity_id], ['Summary', r.summary]]),
      keys.length ? h('table', { class: 'dt' }, h('thead', null, h('tr', null, ['Field', 'Before', 'After'].map((x) => h('th', null, x)))), h('tbody', null, keys.map((k) => h('tr', null, h('td', null, h('b', null, k)), h('td', null, h('span', { class: 'diff' }, r.old_data && k in r.old_data ? h('span', { class: 'o' }, fmt(r.old_data[k])) : '—')), h('td', null, h('span', { class: 'diff' }, r.new_data && k in r.new_data ? h('span', { class: 'n' }, fmt(r.new_data[k])) : '—')))))) : null) });
  }
  const bar = h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', null, 'From'), from), h('div', { class: 'field' }, h('label', null, 'To'), to), h('div', { class: 'field', style: { minWidth: '220px' } }, h('label', null, 'Record type'), ent), h('div', { style: { alignSelf: 'end' } }, btn('Show', { cls: 'primary', icon: 'search', onClick: act(load) })));
  await load();
  root.append(pageHead({ title: 'Audit Log', sub: 'Every change - who, when, before and after. This log is append-only: nobody, including the administrator, can edit or delete it.' }), h('div', { class: 'card' }, bar, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== STORAGE & USAGE */
const MB = 1048576;
const mbTxt = (b) => (b >= 1024 * MB ? (b / 1024 / MB).toFixed(2) + ' GB' : (b / MB).toFixed(b < 10 * MB ? 2 : 1) + ' MB');
function meter(title, used, limitMb, hint) {
  const pct = Math.min(100, (used / (limitMb * MB)) * 100); const col = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)';
  return card({ title, cls: 'mb', body: h('div', { class: 'col' },
    h('div', { class: 'row between' }, h('div', { style: { fontSize: '26px', fontWeight: '700' } }, mbTxt(used)), h('div', { class: 'muted' }, `of ${limitMb >= 1024 ? (limitMb / 1024) + ' GB' : limitMb + ' MB'} (${pct.toFixed(1)}%)`)),
    h('div', { style: { height: '12px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden' } }, h('div', { style: { height: '100%', width: pct + '%', background: col } })),
    pct >= 90 ? banner('danger', 'Almost full - delete old files or upgrade your Supabase plan.') : pct >= 70 ? banner('warn', 'Over 70% used - plan ahead.') : null,
    h('div', { class: 'small muted' }, hint)) });
}
export async function storage() {
  const root = h('div'); const body = h('div');
  async function load() {
    const d = await rpc('admin_storage_stats');
    const dbL = Number(setting('db_limit_mb', 500)); const stL = Number(setting('storage_limit_mb', 1024));
    const tbl = (head, rows) => h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'dt' }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
    body.replaceChildren(
      meter('Database', d.db_bytes, dbL, 'Everything the app stores: job cards, stock, ledger, audit log. Limit is editable in Settings.'),
      meter('File storage (job card images & PDFs)', d.file_bytes, stL, `${d.file_count} file(s) in the job-attachments bucket.`),
      card({ title: 'Records', cls: 'mb', body: h('div', { class: 'row', style: { gap: '28px', flexWrap: 'wrap' } }, [['Job cards', d.cards.job_cards], ['Consumable / Facility cards', d.cards.consumable_cards], ['Stock ledger rows', d.cards.ledger_rows], ['Audit log rows', d.cards.audit_rows]].map(([l, v]) => h('div', null, h('div', { class: 'muted small' }, l), h('div', { style: { fontSize: '20px', fontWeight: '700' } }, String(v))))) }),
      card({ title: 'Largest tables', cls: 'mb', flush: true, body: tbl(['Table', 'Rows (approx.)', 'Size'], d.tables.map((t) => [t.name, String(t.rows), mbTxt(t.bytes)])) }),
      card({ title: 'Attachments by workshop', cls: 'mb', flush: true, body: d.by_workshop.length ? tbl(['Workshop', 'Files', 'Size'], d.by_workshop.map((t) => [t.workshop, String(t.files), mbTxt(t.bytes)])) : h('div', { class: 'muted', style: { padding: '16px' } }, 'No attachments yet.') }),
      card({ title: 'Attachments by type', cls: 'mb', flush: true, body: d.by_type.length ? tbl(['Type', 'Files', 'Size'], d.by_type.map((t) => [t.type === 'pdf' ? 'PDF' : 'Image', String(t.files), mbTxt(t.bytes)])) : h('div', { class: 'muted', style: { padding: '16px' } }, 'No attachments yet.') }));
  }
  root.append(pageHead({ title: 'Storage & usage', sub: 'Live usage of your Supabase database and file storage - no need to open the Supabase dashboard.', actions: btn('Refresh', { icon: 'refresh', onClick: act(load) }) }), body);
  body.append(h('div', { class: 'skeleton', style: { height: '200px' } }));
  await load();
  return { el: root };
}
