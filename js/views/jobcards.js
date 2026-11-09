import { sb, watch } from '../db.js';
import { getState } from '../auth.js';
import { esc, badge, fmtDate, fmtQty, toLocalInput, table, openForm, toast } from '../ui.js';
import { nextActions, advance, tokenState, progressBar, printDoc, printKV, printTable,
  atLoc, isWorkshopUser, inScope, fail } from '../doc.js';

export async function render(root, id) { return id ? detail(root, id) : list(root); }

// ===================== LIST (card deck) =====================
async function list(root) {
  const st = getState();
  root.innerHTML = `<div class="head"><h2>Job Cards</h2><div class="btns">
      <select id="fs"><option value="">All statuses</option>${['draft', 'pending_verification', 'confirmed', 'approved', 'closed', 'rejected']
        .map((s) => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select>
      <select id="ft"><option value="">All types</option><option value="vehicle">Vehicle-specific</option><option value="common">Common</option></select>
      <select id="so"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="no">Document no.</option></select>
      <input type="search" id="q" placeholder="Search no., vehicle, operator…">
      ${isWorkshopUser() ? '<button class="btn" id="new">+ New Job Card</button>' : ''}</div></div>
    <p class="muted" id="count"></p><div class="deck" id="deck"></div>`;
  let rows = [];

  function draw() {
    const q = root.querySelector('#q').value.trim().toLowerCase();
    const s = root.querySelector('#fs').value, t = root.querySelector('#ft').value, so = root.querySelector('#so').value;
    let r = rows.filter((x) => inScope(x.location_id) && (!s || x.status === s) && (!t || x.jc_type === t) &&
      (!q || [x.doc_no, x.vehicle?.vehicle_no, x.creator?.full_name, x.title].some((v) => String(v || '').toLowerCase().includes(q))));
    r.sort((a, b) => so === 'no' ? a.doc_no.localeCompare(b.doc_no) : so === 'old' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
    root.querySelector('#count').textContent = `${r.length} job card(s)`;
    root.querySelector('#deck').innerHTML = r.map((x) => `<a class="dcard s-${x.status}" href="#/jobcards/${x.id}">
      <div class="top"><b>${esc(x.doc_no)}</b>${badge(x.status)}</div>
      <div class="big">${x.jc_type === 'vehicle' ? esc(x.vehicle?.vehicle_no) + ' <small>' + esc(x.vehicle?.model || '') + '</small>' : 'Common Job Card'}</div>
      <small>${esc(x.title || '')}</small>
      <small>${esc(x.location?.code)} · ${esc(x.creator?.full_name || '—')} · ${fmtDate(x.created_at)}</small></a>`).join('') ||
      '<p class="muted">No job cards match.</p>';
  }
  async function load() {
    const { data, error } = await sb.from('job_cards')
      .select('*, vehicle:vehicles(vehicle_no,model), location:locations(code,name), creator:profiles!created_by(full_name)')
      .order('created_at', { ascending: false }).limit(500);
    if (error) return fail(error);
    rows = data; draw();
  }
  ['#fs', '#ft', '#so'].forEach((s) => (root.querySelector(s).onchange = draw));
  root.querySelector('#q').oninput = draw;

  const btn = root.querySelector('#new');
  if (btn) btn.onclick = async () => {
    const { data: veh } = await sb.from('vehicles').select('id,vehicle_no,model').eq('is_active', true).order('vehicle_no');
    const v = await openForm({ title: 'New Job Card', submitText: 'Create draft', fields: [
      { name: 'jc_type', label: 'Type', type: 'select', value: 'vehicle', options: [
        { value: 'vehicle', label: 'Vehicle-specific (one vehicle, full detail)' },
        { value: 'common', label: 'Common (many vehicles, consumables only)' }] },
      { name: 'vehicle_id', label: 'Vehicle (for vehicle-specific)', type: 'select', search: true,
        options: [{ value: '', label: '— choose —' }, ...(veh || []).map((x) => ({ value: x.id, label: `${x.vehicle_no} · ${x.model || ''}` }))] },
      { name: 'title', label: 'Title / short note' } ] });
    if (!v) return;
    if (v.jc_type === 'vehicle' && !v.vehicle_id) return toast('Choose a vehicle', 'error');
    const { data, error } = await sb.from('job_cards').insert({
      jc_type: v.jc_type, vehicle_id: v.jc_type === 'vehicle' ? v.vehicle_id : null, title: v.title, location_id: st.profile.location_id,
    }).select('id').single();
    if (error) return fail(error);
    location.hash = '#/jobcards/' + data.id;
  };
  await load();
  watch('job_cards', load);
}

// ===================== DETAIL =====================
async function detail(root, id) {
  const st = getState(), me = st.profile;
  async function load() {
    const [jc, comp, man, veh, sp, mrfs, emps] = await Promise.all([
      sb.from('job_cards').select('*, vehicle:vehicles(vehicle_no,model), location:locations(code,name), creator:profiles!created_by(full_name)').eq('id', id).maybeSingle(),
      sb.from('jc_complaints').select('*').eq('job_card_id', id).order('created_at'),
      sb.from('jc_manpower').select('*, emp:employees(emp_id,name)').eq('job_card_id', id).order('start_at'),
      sb.from('jc_vehicles').select('*, vehicle:vehicles(vehicle_no,model)').eq('job_card_id', id),
      sb.from('jc_spares').select('*, product:products(item_code,item_name,base_uom), vehicle:vehicles(vehicle_no)').eq('job_card_id', id).order('created_at'),
      sb.from('mrfs').select('id,doc_no,status').eq('job_card_id', id).order('created_at'),
      sb.from('employees').select('id,emp_id,name').eq('is_active', true).order('name'),
    ]);
    const j = jc.data;
    if (!j) { root.innerHTML = '<p class="err">Job card not found or not visible to you.</p>'; return; }
    const C = comp.data || [], M = man.data || [], V = veh.data || [], S = sp.data || [], R = mrfs.data || [];
    const ts = await tokenState('job_cards', j, j.location_id, j.location_id);
    const ed = ts.editable;
    const acts = nextActions(j.status, j.location_id, j.location_id);
    const common = j.jc_type === 'common';
    const addBtn = (a, t) => (ed ? `<button class="btn ghost sm" data-add="${a}">${t}</button>` : '');
    const editLink = (k, i) => (ed ? `<button class="link" data-edit="${k}" data-id="${i}">Edit</button>` : '');

    root.innerHTML = `
      <p><a href="#/jobcards" class="link">← Job Cards</a></p>
      <div class="head"><h2>${esc(j.doc_no)} ${badge(j.status)}</h2><div class="btns">
        ${acts.map((a) => `<button class="btn ${a.danger ? 'danger' : ''}" data-to="${a.to}">${a.label}</button>`).join('')}
        ${atLoc(j.location_id) && !['closed', 'rejected'].includes(j.status) ? '<button class="btn ghost" id="mrf">Request materials (MRF)</button>' : ''}
        <button class="btn ghost" id="print">Print</button></div></div>
      ${progressBar(j.status)}${ts.html}
      <div class="panel wide kv">
        <div><small>Type</small><b>${common ? 'Common Job Card' : 'Vehicle-specific'}</b></div>
        <div><small>Vehicle</small><b>${common ? 'Multiple (see below)' : esc(j.vehicle?.vehicle_no) + ' · ' + esc(j.vehicle?.model || '')}</b></div>
        <div><small>Workshop</small><b>${esc(j.location?.code)} · ${esc(j.location?.name)}</b></div>
        <div><small>Created</small><b>${fmtDate(j.created_at)} · ${esc(j.creator?.full_name || '—')}</b></div>
        <div><small>Note</small><b>${esc(j.title || '—')}</b></div></div>

      ${common ? `<h3>Vehicles on this card ${addBtn('veh', '+ Link vehicle')}</h3>${table(['Vehicle', 'Model'],
        V.map((x) => `<tr><td>${esc(x.vehicle?.vehicle_no)}</td><td>${esc(x.vehicle?.model || '')}</td></tr>`), 'No vehicles linked')}` : ''}

      ${!common ? `<h3>Complaints ${addBtn('comp', '+ Add complaint')}</h3>${table(['Complaint', 'Action taken', ''],
        C.map((x) => `<tr><td class="wrap">${esc(x.complaint)}</td><td class="wrap">${esc(x.action_taken || '')}</td><td>${editLink('comp', x.id)}</td></tr>`), 'No complaints logged')}` : ''}

      <h3>Manpower ${addBtn('man', '+ Add manpower')}</h3>${table(['Employee', 'Start', 'End', 'Hours', ''],
        M.map((x) => `<tr><td>${esc(x.emp?.emp_id)} · ${esc(x.emp?.name)}</td><td>${fmtDate(x.start_at)}</td><td>${fmtDate(x.end_at)}</td>
          <td>${((new Date(x.end_at) - new Date(x.start_at)) / 3600000).toFixed(2)}</td><td>${editLink('man', x.id)}</td></tr>`), 'No manpower logged')}

      <h3>Spares ${addBtn('sp', '+ Add spare')}</h3>${table([...(common ? ['Vehicle'] : []), 'Item', 'Qty (base UOM)', 'Source', ''],
        S.map((x) => `<tr>${common ? `<td>${esc(x.vehicle?.vehicle_no || '')}</td>` : ''}<td>${esc(x.product?.item_code)} · ${esc(x.product?.item_name)}</td>
          <td>${fmtQty(x.qty)} ${esc(x.product?.base_uom || '')}</td><td>${x.source === 'mrf' ? 'MRF-sourced' : 'Existing stock'}</td><td>${editLink('sp', x.id)}</td></tr>`), 'No spares attached')}
      ${common ? '<p class="muted">Only whitelisted consumables (oils, coolants, small fasteners) can be attached to a Common Job Card.</p>' : ''}

      <h3>Material requests</h3>${table(['MRF', 'Status'], R.map((x) => `<tr><td><a class="link" href="#/mrfs/${x.id}">${esc(x.doc_no)}</a></td><td>${badge(x.status)}</td></tr>`), 'None raised')}
      ${ed ? '<p class="muted">Lines cannot be deleted (audit rule). Edit a wrong line instead.</p>' : ''}`;

    ts.bind(root, load);
    root.querySelectorAll('[data-to]').forEach((b) => (b.onclick = async () => {
      const act = acts.find((a) => a.to === b.dataset.to);
      if (await advance('job_cards', id, act)) load();
    }));
    root.querySelector('#print').onclick = () => printDoc(`Job Card ${j.doc_no}`,
      printKV([['Status', j.status], ['Type', j.jc_type], ['Vehicle', common ? V.map((x) => x.vehicle?.vehicle_no).join(', ') : j.vehicle?.vehicle_no],
        ['Workshop', `${j.location?.code} ${j.location?.name}`], ['Created', fmtDate(j.created_at)], ['Note', j.title]]) +
      (C.length ? '<h3>Complaints</h3>' + printTable(['Complaint', 'Action taken'], C.map((x) => [x.complaint, x.action_taken])) : '') +
      '<h3>Manpower</h3>' + printTable(['Employee', 'Start', 'End'], M.map((x) => [`${x.emp?.emp_id} ${x.emp?.name}`, fmtDate(x.start_at), fmtDate(x.end_at)])) +
      '<h3>Spares</h3>' + printTable([...(common ? ['Vehicle'] : []), 'Item', 'Qty', 'Source'],
        S.map((x) => [...(common ? [x.vehicle?.vehicle_no] : []), `${x.product?.item_code} ${x.product?.item_name}`, `${fmtQty(x.qty)} ${x.product?.base_uom}`, x.source])));
    const mrfBtn = root.querySelector('#mrf');
    if (mrfBtn) mrfBtn.onclick = () => (location.hash = '#/mrfs/new/' + id);
    if (!ed) return;

    const find = (arr, k) => arr.find((z) => z.id === k);
    root.querySelectorAll('[data-add],[data-edit]').forEach((b) => (b.onclick = async () => {
      const kind = b.dataset.add || b.dataset.edit, editing = !!b.dataset.edit;
      let table_, payload, row;
      if (kind === 'veh') {
        const { data: all } = await sb.from('vehicles').select('id,vehicle_no,model').eq('is_active', true).order('vehicle_no');
        const v = await openForm({ title: 'Link vehicle', fields: [{ name: 'vehicle_id', label: 'Vehicle', type: 'select', search: true, required: true,
          options: [{ value: '', label: '— choose —' }, ...(all || []).map((x) => ({ value: x.id, label: `${x.vehicle_no} · ${x.model || ''}` }))] }] });
        if (!v) return;
        const { error } = await sb.from('jc_vehicles').insert({ job_card_id: id, vehicle_id: v.vehicle_id });
        return error ? fail(error) : load();
      }
      if (kind === 'comp') {
        row = editing ? find(C, b.dataset.id) : {};
        const v = await openForm({ title: 'Complaint', fields: [
          { name: 'complaint', label: 'Complaint', type: 'textarea', required: true, value: row.complaint },
          { name: 'action_taken', label: 'Action taken', type: 'textarea', value: row.action_taken }] });
        if (!v) return;
        const { error } = editing ? await sb.from('jc_complaints').update(v).eq('id', row.id) : await sb.from('jc_complaints').insert({ ...v, job_card_id: id });
        return error ? fail(error) : load();
      }
      if (kind === 'man') {
        row = editing ? find(M, b.dataset.id) : {};
        const v = await openForm({ title: 'Manpower', fields: [
          { name: 'employee_id', label: 'Employee (Employee Master)', type: 'select', search: true, required: true, value: row.employee_id,
            options: [{ value: '', label: '— choose —' }, ...(emps.data || []).map((e) => ({ value: e.id, label: `${e.emp_id} · ${e.name}` }))] },
          { name: 'start_at', label: 'Start', type: 'datetime-local', required: true, value: row.start_at ? toLocalInput(row.start_at) : '' },
          { name: 'end_at', label: 'End', type: 'datetime-local', required: true, value: row.end_at ? toLocalInput(row.end_at) : '' }] });
        if (!v) return;
        v.start_at = new Date(v.start_at).toISOString(); v.end_at = new Date(v.end_at).toISOString();
        const { error } = editing ? await sb.from('jc_manpower').update(v).eq('id', row.id) : await sb.from('jc_manpower').insert({ ...v, job_card_id: id });
        return error ? fail(error) : load();
      }
      if (kind === 'sp') {
        row = editing ? find(S, b.dataset.id) : {};
        if (editing) {
          const v = await openForm({ title: 'Edit quantity', fields: [{ name: 'qty', label: `Quantity (${row.product?.base_uom || ''})`, type: 'number', required: true, value: row.qty }] });
          if (!v) return;
          const { error } = await sb.from('jc_spares').update({ qty: v.qty }).eq('id', row.id);
          return error ? fail(error) : load();
        }
        // received (MRF-sourced) items + floor stock
        const { data: recv } = await sb.from('dc_items')
          .select('id,qty_received,qty_absorbed,line_status,product:products(item_code,item_name,base_uom,common_jc_allowed),dc:delivery_challans!inner(doc_no,mrf:mrfs!inner(job_card_id))')
          .in('line_status', ['matched', 'accepted']).eq('dc.mrf.job_card_id', id);
        const { data: fl } = await sb.from('floor_stock').select('product_id,qty_base,product:products(item_code,item_name,base_uom,common_jc_allowed)').eq('workshop_id', j.location_id).gt('qty_base', 0);
        const okP = (p) => !common || p?.common_jc_allowed;
        const usedMap = {}; S.forEach((x) => { if (x.dc_item_id) usedMap[x.dc_item_id] = (usedMap[x.dc_item_id] || 0) + Number(x.qty); });
        const opts = [{ value: '', label: '— choose item —' },
          ...(recv || []).filter((r) => okP(r.product)).map((r) => ({ value: 'mrf:' + r.id,
            label: `MRF · ${r.product.item_code} ${r.product.item_name} (${r.dc.doc_no}) — available ${fmtQty(r.qty_received - r.qty_absorbed - (usedMap[r.id] || 0))} ${r.product.base_uom}` })),
          ...(fl || []).filter((r) => okP(r.product)).map((r) => ({ value: 'ex:' + r.product_id,
            label: `Existing stock · ${r.product.item_code} ${r.product.item_name} — ${fmtQty(r.qty_base)} ${r.product.base_uom}` }))];
        const f = [{ name: 'item', label: 'Spare', type: 'select', required: true, search: true, options: opts }];
        if (common) f.push({ name: 'vehicle_id', label: 'For vehicle', type: 'select', required: true,
          options: [{ value: '', label: '— choose —' }, ...V.map((x) => ({ value: x.vehicle_id, label: x.vehicle?.vehicle_no }))] });
        f.push({ name: 'qty', label: 'Quantity (base UOM)', type: 'number', required: true });
        if (opts.length === 1) return toast(common ? 'No whitelisted consumables are available (received via MRF or in Floor Stock).' : 'Nothing available: receive items through an MRF/Challan, or add Floor Stock.', 'error');
        const v = await openForm({ title: 'Add spare', fields: f });
        if (!v) return;
        const [src, key] = v.item.split(':');
        const { error } = await sb.from('jc_spares').insert({ job_card_id: id, qty: v.qty, vehicle_id: v.vehicle_id || null,
          source: src === 'mrf' ? 'mrf' : 'existing', dc_item_id: src === 'mrf' ? key : null, product_id: src === 'ex' ? key : null });
        return error ? fail(error) : load();
      }
    }));
  }
  await load();
  ['job_cards', 'jc_spares', 'jc_complaints', 'jc_manpower', 'jc_vehicles', 'reversal_tokens', 'mrfs'].forEach((t) => watch(t, load));
}
