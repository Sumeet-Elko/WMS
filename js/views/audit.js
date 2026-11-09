import { sb, watch } from '../db.js';
import { esc, fmtDate, toast, showInfo } from '../ui.js';

export async function render(root) {
  root.innerHTML = `<div class="head"><h2>Audit Ledger</h2><div class="btns">
    <select id="tbl"><option value="">All tables</option>${['profiles', 'locations', 'vehicles', 'employees', 'products', 'app_settings']
      .map((t) => `<option>${t}</option>`).join('')}</select>
    <select id="act"><option value="">All actions</option><option>INSERT</option><option>UPDATE</option></select>
    <input type="search" id="q" placeholder="Search operator / record…"></div></div>
    <p class="muted">Read-only. Rows can never be edited or deleted. Click a row to see what changed.</p>
    <div class="tablewrap"><table id="t"></table></div>`;
  let rows = [];

  function draw() {
    const q = root.querySelector('#q').value.trim().toLowerCase();
    const shown = rows.filter((r) => !q || (r.operator?.full_name || '').toLowerCase().includes(q) || String(r.record_id).includes(q));
    root.querySelector('#t').innerHTML = '<tr><th>When</th><th>Operator</th><th>Location</th><th>Table</th><th>Action</th><th>Record</th></tr>' +
      (shown.map((r) => `<tr class="click" data-id="${r.id}"><td>${fmtDate(r.at)}</td><td>${esc(r.operator?.full_name || 'System')}</td>
        <td>${esc(r.location?.code || '—')}</td><td>${esc(r.table_name)}</td><td>${esc(r.action)}</td>
        <td><small>${esc(String(r.record_id).slice(0, 8))}</small></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No entries</td></tr>');
  }

  async function load() {
    let q = sb.from('audit_log')
      .select('*, operator:profiles!operator_id(full_name), location:locations!location_id(code)')
      .order('at', { ascending: false }).limit(300);
    const t = root.querySelector('#tbl').value, a = root.querySelector('#act').value;
    if (t) q = q.eq('table_name', t);
    if (a) q = q.eq('action', a);
    const { data, error } = await q;
    if (error) return toast(error.message, 'error');
    rows = data; draw();
  }

  root.querySelector('#tbl').onchange = load;
  root.querySelector('#act').onchange = load;
  root.querySelector('#q').oninput = draw;
  root.querySelector('#t').onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const r = rows.find((x) => String(x.id) === tr.dataset.id);
    const o = r.old_data || {}, n = r.new_data || {};
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])]
      .filter((k) => !r.old_data || JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    showInfo(`${r.action} on ${r.table_name}`,
      `<div class="tablewrap"><table><tr><th>Field</th><th>Before</th><th>After</th></tr>${keys.map((k) =>
        `<tr><td>${esc(k)}</td><td>${esc(o[k] ?? '')}</td><td>${esc(n[k] ?? '')}</td></tr>`).join('')}</table></div>`);
  };
  await load();
  watch('audit_log', load);
}
