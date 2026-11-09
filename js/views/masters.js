// Vehicle / Employee / Spare masters: add, edit, activate-deactivate, import from Excel/CSV.
// There is no delete anywhere - records are switched inactive instead.
import { sb, watch } from '../db.js';
import { esc, badge, openForm, toast, confirmTwoStep, showInfo } from '../ui.js';

const TRUE_WORDS = ['yes', 'y', 'true', '1', 'decimal', 'decimals'];

const MASTERS = {
  vehicles: {
    title: 'Vehicle Master', table: 'vehicles', key: 'vehicle_no', order: 'vehicle_no', sheetHint: 'vehicle',
    cols: [
      { k: 'vehicle_no', label: 'Vehicle No', h: ['vehicle no', 'vehicle number'], required: true },
      { k: 'model', label: 'Model', h: ['model'] },
    ],
  },
  employees: {
    title: 'Employee Master', table: 'employees', key: 'emp_id', order: 'name', sheetHint: 'employee',
    cols: [
      { k: 'emp_id', label: 'Employee ID', h: ['employee id', 'emp id', 'emp_id'], required: true, text: true },
      { k: 'name', label: 'Name', h: ['name', 'employee name'], required: true },
      { k: 'designation', label: 'Designation', h: ['designation', 'role'] },
      { k: 'department', label: 'Department', h: ['department'] },
    ],
  },
  products: {
    title: 'Spare / Product Master', table: 'products', key: 'item_code', order: 'item_name', sheetHint: 'spare',
    cols: [
      { k: 'item_code', label: 'Item Code', h: ['item code'], required: true },
      { k: 'item_name', label: 'Item Name', h: ['item name'], required: true },
      { k: 'brand', label: 'Brand', h: ['brand'] },
      { k: 'type', label: 'Type', h: ['type'], select: ['Product', 'Service'], def: 'Product' },
      { k: 'purchase_uom', label: 'Purchase UOM', h: ['purchase uom', 'buying uom'], required: true },
      { k: 'base_uom', label: 'Base UOM', h: ['base uom'], required: true },
      { k: 'uoq', label: 'UOQ (Base per Purchase UOM)', h: ['uoq', 'conversion'], num: true, def: 1,
        hint: 'e.g. 1 Barrel = 200 Litres -> 200' },
      { k: 'l1_category', label: 'L1 Category', h: ['l1 category'] },
      { k: 'l2_category', label: 'L2 Category', h: ['l2 category'] },
      { k: 'l3_category', label: 'L3 Category', h: ['l3 category'] },
      { k: 'part_no', label: 'Part No', h: ['part no', 'part number'] },
      { k: 'allow_decimals', label: 'Allow decimals in consumption', h: ['allow decimals for consumption?', 'allow decimals'], bool: true },
      { k: 'common_jc_allowed', label: 'Allowed on Common Job Cards', h: ['common jc allowed', 'allowed on common job cards'], bool: true,
        hint: 'Tick ONLY for non-structural consumables (oils, coolants, small fasteners)' },
    ],
  },
};

export async function render(root, which = 'vehicles') {
  const M = MASTERS[which];
  root.innerHTML = `<div class="head"><h2>${M.title}</h2><div class="btns">
      <input type="search" id="q" placeholder="Search…">
      <button class="btn ghost" id="imp">Import Excel/CSV</button>
      <button class="btn" id="add">+ Add</button></div></div>
    <input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>
    <p class="muted" id="count"></p><div class="tablewrap"><table id="t"></table></div>`;
  let rows = [];
  const LIMIT = 300;

  function draw() {
    const q = root.querySelector('#q').value.trim().toLowerCase();
    const shown = rows.filter((r) => !q || M.cols.some((c) => String(r[c.k] ?? '').toLowerCase().includes(q)));
    root.querySelector('#count').textContent = `${shown.length} of ${rows.length} records` + (shown.length > LIMIT ? ` (showing first ${LIMIT} — use search)` : '');
    const cell = (r, c) => c.bool ? (r[c.k] ? 'Yes' : 'No') : esc(r[c.k] ?? '');
    root.querySelector('#t').innerHTML =
      `<tr>${M.cols.slice(0, which === 'products' ? 8 : 4).map((c) => `<th>${c.label}</th>`).join('')}<th>Status</th><th></th></tr>` +
      shown.slice(0, LIMIT).map((r) => `<tr>${M.cols.slice(0, which === 'products' ? 8 : 4).map((c) => `<td>${cell(r, c)}</td>`).join('')}
        <td>${badge(r.is_active ? 'Active' : 'Inactive', r.is_active ? 'active' : 'inactive')}</td>
        <td class="acts"><button class="link" data-edit="${r.id}">Edit</button>
        <button class="link" data-tog="${r.id}">${r.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
  }

  async function load() {
    const { data, error } = await sb.from(M.table).select('*').order(M.order).range(0, 4999);
    if (error) return toast(error.message, 'error');
    rows = data; draw();
  }

  const fields = (r) => M.cols.map((c) => ({
    name: c.k, label: c.label, required: c.required, hint: c.hint,
    type: c.select ? 'select' : c.bool ? 'checkbox' : c.num ? 'number' : 'text',
    options: c.select?.map((x) => ({ value: x, label: x })),
    value: r ? r[c.k] : (c.def ?? ''), readonly: !!(r && c.k === M.key),
  }));

  root.querySelector('#q').oninput = draw;
  root.querySelector('#add').onclick = async () => {
    const v = await openForm({ title: 'Add ' + M.title, fields: fields() });
    if (!v) return;
    const { error } = await sb.from(M.table).insert(v);
    error ? toast(error.code === '23505' ? 'That ' + M.key + ' already exists.' : error.message, 'error') : toast('Added', 'ok');
  };

  root.onclick = async (e) => {
    const { edit, tog } = e.target.dataset;
    if (edit) {
      const r = rows.find((x) => x.id === edit);
      const v = await openForm({ title: 'Edit ' + M.title, fields: fields(r) });
      if (!v) return;
      delete v[M.key];
      const { error } = await sb.from(M.table).update(v).eq('id', edit);
      error ? toast(error.message, 'error') : toast('Saved', 'ok');
    }
    if (tog) {
      const r = rows.find((x) => x.id === tog);
      const { error } = await sb.from(M.table).update({ is_active: !r.is_active }).eq('id', tog);
      error ? toast(error.message, 'error') : toast(r.is_active ? 'Deactivated' : 'Activated', 'ok');
    }
  };

  // ---------------- import ----------------
  root.querySelector('#imp').onclick = () => root.querySelector('#file').click();
  root.querySelector('#file').onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      toast('Reading file…');
      const XLSX = await import('https://esm.sh/xlsx@0.18.5');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const name = wb.SheetNames.find((n) => n.toLowerCase().includes(M.sheetHint)) || wb.SheetNames[0];
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
      const records = [], problems = [];
      raw.forEach((row, i) => {
        const lc = {};
        Object.keys(row).forEach((k) => { lc[k.trim().toLowerCase()] = row[k]; });
        const rec = {};
        for (const c of M.cols) {
          const hit = c.h.find((h) => lc[h] !== undefined);
          let v = hit ? lc[hit] : '';
          v = typeof v === 'string' ? v.trim() : v;
          if (c.bool) v = TRUE_WORDS.includes(String(v).toLowerCase());
          else if (c.num) v = v === '' ? (c.def ?? null) : Number(v);
          else if (c.k === 'type') v = String(v).toLowerCase() === 'service' ? 'Service' : 'Product';
          else v = v === '' ? null : String(v);
          rec[c.k] = v;
        }
        const missing = M.cols.filter((c) => c.required && (rec[c.k] === null || rec[c.k] === '')).map((c) => c.label);
        if (missing.length) { if (Object.values(lc).some((x) => x !== '')) problems.push(`Row ${i + 2}: missing ${missing.join(', ')}`); return; }
        if (rec.uoq !== undefined && !(rec.uoq > 0)) { problems.push(`Row ${i + 2}: UOQ must be above 0`); return; }
        records.push(rec);
      });
      const keys = new Set(); const unique = [];
      for (const r of records) { if (!keys.has(r[M.key])) { keys.add(r[M.key]); unique.push(r); } }
      const existing = new Set(rows.map((r) => r[M.key]));
      const updates = unique.filter((r) => existing.has(r[M.key])).length;
      const info = `<p>Sheet used: <b>${esc(name)}</b></p><p><b>${unique.length - updates}</b> new, <b>${updates}</b> existing (will be updated), <b>${problems.length}</b> skipped.</p>` +
        (problems.length ? `<ul class="plist">${problems.slice(0, 8).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '');
      if (!unique.length) return showInfo('Nothing to import', info);
      if (!(await confirmTwoStep({ title: 'Import ' + M.title + '?', message: info }))) return;
      for (let i = 0; i < unique.length; i += 400) {
        const { error } = await sb.from(M.table).upsert(unique.slice(i, i + 400), { onConflict: M.key });
        if (error) return toast('Import stopped: ' + error.message, 'error');
      }
      toast(`Imported ${unique.length} records`, 'ok');
    } catch (err) {
      toast('Could not read the file: ' + err.message, 'error');
    }
  };

  await load();
  watch(M.table, load);
}
