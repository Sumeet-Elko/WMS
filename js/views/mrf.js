import { sb, watch } from '../db.js';
import { getState } from '../auth.js';
import { esc, badge, fmtDate, fmtQty, table, openForm, toast } from '../ui.js';
import { nextActions, advance, tokenState, progressBar, printDoc, printKV, printTable,
  atLoc, isWorkshopUser, isStoreUser, inScope, fail } from '../doc.js';

const SEL = '*, workshop:locations!workshop_id(code,name), store:locations!store_id(code,name), jc:job_cards(doc_no,status,jc_type), creator:profiles!created_by(full_name)';

export async function render(root, id, extra) {
  if (id === 'new') return create(extra);
  return id ? detail(root, id) : list(root);
}

// ---------- create (always tied to a Job Card + a Store) ----------
async function create(jcId) {
  const me = getState().profile;
  if (!isWorkshopUser()) { toast('Only workshop users raise MRFs', 'error'); return (location.hash = '#/mrfs'); }
  const [{ data: jcs }, { data: stores }] = await Promise.all([
    sb.from('job_cards').select('id,doc_no,jc_type,vehicle:vehicles(vehicle_no),status').eq('location_id', me.location_id).not('status', 'in', '(closed,rejected)').order('created_at', { ascending: false }),
    sb.from('locations').select('id,code,name').eq('type', 'store').eq('is_active', true).order('code'),
  ]);
  const v = await openForm({ title: 'New Material Request (MRF)', submitText: 'Create draft', fields: [
    { name: 'job_card_id', label: 'Active Job Card', type: 'select', required: true, value: jcId || '', search: true,
      options: [{ value: '', label: '— choose —' }, ...(jcs || []).map((j) => ({ value: j.id, label: `${j.doc_no} · ${j.jc_type === 'common' ? 'Common' : j.vehicle?.vehicle_no} (${j.status.replace('_', ' ')})` }))] },
    { name: 'store_id', label: 'Request from Store', type: 'select', required: true,
      options: [{ value: '', label: '— choose —' }, ...(stores || []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))] },
    { name: 'remarks', label: 'Remarks', type: 'textarea' }] });
  if (!v) return (location.hash = jcId ? '#/jobcards/' + jcId : '#/mrfs');
  const { data, error } = await sb.from('mrfs').insert({ ...v, workshop_id: me.location_id }).select('id').single();
  if (error) { fail(error); return (location.hash = '#/mrfs'); }
  location.hash = '#/mrfs/' + data.id;
}

// ---------- list ----------
async function list(root) {
  root.innerHTML = `<div class="head"><h2>Material Requests (MRF)</h2><div class="btns">
    <select id="fs"><option value="">All statuses</option>${['draft', 'pending_verification', 'confirmed', 'approved', 'closed', 'rejected']
      .map((s) => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select>
    <input type="search" id="q" placeholder="Search…">
    ${isWorkshopUser() ? '<button class="btn" id="new">+ New MRF</button>' : ''}</div></div>
    <p class="muted" id="count"></p><div class="deck" id="deck"></div>`;
  let rows = [];
  function draw() {
    const q = root.querySelector('#q').value.trim().toLowerCase(), s = root.querySelector('#fs').value;
    const r = rows.filter((x) => inScope(x.workshop_id, x.store_id) && (!s || x.status === s) &&
      (!q || [x.doc_no, x.jc?.doc_no, x.workshop?.code, x.store?.code].some((v) => String(v || '').toLowerCase().includes(q))));
    root.querySelector('#count').textContent = `${r.length} request(s)`;
    root.querySelector('#deck').innerHTML = r.map((x) => `<a class="dcard s-${x.status}" href="#/mrfs/${x.id}">
      <div class="top"><b>${esc(x.doc_no)}</b>${badge(x.status)}</div>
      <div class="big">${esc(x.workshop?.code)} → ${esc(x.store?.code)}</div>
      <small>Job Card ${esc(x.jc?.doc_no)}</small><small>${fmtDate(x.created_at)} · ${esc(x.creator?.full_name || '—')}</small></a>`).join('') || '<p class="muted">No requests.</p>';
  }
  async function load() {
    const { data, error } = await sb.from('mrfs').select(SEL).order('created_at', { ascending: false }).limit(500);
    if (error) return fail(error);
    rows = data; draw();
  }
  root.querySelector('#fs').onchange = draw; root.querySelector('#q').oninput = draw;
  const b = root.querySelector('#new'); if (b) b.onclick = () => create();
  await load();
  watch('mrfs', load);
}

// ---------- detail ----------
async function detail(root, id) {
  async function load() {
    const [m, it, dcs] = await Promise.all([
      sb.from('mrfs').select(SEL).eq('id', id).maybeSingle(),
      sb.from('mrf_items').select('*').eq('mrf_id', id).order('created_at'),
      sb.from('delivery_challans').select('id,doc_no,status').eq('mrf_id', id).order('created_at'),
    ]);
    const x = m.data;
    if (!x) { root.innerHTML = '<p class="err">MRF not found or not visible to you.</p>'; return; }
    const I = it.data || [], D = dcs.data || [];
    const ts = await tokenState('mrfs', x, x.workshop_id, x.store_id);
    const ed = ts.editable;
    const acts = nextActions(x.status, x.workshop_id, x.store_id);
    const canDC = x.status === 'approved' && atLoc(x.store_id);
    root.innerHTML = `<p><a href="#/mrfs" class="link">← Material Requests</a></p>
      <div class="head"><h2>${esc(x.doc_no)} ${badge(x.status)}</h2><div class="btns">
        ${acts.map((a) => `<button class="btn ${a.danger ? 'danger' : ''}" data-to="${a.to}">${a.label}</button>`).join('')}
        ${canDC ? '<button class="btn" id="dc">Create Delivery Challan</button>' : ''}
        <button class="btn ghost" id="print">Print</button></div></div>
      ${progressBar(x.status)}${ts.html}
      <div class="panel wide kv">
        <div><small>From workshop</small><b>${esc(x.workshop?.code)} · ${esc(x.workshop?.name)}</b></div>
        <div><small>To store</small><b>${esc(x.store?.code)} · ${esc(x.store?.name)}</b></div>
        <div><small>Job Card</small><b><a class="link" href="#/jobcards/${x.job_card_id}">${esc(x.jc?.doc_no)}</a></b></div>
        <div><small>Created</small><b>${fmtDate(x.created_at)} · ${esc(x.creator?.full_name || '—')}</b></div>
        <div><small>Remarks</small><b>${esc(x.remarks || '—')}</b></div></div>
      <h3>Requested items ${ed ? '<button class="btn ghost sm" id="add">+ Add item</button>' : ''}</h3>
      <p class="muted">Free text is fine here — write the spare the way it is called on the floor. The store will map it to a master product on the challan.</p>
      ${table(['Item (as requested)', 'Qty', 'UOM', 'Issued so far', ''], I.map((r) => `<tr><td class="wrap">${esc(r.description)}</td><td>${fmtQty(r.qty)}</td>
        <td>${esc(r.uom || '')}</td><td>${fmtQty(r.qty_issued)}</td><td>${ed ? `<button class="link" data-edit="${r.id}">Edit</button>` : ''}</td></tr>`), 'No items yet')}
      <h3>Delivery challans</h3>${table(['Challan', 'Status'], D.map((d) => `<tr><td><a class="link" href="#/dcs/${d.id}">${esc(d.doc_no)}</a></td><td>${badge(d.status)}</td></tr>`), 'None issued yet')}`;
    ts.bind(root, load);
    root.querySelectorAll('[data-to]').forEach((b) => (b.onclick = async () => {
      if (await advance('mrfs', id, acts.find((a) => a.to === b.dataset.to))) load();
    }));
    root.querySelector('#print').onclick = () => printDoc(`Material Request ${x.doc_no}`,
      printKV([['Status', x.status], ['From', `${x.workshop?.code} ${x.workshop?.name}`], ['To store', `${x.store?.code} ${x.store?.name}`],
        ['Job Card', x.jc?.doc_no], ['Created', fmtDate(x.created_at)], ['Remarks', x.remarks]]) +
      printTable(['#', 'Item', 'Qty', 'UOM'], I.map((r, i) => [i + 1, r.description, fmtQty(r.qty), r.uom])));
    const dcb = root.querySelector('#dc');
    if (dcb) dcb.onclick = () => (location.hash = '#/dcs/new/' + id);
    if (!ed) return;
    const itemForm = async (r = {}) => openForm({ title: 'MRF item', fields: [
      { name: 'description', label: 'Item description', required: true, value: r.description },
      { name: 'qty', label: 'Quantity', type: 'number', required: true, value: r.qty },
      { name: 'uom', label: 'UOM (as you call it)', value: r.uom }] });
    root.querySelector('#add').onclick = async () => {
      const v = await itemForm(); if (!v) return;
      const { error } = await sb.from('mrf_items').insert({ ...v, mrf_id: id });
      error ? fail(error) : load();
    };
    root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
      const r = I.find((z) => z.id === b.dataset.edit);
      const v = await itemForm(r); if (!v) return;
      const { error } = await sb.from('mrf_items').update(v).eq('id', r.id);
      error ? fail(error) : load();
    }));
  }
  await load();
  ['mrfs', 'mrf_items', 'delivery_challans', 'reversal_tokens'].forEach((t) => watch(t, load));
}
