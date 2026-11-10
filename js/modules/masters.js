// Masters: Products (spare parts), Vehicles, Employees
import { sb, S, run, reload, isAdmin, isStore, isManager, isWs, myWorkshopId, wsName, dropdown, fetchAll } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, toggle, checkbox, act, toast, activeBadge, badge, confirmBox, banner, sectionTitle, errMsg } from '../core/ui.js';
import { selectBox, strOpts, opts } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { fmtNum, fmtDateTime, num, downloadFile, toCSV } from '../core/format.js';

const canEditProducts = () => isAdmin() || isStore();

/* =================================================================== PRODUCTS */
export async function products() {
  const root = h('div');
  const tbl = dataTable({
    exportName: 'products', searchPlaceholder: 'Search code, description, brand, part no...',
    defaultSort: { key: 'item_code', dir: 'asc' },
    rowClass: (r) => (r.status === 'inactive' ? 'row-muted' : ''),
    filters: [
      { key: 'status', label: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      { key: 'spare_type', label: 'All types' }, { key: 'category', label: 'All categories' }, { key: 'brand', label: 'All brands' },
    ],
    columns: [
      { key: 'ic', label: '', sortable: false, exportable: false, render: () => h('div', { class: 'cell-icon' }, icon('package')) },
      { key: 'item_code', label: 'Item code', sticky: false, render: (r) => h('span', { class: 'cell-main mono' }, r.item_code) },
      { key: 'description', label: 'Description', render: (r) => h('div', null, h('div', { class: 'cell-main' }, r.description), (r.model_ref || r.part_no) ? h('div', { class: 'cell-sub' }, [r.model_ref && `Model ${r.model_ref}`, r.part_no && `Part ${r.part_no}`].filter(Boolean).join(' · ')) : null) },
      { key: 'brand', label: 'Brand' },
      { key: 'spare_type', label: 'Type', render: (r) => (r.spare_type ? badge(r.spare_type, r.spare_type === 'Original' ? 'info' : r.spare_type === 'Refurbished' ? 'purple' : 'muted', true) : '—') },
      { key: 'category', label: 'Category' },
      { key: 'hsn', label: 'HSN' },
      { key: 'uom', label: 'Issue UOM / Pack', value: (r) => `${r.uom} ${r.pack_qty}`, render: (r) => h('div', null, h('div', { class: 'cell-main' }, r.uom), h('div', { class: 'cell-sub' }, `${fmtNum(r.pack_qty)} ${r.base_uom} per ${r.uom}`)) },
      { key: 'allow_decimal', label: 'Decimal use', value: (r) => (r.allow_decimal ? 'Yes' : 'No'), render: (r) => (r.allow_decimal ? badge('Yes', 'teal', true) : badge('No', 'muted', true)) },
      { key: 'gst_pct', label: 'GST %', num: true, render: (r) => `${fmtNum(r.gst_pct, 2)}%` },
      { key: 'min_stock', label: 'Min stock', num: true, render: (r) => fmtNum(r.min_stock) },
      { key: 'status', label: 'Status', render: (r) => activeBadge(r.status === 'active') },
      { key: 'updated_at', label: 'Last change', render: (r) => h('div', { class: 'small' }, fmtDateTime(r.updated_at)) },
      { key: 'act', label: '', sortable: false, exportable: false, render: (r) => canEditProducts() ? h('div', { class: 'actions' }, iconBtn('edit', 'Edit', () => productForm(r))) : null },
    ],
    onRowClick: canEditProducts() ? (r) => productForm(r) : null,
    empty: { icon: 'package', title: 'No spare parts yet', text: 'Create every product here before it can be received on an inward.' },
    toolbar: canEditProducts() ? [btn('Import Excel', { cls: 'sm', icon: 'upload', onClick: importDialog }), btn('New product', { cls: 'primary sm', icon: 'plus', onClick: () => productForm() })] : [],
  });
  const load = async () => { await reload('products'); tbl.setRows(S.products); };
  root.append(pageHead({ title: 'Spare Parts', sub: 'Create every product here before it can be received on an inward.' }), h('div', { class: 'card' }, tbl.el));
  tbl.setRows(S.products);
  return { el: root, refresh: load };

  async function productForm(p) {
    const edit = !!p; const d = p ? { ...p } : { item_code: '', description: '', brand: '', spare_type: null, category: '', part_no: '', model_ref: '', hsn: '', uom: 'Nos', pack_qty: 1, base_uom: 'Nos', allow_decimal: false, gst_pct: 0, min_stock: 0, status: 'active' };
    let locked = false;
    if (edit) {
      const [a, b] = await Promise.all([
        sb.from('stock_ledger').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
        sb.from('dc_lines').select('id', { count: 'exact', head: true }).eq('product_id', p.id)]);
      locked = (a.count || 0) + (b.count || 0) > 0;
    }
    const code = inp({ value: d.item_code, disabled: locked, placeholder: 'e.g. UN00001', style: { textTransform: 'uppercase' } });
    const desc = inp({ value: d.description, disabled: locked });
    const brand = inp({ value: d.brand || '' }); const cat = inp({ value: d.category || '', list: 'cat-list' });
    const catList = h('datalist', { id: 'cat-list' }, [...new Set(S.products.map((x) => x.category).filter(Boolean))].map((c) => h('option', { value: c })));
    const part = inp({ value: d.part_no || '' }); const model = inp({ value: d.model_ref || '' }); const hsn = inp({ value: d.hsn || '' });
    const type = selectBox({ options: strOpts(dropdown('spare_type')), value: d.spare_type, placeholder: 'Select type' });
    const uom = selectBox({ options: strOpts(dropdown('uom')), value: d.uom, clearable: false });
    const baseUom = selectBox({ options: strOpts(dropdown('base_uom')), value: d.base_uom, clearable: false });
    const pack = inp({ type: 'number', min: '0.001', step: 'any', value: d.pack_qty });
    const dec = checkbox('Allow decimal quantity in consumption', { checked: d.allow_decimal });
    const gst = inp({ type: 'number', min: '0', step: '0.01', value: d.gst_pct }); const minS = inp({ type: 'number', min: '0', step: 'any', value: d.min_stock });
    const status = toggle({ checked: d.status === 'active' });
    const hint = h('div', { class: 'small muted' });
    const upd = () => { hint.textContent = `Stores issue in ${uom.getValue() || '…'}. 1 ${uom.getValue() || 'unit'} = ${pack.value || 1} ${baseUom.getValue() || ''}. Workshop stock and consumption are tracked in ${baseUom.getValue() || 'base unit'}.`; };
    pack.addEventListener('input', upd); upd(); uom.addEventListener('click', () => setTimeout(upd, 300)); baseUom.addEventListener('click', () => setTimeout(upd, 300));
    const m = modal({
      title: edit ? `Edit ${p.item_code}` : 'New product', size: 'md',
      content: h('div', { class: 'col' },
        locked ? banner('info', h('span', null, h('b', null, 'Item code and description are locked'), ' because this item has already been issued / stocked. You can still change UOM, pack quantity and the other fields.')) : null,
        h('div', { class: 'form-grid' },
          field('Item code', code, { required: true }), field('Description', desc, { required: true, cls: 'span2' }),
          field('Brand', brand), field('Spare type', type), field('Category', cat), catList,
          field('Part no.', part), field('Model / reference', model), field('HSN', hsn)),
        sectionTitle('Units & stock rules'),
        h('div', { class: 'form-grid' },
          field('Issue UOM (stores hand over)', uom, { required: true }), field('Base units per issue UOM (UOQ)', pack, { required: true }), field('Consumption unit', baseUom, { required: true }),
          field('GST %', gst), field('Minimum stock (base unit)', minS), h('div', { class: 'field', style: { justifyContent: 'end' } }, dec)),
        hint,
        h('div', { class: 'row' }, h('span', { class: 'bold' }, 'Active'), status)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn(edit ? 'Save changes' : 'Create product', { cls: 'primary', onClick: act(async () => {
        const row = { item_code: code.value.trim().toUpperCase(), description: desc.value.trim(), brand: brand.value.trim() || null, spare_type: type.getValue(), category: cat.value.trim() || null,
          part_no: part.value.trim() || null, model_ref: model.value.trim() || null, hsn: hsn.value.trim() || null, uom: uom.getValue(), pack_qty: num(pack.value, 0), base_uom: baseUom.getValue(),
          allow_decimal: dec.querySelector('input').checked, gst_pct: num(gst.value), min_stock: num(minS.value), status: status.querySelector('input').checked ? 'active' : 'inactive' };
        if (!row.item_code || !row.description) throw new Error('Item code and description are required');
        if (!(row.pack_qty > 0)) throw new Error('Base units per issue UOM must be greater than zero');
        if (locked) { delete row.item_code; delete row.description; }
        if (edit) await run(sb.from('products').update(row).eq('id', p.id)); else await run(sb.from('products').insert(row));
        toast(edit ? 'Product updated' : 'Product created'); m.close(); await load();
      }) })],
    });
  }

  async function importDialog() {
    const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'input', style: { height: 'auto', padding: '8px' } });
    const out = h('div');
    let parsed = [];
    const headers = ['item_code', 'description', 'brand', 'spare_type', 'category', 'part_no', 'model_ref', 'hsn', 'uom', 'pack_qty', 'base_uom', 'allow_decimal', 'gst_pct', 'min_stock'];
    const m = modal({
      title: 'Import products from Excel / CSV', size: 'md',
      content: h('div', { class: 'col' },
        banner('info', h('span', null, 'First row must contain these headings: ', h('code', null, headers.join(', ')), '. Existing item codes are skipped. ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); downloadFile('products-template.csv', toCSV([headers, ['SAMPLE-001', 'Sample item', 'GEN', 'Original', 'General', '', '', '', 'Nos', 1, 'Nos', 'no', 18, 0]])); } }, 'Download template'))),
        field('Choose file', file), out),
      foot: [btn('Close', { cls: '', onClick: () => m.close() }), btn('Import', { cls: 'primary', onClick: act(async () => {
        if (!parsed.length) throw new Error('Choose a file first');
        const have = new Set(S.products.map((x) => x.item_code)); let ok = 0; const skipped = []; const failed = [];
        for (const r of parsed) {
          if (have.has(r.item_code)) { skipped.push(r.item_code); continue; }
          try { await run(sb.from('products').insert(r)); ok++; have.add(r.item_code); } catch (e) { failed.push(`${r.item_code}: ${errMsg(e)}`); }
        }
        await load();
        out.replaceChildren(banner(failed.length ? 'warn' : 'ok', h('div', null, h('b', null, `${ok} imported`), `, ${skipped.length} skipped (already exist), ${failed.length} failed.`, failed.length ? h('ul', null, failed.slice(0, 8).map((f) => h('li', null, f))) : null)));
        parsed = [];
      }) })],
    });
    file.addEventListener('change', async () => {
      out.replaceChildren(); parsed = [];
      const f = file.files[0]; if (!f) return;
      try {
        if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader (check internet)')); document.head.appendChild(s); });
        const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        const norm = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const alias = { itemcode: 'item_code', item_code: 'item_code', code: 'item_code', description: 'description', uom: 'uom', pack: 'pack_qty', uoq: 'pack_qty', type: 'spare_type', gst: 'gst_pct', gst_: 'gst_pct', min_stock: 'min_stock', part: 'part_no', model: 'model_ref' };
        parsed = rows.map((r) => {
          const o = {}; Object.entries(r).forEach(([k, v]) => { const nk = alias[norm(k)] || norm(k); if (headers.includes(nk)) o[nk] = v; });
          if (!o.item_code || !o.description) return null;
          return { item_code: String(o.item_code).trim().toUpperCase(), description: String(o.description).trim(), brand: o.brand || null, spare_type: o.spare_type || null, category: o.category || null, part_no: o.part_no || null,
            model_ref: o.model_ref || null, hsn: o.hsn || null, uom: o.uom || 'Nos', pack_qty: num(o.pack_qty, 1) || 1, base_uom: o.base_uom || 'Nos', allow_decimal: /^(y|yes|true|1)$/i.test(String(o.allow_decimal)), gst_pct: num(String(o.gst_pct).replace('%', '')), min_stock: num(o.min_stock) };
        }).filter(Boolean);
        out.replaceChildren(banner(parsed.length ? 'ok' : 'warn', parsed.length ? `${parsed.length} product row(s) ready to import.` : 'No valid rows found (item_code and description are required).'));
      } catch (e) { out.replaceChildren(banner('danger', errMsg(e))); }
    });
  }
}

/* =================================================================== VEHICLES */
export async function vehicles() {
  const canEdit = isAdmin() || isManager();
  const root = h('div');
  const tbl = dataTable({
    exportName: 'vehicles', searchPlaceholder: 'Search registration, fleet no, make, model...',
    defaultSort: { key: 'reg_no', dir: 'asc' }, rowClass: (r) => (r.active ? '' : 'row-muted'),
    filters: [{ key: 'vehicle_type', label: 'All vehicle types' }, { key: 'make', label: 'All makes' }, { key: 'active', label: 'All statuses', value: (r) => (r.active ? 'Active' : 'Inactive') }],
    columns: [
      { key: 'reg_no', label: 'Reg. no', render: (r) => h('span', { class: 'cell-main mono' }, r.reg_no) },
      { key: 'fleet_no', label: 'Fleet no' }, { key: 'vehicle_type', label: 'Type' },
      { key: 'make', label: 'Make / model', value: (r) => [r.make, r.model].filter(Boolean).join(' ') },
      { key: 'year', label: 'Year' },
      { key: 'home_workshop_id', label: 'Home workshop', value: (r) => wsName(r.home_workshop_id) },
      { key: 'readings', label: 'Readings required', value: (r) => [r.has_odometer && 'Odometer', r.has_engine_hour && 'Engine hr', r.has_aux_hour && 'Aux hr'].filter(Boolean).join(', '),
        render: (r) => h('div', { class: 'row', style: { gap: '4px' } }, r.has_odometer ? badge('Odometer', 'info', true) : null, r.has_engine_hour ? badge('Engine hr', 'teal', true) : null, r.has_aux_hour ? badge('Aux hr', 'purple', true) : null) },
      { key: 'active', label: 'Status', value: (r) => (r.active ? 'Active' : 'Inactive'), render: (r) => activeBadge(r.active) },
      { key: 'act', label: '', sortable: false, exportable: false, render: (r) => (canEdit ? h('div', { class: 'actions' }, iconBtn('edit', 'Edit', () => form(r))) : null) },
    ],
    onRowClick: canEdit ? (r) => form(r) : null,
    toolbar: canEdit ? [btn('New vehicle', { cls: 'primary sm', icon: 'plus', onClick: () => form() })] : [],
    empty: { icon: 'truck', title: 'No vehicles yet', text: 'Add the company vehicles so job cards can be raised for them.' },
  });
  const load = async () => { await reload('vehicles'); tbl.setRows(S.vehicles); };
  root.append(pageHead({ title: 'Vehicle Master', sub: 'Which readings are needed is decided here, per vehicle.' }), h('div', { class: 'card' }, tbl.el));
  tbl.setRows(S.vehicles);
  return { el: root, refresh: load };

  function form(v) {
    const edit = !!v; const d = v || { reg_no: '', active: true, has_odometer: true, has_engine_hour: false, has_aux_hour: false };
    const reg = inp({ value: d.reg_no, style: { textTransform: 'uppercase' } }); const fleet = inp({ value: d.fleet_no || '' });
    const type = selectBox({ options: strOpts(dropdown('vehicle_type')), value: d.vehicle_type, placeholder: 'Select type' });
    const make = inp({ value: d.make || '' }); const model = inp({ value: d.model || '' }); const year = inp({ type: 'number', min: '1980', max: '2100', value: d.year || '' });
    const chassis = inp({ value: d.chassis_no || '' }); const engine = inp({ value: d.engine_no || '' });
    const home = selectBox({ options: opts(S.workshops.filter((w) => w.active), (x) => x.id, (x) => x.name), value: d.home_workshop_id, placeholder: 'Any workshop' });
    const odo = checkbox('Odometer', { checked: d.has_odometer }); const eh = checkbox('Engine hour', { checked: d.has_engine_hour }); const ah = checkbox('Auxiliary hour', { checked: d.has_aux_hour });
    const act_ = toggle({ checked: d.active });
    const m = modal({
      title: edit ? `Edit ${v.reg_no}` : 'New vehicle', size: 'md',
      content: h('div', { class: 'col' },
        h('div', { class: 'form-grid' }, field('Registration no.', reg, { required: true }), field('Fleet no.', fleet), field('Vehicle type', type), field('Make', make), field('Model', model), field('Year', year), field('Chassis no.', chassis), field('Engine no.', engine), field('Home workshop', home)),
        sectionTitle('Readings required on the job card'), h('div', { class: 'row gap-lg' }, odo, eh, ah),
        h('div', { class: 'small muted' }, 'Only the ticked readings appear on the job card and are mandatory for this vehicle.'),
        h('div', { class: 'row' }, h('span', { class: 'bold' }, 'Active'), act_)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Save', { cls: 'primary', onClick: act(async () => {
        const row = { reg_no: reg.value.trim().toUpperCase(), fleet_no: fleet.value.trim() || null, vehicle_type: type.getValue(), make: make.value.trim() || null, model: model.value.trim() || null,
          year: year.value ? parseInt(year.value, 10) : null, chassis_no: chassis.value.trim() || null, engine_no: engine.value.trim() || null, home_workshop_id: home.getValue(),
          has_odometer: odo.querySelector('input').checked, has_engine_hour: eh.querySelector('input').checked, has_aux_hour: ah.querySelector('input').checked, active: act_.querySelector('input').checked };
        if (!row.reg_no) throw new Error('Registration number is required');
        if (!row.has_odometer && !row.has_engine_hour && !row.has_aux_hour) throw new Error('Tick at least one reading');
        if (edit) await run(sb.from('vehicles').update(row).eq('id', v.id)); else await run(sb.from('vehicles').insert(row));
        toast('Vehicle saved'); m.close(); await load();
      }) })],
    });
  }
}

/* =================================================================== EMPLOYEES */
export async function employees() {
  const canEdit = isAdmin() || isManager();
  const root = h('div');
  const tbl = dataTable({
    exportName: 'employees', defaultSort: { key: 'name', dir: 'asc' }, rowClass: (r) => (r.active ? '' : 'row-muted'),
    filters: isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : [],
    columns: [
      { key: 'emp_code', label: 'Emp code', render: (r) => h('span', { class: 'cell-main mono' }, r.emp_code) },
      { key: 'name', label: 'Name', render: (r) => h('span', { class: 'cell-main' }, r.name) },
      { key: 'designation', label: 'Designation' }, { key: 'phone', label: 'Phone' },
      { key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) },
      { key: 'active', label: 'Status', value: (r) => (r.active ? 'Active' : 'Inactive'), render: (r) => activeBadge(r.active) },
      { key: 'act', label: '', sortable: false, exportable: false, render: (r) => (canEdit ? h('div', { class: 'actions' }, iconBtn('edit', 'Edit', () => form(r))) : null) },
    ],
    onRowClick: canEdit ? (r) => form(r) : null,
    toolbar: canEdit ? [btn('New employee', { cls: 'primary sm', icon: 'plus', onClick: () => form() })] : [],
    empty: { icon: 'users', title: 'No employees yet', text: 'Add the mechanics and helpers who work on job cards.' },
  });
  const mine = () => (isAdmin() ? S.employees : S.employees.filter((e) => e.workshop_id === myWorkshopId()));
  const load = async () => { await reload('employees'); tbl.setRows(mine()); };
  root.append(pageHead({ title: 'Employee Master', sub: 'Man-hours on a job card can only be booked to employees of the same workshop.' }), h('div', { class: 'card' }, tbl.el));
  tbl.setRows(mine());
  return { el: root, refresh: load };

  function form(e) {
    const edit = !!e; const d = e || { active: true };
    const wsel = selectBox({ options: S.workshops.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name })), value: d.workshop_id || myWorkshopId(), disabled: !isAdmin() || edit, clearable: false });
    const code = inp({ value: d.emp_code || '' }); const name = inp({ value: d.name || '' }); const des = inp({ value: d.designation || '' }); const ph = inp({ value: d.phone || '' });
    const a = toggle({ checked: d.active });
    const m = modal({
      title: edit ? `Edit ${e.name}` : 'New employee',
      content: h('div', { class: 'form-grid' }, field('Workshop', wsel, { required: true }), field('Employee code', code, { required: true }), field('Name', name, { required: true }), field('Designation', des), field('Phone', ph), h('div', { class: 'field' }, h('label', null, 'Active'), a)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Save', { cls: 'primary', onClick: act(async () => {
        const row = { workshop_id: wsel.getValue(), emp_code: code.value.trim(), name: name.value.trim(), designation: des.value.trim() || null, phone: ph.value.trim() || null, active: a.querySelector('input').checked };
        if (!row.workshop_id || !row.emp_code || !row.name) throw new Error('Workshop, code and name are required');
        if (edit) await run(sb.from('employees').update(row).eq('id', e.id)); else await run(sb.from('employees').insert(row));
        toast('Employee saved'); m.close(); await load();
      }) })],
    });
  }
}
