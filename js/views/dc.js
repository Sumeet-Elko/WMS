import { sb, watch } from '../db.js';
import { getState } from '../auth.js';
import { esc, badge, fmtDate, fmtQty, table, openForm, toast } from '../ui.js';
import { nextActions, advance, tokenState, progressBar, printDoc, printKV, printTable,
  atLoc, isHeadOf, isStoreUser, inScope, fail } from '../doc.js';

const SEL = '*, store:locations!store_id(code,name), workshop:locations!workshop_id(code,name), mrf:mrfs(doc_no,job_card_id), creator:profiles!created_by(full_name)';

export async function render(root, id, extra) {
  if (id === 'new') return create(extra);
  return id ? detail(root, id) : list(root);
}

async function create(mrfId) {
  const me = getState().profile;
  if (!isStoreUser()) { toast('Only store users issue challans', 'error'); return (location.hash = '#/dcs'); }
  const { data: mrfs } = await sb.from('mrfs').select('id,doc_no,workshop:locations!workshop_id(code)').eq('store_id', me.location_id).eq('status', 'approved').order('created_at', { ascending: false });
  const v = await openForm({ title: 'New Delivery Challan', submitText: 'Create draft', fields: [
    { name: 'mrf_id', label: 'Approved MRF', type: 'select', required: true, value: mrfId || '',
      options: [{ value: '', label: '— choose —' }, ...(mrfs || []).map((m) => ({ value: m.id, label: `${m.doc_no} · from ${m.workshop?.code}` }))] },
    { name: 'remarks', label: 'Remarks', type: 'textarea' }] });
  if (!v) return (location.hash = '#/dcs');
  const { data, error } = await sb.from('delivery_challans').insert({ ...v, store_id: me.location_id, workshop_id: me.location_id }).select('id').single();
  if (error) { fail(error); return (location.hash = '#/dcs'); }
  location.hash = '#/dcs/' + data.id;
}

async function list(root) {
  root.innerHTML = `<div class="head"><h2>Delivery Challans</h2><div class="btns">
    <select id="fs"><option value="">All statuses</option>${['draft', 'pending_verification', 'confirmed', 'approved', 'closed', 'rejected']
      .map((s) => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select>
    <input type="search" id="q" placeholder="Search…">
    ${isStoreUser() ? '<button class="btn" id="new">+ New Challan</button>' : ''}</div></div>
    <p class="muted" id="count"></p><div class="deck" id="deck"></div>`;
  let rows = [];
  function draw() {
    const q = root.querySelector('#q').value.trim().toLowerCase(), s = root.querySelector('#fs').value;
    const r = rows.filter((x) => inScope(x.store_id, x.workshop_id) && (!s || x.status === s) &&
      (!q || [x.doc_no, x.mrf?.doc_no, x.store?.code, x.workshop?.code].some((v) => String(v || '').toLowerCase().includes(q))));
    root.querySelector('#count').textContent = `${r.length} challan(s)`;
    root.querySelector('#deck').innerHTML = r.map((x) => `<a class="dcard s-${x.status}" href="#/dcs/${x.id}">
      <div class="top"><b>${esc(x.doc_no)}</b>${badge(x.status)}</div>
      <div class="big">${esc(x.store?.code)} → ${esc(x.workshop?.code)}</div>
      <small>MRF ${esc(x.mrf?.doc_no)}</small><small>${fmtDate(x.created_at)} · ${esc(x.creator?.full_name || '—')}</small></a>`).join('') || '<p class="muted">No challans.</p>';
  }
  async function load() {
    const { data, error } = await sb.from('delivery_challans').select(SEL).order('created_at', { ascending: false }).limit(500);
    if (error) return fail(error);
    rows = data; draw();
  }
  root.querySelector('#fs').onchange = draw; root.querySelector('#q').oninput = draw;
  const b = root.querySelector('#new'); if (b) b.onclick = () => create();
  await load();
  watch('delivery_challans', load);
}

async function detail(root, id) {
  async function load() {
    const [d, it] = await Promise.all([
      sb.from('delivery_challans').select(SEL).eq('id', id).maybeSingle(),
      sb.from('dc_items').select('*, product:products(item_code,item_name,base_uom)').eq('dc_id', id).order('created_at'),
    ]);
    const x = d.data;
    if (!x) { root.innerHTML = '<p class="err">Challan not found or not visible to you.</p>'; return; }
    const I = it.data || [];
    const [mi, used, jcs] = await Promise.all([
      sb.from('mrf_items').select('id,description,qty').eq('mrf_id', x.mrf_id),
      sb.from('jc_spares').select('dc_item_id,qty').in('dc_item_id', I.length ? I.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000']),
      sb.from('job_cards').select('status').eq('id', x.mrf?.job_card_id).maybeSingle(),
    ]);
    const MI = mi.data || [];
    const usedMap = {}; (used.data || []).forEach((u) => { usedMap[u.dc_item_id] = (usedMap[u.dc_item_id] || 0) + Number(u.qty); });
    const jcOk = ['confirmed', 'approved', 'closed'].includes(jcs.data?.status);
    const ts = await tokenState('delivery_challans', x, x.store_id, x.store_id);
    const ed = ts.editable;
    const acts = nextActions(x.status, x.store_id, x.store_id);
    const workshopSide = atLoc(x.workshop_id), head = isHeadOf(x.store_id);
    const mrfText = (mid) => MI.find((m) => m.id === mid)?.description || '';

    root.innerHTML = `<p><a href="#/dcs" class="link">← Delivery Challans</a></p>
      <div class="head"><h2>${esc(x.doc_no)} ${badge(x.status)}</h2><div class="btns">
        ${acts.map((a) => `<button class="btn ${a.danger ? 'danger' : ''}" data-to="${a.to}">${a.label}</button>`).join('')}
        <button class="btn ghost" id="print">Print</button></div></div>
      ${progressBar(x.status)}${ts.html}
      <div class="panel wide kv">
        <div><small>Issuing store</small><b>${esc(x.store?.code)} · ${esc(x.store?.name)}</b></div>
        <div><small>Receiving workshop</small><b>${esc(x.workshop?.code)} · ${esc(x.workshop?.name)}</b></div>
        <div><small>MRF</small><b><a class="link" href="#/mrfs/${x.mrf_id}">${esc(x.mrf?.doc_no)}</a></b></div>
        <div><small>Created</small><b>${fmtDate(x.created_at)} · ${esc(x.creator?.full_name || '—')}</b></div></div>
      <h3>Items ${ed ? '<button class="btn ghost sm" id="add">+ Add item</button>' : ''}</h3>
      ${x.status === 'confirmed' && workshopSide ? '<div class="notice blue">Check what physically arrived and record each line. Differences go to the Store Head to accept or reject.</div>' : ''}
      ${table(['Requested as', 'Product (master)', 'Issued', 'Received', 'Line status', ''], I.map((r) => {
        const left = r.qty_received === null ? 0 : Number(r.qty_received) - Number(r.qty_absorbed) - (usedMap[r.id] || 0);
        let btn = '';
        if (ed && x.status === 'draft') btn = `<button class="link" data-edit="${r.id}">Edit</button>`;
        if (x.status === 'confirmed' && workshopSide && r.line_status === 'issued') btn = `<button class="btn sm" data-recv="${r.id}">Record receipt</button>`;
        if (x.status === 'confirmed' && head && r.line_status === 'mismatch')
          btn = `<button class="btn sm" data-res="1" data-id="${r.id}">Accept</button> <button class="btn sm danger" data-res="0" data-id="${r.id}">Reject</button>`;
        if (workshopSide && ['matched', 'accepted'].includes(r.line_status) && left > 0 && jcOk)
          btn += ` <button class="btn ghost sm" data-absorb="${r.id}" data-left="${left}">Move ${fmtQty(left)} leftover to Floor Stock</button>`;
        return `<tr><td class="wrap">${esc(mrfText(r.mrf_item_id) || '—')}</td><td>${esc(r.product?.item_code)} · ${esc(r.product?.item_name)}</td>
          <td>${fmtQty(r.qty_base)} ${esc(r.product?.base_uom)}</td><td>${fmtQty(r.qty_received)}</td><td>${badge(r.line_status)}</td><td class="acts">${btn}</td></tr>`;
      }), 'No items yet')}
      <p class="muted">Items must exist in the Product Master. Quantities are in the product's Base UOM.</p>`;

    ts.bind(root, load);
    root.querySelectorAll('[data-to]').forEach((b) => (b.onclick = async () => {
      if (await advance('delivery_challans', id, acts.find((a) => a.to === b.dataset.to))) load();
    }));
    root.querySelector('#print').onclick = () => printDoc(`Delivery Challan ${x.doc_no}`,
      printKV([['Status', x.status], ['From store', `${x.store?.code} ${x.store?.name}`], ['To workshop', `${x.workshop?.code} ${x.workshop?.name}`],
        ['MRF', x.mrf?.doc_no], ['Date', fmtDate(x.created_at)]]) +
      printTable(['#', 'Code', 'Item', 'Issued', 'UOM', 'Received', 'Status'], I.map((r, i) => [i + 1, r.product?.item_code, r.product?.item_name, fmtQty(r.qty_base), r.product?.base_uom, fmtQty(r.qty_received), r.line_status])) +
      '<p class="psign">Issued by: ____________ &nbsp;&nbsp; Received by: ____________</p>');

    root.querySelectorAll('[data-recv]').forEach((b) => (b.onclick = async () => {
      const r = I.find((z) => z.id === b.dataset.recv);
      const v = await openForm({ title: `Receive ${r.product?.item_name}`, submitText: 'Record', fields: [
        { name: 'qty', label: `Quantity actually received (${r.product?.base_uom}) — issued ${fmtQty(r.qty_base)}`, type: 'number', required: true, value: r.qty_base },
        { name: 'note', label: 'Note (if different)' }] });
      if (!v) return;
      const { data, error } = await sb.rpc('receive_dc_line', { p_item: r.id, p_qty: v.qty, p_note: v.note });
      if (error) return fail(error);
      toast(data === 'matched' ? 'Matched' : 'Mismatch sent to Store Head', data === 'matched' ? 'ok' : 'info');
      load();
    }));
    root.querySelectorAll('[data-res]').forEach((b) => (b.onclick = async () => {
      const { error } = await sb.rpc('resolve_dc_line', { p_item: b.dataset.id, p_accept: b.dataset.res === '1' });
      error ? fail(error) : (toast('Resolved', 'ok'), load());
    }));
    root.querySelectorAll('[data-absorb]').forEach((b) => (b.onclick = async () => {
      const v = await openForm({ title: 'Move leftover to Floor Stock', submitText: 'Move', fields: [
        { name: 'qty', label: 'Quantity to keep on the workshop floor', type: 'number', required: true, value: b.dataset.left,
          hint: 'No physical return to the store is needed.' }] });
      if (!v) return;
      const { error } = await sb.rpc('absorb_leftover', { p_dc_item: b.dataset.absorb, p_qty: v.qty });
      error ? fail(error) : (toast('Added to Floor Stock', 'ok'), load());
    }));

    if (!ed) return;
    const { data: prods } = await sb.from('products').select('id,item_code,item_name,base_uom').eq('is_active', true).eq('type', 'Product').order('item_name');
    const form = async (r = {}) => openForm({ title: 'Challan item', fields: [
      { name: 'product_id', label: 'Product (Product Master)', type: 'select', required: true, search: true, value: r.product_id,
        options: [{ value: '', label: '— choose —' }, ...(prods || []).map((p) => ({ value: p.id, label: `${p.item_code} · ${p.item_name} (${p.base_uom})` }))] },
      { name: 'qty_base', label: 'Quantity in BASE UOM', type: 'number', required: true, value: r.qty_base },
      { name: 'mrf_item_id', label: 'Fulfils MRF line', type: 'select', value: r.mrf_item_id || '',
        options: [{ value: '', label: '— not linked —' }, ...MI.map((m) => ({ value: m.id, label: `${m.description} (${fmtQty(m.qty)})` }))] }] });
    const add = root.querySelector('#add');
    if (add) add.onclick = async () => {
      const v = await form(); if (!v) return;
      const { error } = await sb.from('dc_items').insert({ ...v, dc_id: id });
      error ? fail(error) : load();
    };
    root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
      const r = I.find((z) => z.id === b.dataset.edit);
      const v = await form(r); if (!v) return;
      const { error } = await sb.from('dc_items').update(v).eq('id', r.id);
      error ? fail(error) : load();
    }));
  }
  await load();
  ['delivery_challans', 'dc_items', 'reversal_tokens', 'jc_spares'].forEach((t) => watch(t, load));
}
