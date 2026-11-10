// Returns: workshop return queue + return delivery challans, store review inbox
import { sb, S, run, rpc, fetchAll, isAdmin, isWs, isStore, myWorkshopId, myStoreId, wsById, wsName, storeById, storeName, productById, userName, lockDoc, unlockDoc, storeOptions } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, tabsBar, emptyState } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { printPreview, docHeader, docFooter, box } from '../core/print.js';
import { fmtDateTime, fmtNum, fmtMoney, fmtQty, num, esc } from '../core/format.js';

const SRC = { dc_ack: ['From delivery', 'info'], floor_stock: ['Floor stock', 'teal'], rejected_back: ['Rejected back', 'warn'] };
const lineVal = (l) => Number(l.base_qty) * Number(l.rate);

/* =================================================================== WORKSHOP: queue + return DCs */
export async function workshopList(ctx) {
  const root = h('div'); let queue = [], rdcs = []; let tab = ctx.query.tab || 'queue';
  const tabs = tabsBar({ active: tab, tabs: [{ key: 'queue', label: 'Return queue' }, { key: 'rdcs', label: 'Return delivery challans' }], onChange: (k) => { tab = k; show(); } });
  const body = h('div');
  const qt = dataTable({
    exportName: 'return-queue', selectable: true, defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search item, job card, note...',
    filters: [{ key: 'source', label: 'All sources', options: Object.entries(SRC).map(([k, v]) => ({ value: k, label: v[0] })) }, ...(isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : [])],
    onSelect: (ids) => { mk.disabled = !ids.length; mk.textContent = ids.length ? `Create return DC (${ids.length})` : 'Create return DC'; },
    columns: [
      { key: 'p', label: 'Item', value: (r) => productById(r.product_id)?.item_code, render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description), h('div', { class: 'cell-sub mono' }, p?.item_code)); } },
      { key: 'base_qty', label: 'Quantity', num: true, render: (r) => fmtQty(productById(r.product_id), r.base_qty) },
      { key: 'source', label: 'Source', value: (r) => SRC[r.source]?.[0], render: (r) => badge(SRC[r.source][0], SRC[r.source][1], true) },
      { key: 'store_id', label: 'Issued by store', value: (r) => (r.store_id ? storeName(r.store_id) : '') },
      { key: 'note', label: 'Note' }, { key: 'age', label: 'Waiting', num: true, value: (r) => Math.floor((Date.now() - new Date(r.created_at)) / 86400000), render: (r) => { const dd = Math.floor((Date.now() - new Date(r.created_at)) / 86400000); return badge(dd === 0 ? 'Today' : `${dd} day${dd > 1 ? 's' : ''}`, dd > 7 ? 'danger' : dd > 3 ? 'warn' : 'muted', true); } },
      { key: 'created_at', label: 'Queued on', render: (r) => fmtDateTime(r.created_at) },
    ],
    empty: { icon: 'undo', title: 'Return queue is empty', text: 'Items you mark for return when acknowledging deliveries, or floor stock you return, wait here until you send them to the store.' },
  });
  const mk = h('button', { class: 'btn primary sm', disabled: true, onClick: act(makeRdc) }, 'Create return DC');
  const qCard = h('div', { class: 'card' }, h('div', { class: 'toolbar', style: { borderBottom: 0, paddingBottom: 0 } }, h('div', { class: 'grow small muted' }, 'Select items and combine them into a return delivery challan for one store.'), isWs() ? btn('Return floor stock', { cls: 'sm', icon: 'layers', onClick: floorReturn }) : null, isWs() ? mk : null), qt.el);
  const rt = dataTable({
    exportName: 'return-dcs', defaultSort: { key: 'created_at', dir: 'desc' }, rowClass: (r) => (r.status === 'reviewed' ? 'row-warn' : ''),
    filters: [{ key: 'status', label: 'All statuses', options: ['draft', 'sent', 'reviewed', 'closed'].map((s) => ({ value: s, label: s })) }, { key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }],
    columns: [
      { key: 'rdc_no', label: 'Return DC', render: (r) => h('span', { class: 'cell-main mono' }, r.rdc_no || 'DRAFT') },
      ...(isAdmin() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
      { key: 'store_id', label: 'To store', value: (r) => storeName(r.store_id) }, { key: 'n', label: 'Items', num: true, value: (r) => r.return_dc_lines[0]?.count || 0 },
      { key: 'status', label: 'Status', render: (r) => statusBadge('rdc', r.status) }, { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.sent_at || r.created_at) },
    ],
    onRowClick: (r) => navigate(`/returns/${r.id}`),
    empty: { icon: 'truck', title: 'No return challans yet' },
  });
  const rCard = h('div', { class: 'card' }, rt.el);
  const show = () => { body.replaceChildren(tab === 'queue' ? qCard : rCard); };

  async function load() {
    [queue, rdcs] = await Promise.all([fetchAll(() => sb.from('return_queue').select('*').eq('status', 'queued').order('created_at', { ascending: false })), fetchAll(() => sb.from('return_dcs').select('*, return_dc_lines(count)').order('created_at', { ascending: false }))]);
    qt.setRows(queue); rt.setRows(rdcs); tabs.setCounts({ queue: queue.length, rdcs: rdcs.length });
  }
  async function makeRdc() {
    const ids = qt.selected(); const items = queue.filter((q) => ids.includes(q.id));
    const stores = [...new Set(items.map((i) => i.store_id).filter(Boolean))];
    const sel = selectBox({ options: storeOptions(true), value: stores.length === 1 ? stores[0] : null, placeholder: 'Select store', clearable: false });
    const rem = inp({ placeholder: 'Optional remarks' });
    const m = modal({ title: `Create return DC (${items.length} item${items.length > 1 ? 's' : ''})`, content: h('div', { class: 'col' }, banner('info', 'The return DC is created as a draft. Review it, then send it to the store.'), field('Return to store', sel, { required: true }), field('Remarks', rem)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Create draft', { cls: 'primary', onClick: act(async () => { if (!sel.getValue()) throw new Error('Select the store'); const rid = await rpc('rdc_create', { p_store: sel.getValue(), p_queue_ids: ids, p_remarks: rem.value.trim() || null }); m.close(); navigate(`/returns/${rid}`); }) })] });
  }
  async function floorReturn() {
    const bal = await run(sb.from('stock_balances').select('*').eq('location_type', 'workshop').eq('location_id', myWorkshopId()).gt('qty', 0));
    if (!bal.length) throw new Error('Your workshop has no floor stock to return.');
    const avail = new Map(bal.map((b) => [b.product_id, Number(b.qty)]));
    const prod = selectBox({ options: bal.map((b) => productById(b.product_id)).filter(Boolean).map((p) => ({ value: p.id, label: `${p.item_code} · ${p.description}`, sub: `On hand: ${fmtQty(p, avail.get(p.id))}` })), placeholder: 'Select item', onChange: upd });
    const qty = inp({ type: 'number', min: '0', step: 'any' }); const unit = h('span', { class: 'muted' }); const store = selectBox({ options: storeOptions(true), placeholder: 'Select store' }); const note = inp({ placeholder: 'Reason / note' });
    function upd() { const p = productById(prod.getValue()); unit.textContent = p?.base_uom || ''; qty.step = p?.allow_decimal ? 'any' : '1'; }
    const m = modal({ title: 'Return floor stock', content: h('div', { class: 'col' }, banner('info', 'The quantity leaves your workshop stock now and waits in the return queue until you send it to the store.'), field('Item', prod, { required: true }), field('Quantity to return', h('div', { class: 'row nowrap' }, qty, unit), { required: true }), field('Store it came from / goes to', store), field('Note', note)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Move to return queue', { cls: 'primary', onClick: act(async () => {
        const p = productById(prod.getValue()); if (!p) throw new Error('Select an item'); const q = num(qty.value); if (!(q > 0)) throw new Error('Enter a quantity'); if (q > avail.get(p.id)) throw new Error(`Only ${fmtQty(p, avail.get(p.id))} on hand`);
        await rpc('stock_to_return_queue', { p_product: p.id, p_base_qty: q, p_store: store.getValue(), p_note: note.value.trim() || null }); toast('Moved to return queue'); m.close(); await load();
      }) })] });
  }
  await load(); show();
  root.append(pageHead({ title: 'Returns', sub: 'Returns queue up here for a few days, then go to the store together as a return delivery challan.' }), h('div', { class: 'card mb' }, h('div', { style: { padding: '0 12px' } }, tabs)), body);
  return { el: root, refresh: load };
}

/* =================================================================== PRINT */
function rdcPrint(r, lines) {
  const w = wsById(r.workshop_id); const s = storeById(r.store_id);
  const tot = lines.reduce((a, l) => a + lineVal(l), 0);
  return `${docHeader({ title: 'Return Delivery Challan', no: r.rdc_no, status: r.status === 'draft' ? 'Draft' : '' })}
    <div class="grid2">${box('From - Workshop', `<div class="big">${esc(w?.name)}</div>${esc(w?.address || '')}<br>${esc([w?.contact_name, w?.contact_phone].filter(Boolean).join(' · '))}`)}
    ${box('To - Store', `<div class="big">${esc(s?.name)}</div>${esc(s?.address || '')}<br>${esc([s?.contact_name, s?.contact_phone].filter(Boolean).join(' · '))}`)}</div>
    <div class="grid3">${box('Date & time', esc(fmtDateTime(r.sent_at || new Date())))}${box('Prepared by', esc(userName(r.created_by)))}${box('Items', String(lines.length))}</div>
    <table><thead><tr><th style="width:26px">#</th><th style="width:15%">Item code</th><th>Description</th><th class="num" style="width:90px">Qty</th><th class="num" style="width:80px">Rate</th><th class="num" style="width:90px">Value</th><th style="width:20%">Reason</th></tr></thead><tbody>
      ${lines.map((l, i) => { const p = productById(l.product_id); return `<tr><td>${i + 1}</td><td>${esc(p?.item_code)}</td><td>${esc(p?.description)}</td><td class="num">${fmtNum(l.base_qty)} ${esc(p?.base_uom)}</td><td class="num">${fmtNum(l.rate, 2)}</td><td class="num">${fmtNum(lineVal(l), 2)}</td><td>${esc(l.reason || '')}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td colspan="5" class="num">Total value</td><td class="num">${fmtMoney(tot)}</td><td></td></tr></tfoot></table>
    ${r.remarks ? `<div class="note"><b>Remarks:</b> ${esc(r.remarks)}</div>` : ''}
    <div class="sig"><div>Prepared by</div><div>Workshop Manager</div><div>Store In-charge</div><div>Date / time received</div></div>${docFooter(S.profile.full_name)}`;
}

/* =================================================================== WORKSHOP DETAIL */
export async function workshopDetail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false }; let r, lines; let canEdit = false; let lockMsg = null;
  async function load() { r = await run(sb.from('return_dcs').select('*').eq('id', id).maybeSingle()); if (!r) throw new Error('Return DC not found.'); lines = await run(sb.from('return_dc_lines').select('*').eq('rdc_id', id).order('line_no')); }
  async function acquire() { canEdit = false; lockMsg = null; if (!(isWs() && r.workshop_id === myWorkshopId() && r.status === 'draft')) return; const x = await lockDoc('rdc', id); if (x.ok) canEdit = true; else lockMsg = `${x.holder} is editing this return DC.`; }
  async function reloadAll() { const had = canEdit; await load(); await acquire(); if (had && !canEdit) await unlockDoc('rdc', id); draw(); }
  function draw() {
    root.replaceChildren(); view.isForm = canEdit; ctx.setTitle(r.rdc_no || 'Return DC (draft)', wsName(r.workshop_id));
    const t = dataTable({ hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 200, rows: lines, rowClass: (x) => (x.store_status === 'rejected' && !x.ws_accepted_back ? 'row-danger' : x.store_status === 'accepted' ? 'row-ok' : ''),
      columns: [{ key: 'line_no', label: '#', num: true }, { key: 'p', label: 'Item', value: (x) => productById(x.product_id)?.item_code, render: (x) => { const p = productById(x.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description), h('div', { class: 'cell-sub mono' }, p?.item_code)); } },
        { key: 'base_qty', label: 'Quantity', num: true, render: (x) => fmtQty(productById(x.product_id), x.base_qty) }, { key: 'rate', label: 'Value', num: true, render: (x) => fmtMoney(lineVal(x)) }, { key: 'reason', label: 'Reason' },
        { key: 'store_status', label: 'Store decision', render: (x) => h('div', null, statusBadge('line', x.store_status), x.store_note ? h('div', { class: 'cell-sub' }, x.store_note) : null, x.ws_accepted_back ? h('div', { class: 'cell-sub' }, 'Taken back into workshop stock') : null) },
        { key: 'x', label: '', sortable: false, render: (x) => (canEdit ? h('div', { class: 'actions' }, iconBtn('trash', 'Remove from this DC (back to queue)', act(async () => { await rpc('rdc_remove_line', { p_line: x.id }); toast('Item moved back to the queue'); if (lines.length === 1) navigate('/returns'); else await reloadAll(); }))) : x.store_status === 'rejected' && !x.ws_accepted_back && isWs() && r.workshop_id === myWorkshopId() ? h('div', { class: 'actions' }, btn('Take back to workshop stock', { cls: 'sm', onClick: act(async () => { await rpc('rdc_accept_back', { p_line: x.id }); toast('Back in workshop stock'); await reloadAll(); }) })) : null) }] });
    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: () => printPreview(r.rdc_no || 'Return DC', rdcPrint(r, lines)) })];
    if (canEdit) acts.push(btn('Discard draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(async () => { if (!(await confirmBox({ title: 'Discard this draft?', message: 'All items go back to the return queue.', tone: 'danger', confirmText: 'Discard' }))) return; await rpc('rdc_discard', { p_id: id }); toast('Draft discarded'); navigate('/returns'); }) }), btn('Send to store', { cls: 'primary', icon: 'send', onClick: act(async () => { const no = await rpc('rdc_send', { p_id: id }); toast(`Return DC ${no} sent to ${storeName(r.store_id)}`); await reloadAll(); }) }));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, r.rdc_no || 'Return DC (draft)'), statusBadge('rdc', r.status)), h('p', null, `${wsName(r.workshop_id)} → ${storeName(r.store_id)}`)), h('div', { class: 'actions' }, acts)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', lockMsg)) : null,
      r.status === 'reviewed' ? h('div', { class: 'mb' }, banner('warn', 'The store rejected some items. Take them back into your workshop stock to close this return.')) : null,
      card({ title: 'Items', flush: true, cls: 'mb', body: t.el }), r.remarks ? banner('info', `Remarks: ${r.remarks}`) : null);
  }
  await load(); await acquire(); draw();
  view.destroy = async () => { if (canEdit) await unlockDoc('rdc', id); };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}

/* =================================================================== STORE INBOX */
export async function storeInbox(ctx) {
  const root = h('div'); let rows = []; let cur = ctx.query.tab || 'sent';
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'sent', label: 'To review' }, { key: 'reviewed', label: 'Rejections pending' }, { key: 'closed', label: 'Closed' }, { key: 'all', label: 'All' }], onChange: (k) => { cur = k; apply(); } });
  const tbl = dataTable({
    exportName: 'return-inbox', defaultSort: { key: 'sent_at', dir: 'asc' }, filters: [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }],
    columns: [{ key: 'rdc_no', label: 'Return DC', render: (r) => h('span', { class: 'cell-main mono' }, r.rdc_no) }, { key: 'workshop_id', label: 'From workshop', value: (r) => wsName(r.workshop_id) },
      ...(isAdmin() ? [{ key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) }] : []), { key: 'n', label: 'Items', num: true, value: (r) => r.return_dc_lines[0]?.count || 0 },
      { key: 'status', label: 'Status', render: (r) => statusBadge('rdc', r.status) }, { key: 'sent_at', label: 'Received', render: (r) => fmtDateTime(r.sent_at) }],
    onRowClick: (r) => navigate(`/return-inbox/${r.id}`), empty: { icon: 'undo', title: 'No returns to review' },
  });
  const apply = () => tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur));
  async function load() { rows = await fetchAll(() => sb.from('return_dcs').select('*, return_dc_lines(count)').neq('status', 'draft').order('sent_at', { ascending: true })); const c = { all: rows.length }; ['sent', 'reviewed', 'closed'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length)); tabs.setCounts(c); apply(); }
  await load();
  root.append(pageHead({ title: 'Return Inbox', sub: 'Accept returned items back into store stock, or reject damaged ones with a reason.' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== STORE DETAIL */
export async function storeDetail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false }; let r, lines; let canEdit = false; let lockMsg = null; let dec = {};
  async function load() { r = await run(sb.from('return_dcs').select('*').eq('id', id).maybeSingle()); if (!r || r.status === 'draft') throw new Error('Return DC not found.'); lines = await run(sb.from('return_dc_lines').select('*').eq('rdc_id', id).order('line_no')); }
  async function acquire() { canEdit = false; lockMsg = null; if (!(isStore() && r.store_id === myStoreId() && r.status === 'sent')) return; const x = await lockDoc('rdc', id); if (x.ok) canEdit = true; else lockMsg = `${x.holder} is reviewing this return.`; }
  async function reloadAll() { const had = canEdit; await load(); await acquire(); if (had && !canEdit) await unlockDoc('rdc', id); draw(); }
  function draw() {
    root.replaceChildren(); view.isForm = canEdit; ctx.setTitle(r.rdc_no, storeName(r.store_id));
    if (canEdit) lines.forEach((l) => { dec[l.id] = dec[l.id] || { decision: 'accepted', note: '' }; });
    const rows = lines.map((l) => {
      const p = productById(l.product_id); const d = dec[l.id];
      const note = inp({ placeholder: 'Reason for rejection (required)', value: d?.note || '', style: { display: d?.decision === 'rejected' ? 'block' : 'none' } }); if (d) note.oninput = () => { d.note = note.value; };
      const seg = (k, label, tone) => h('button', { type: 'button', class: `btn sm ${d?.decision === k ? (k === 'accepted' ? 'success' : 'danger') : ''}`, onClick: () => { d.decision = k; draw(); } }, label);
      return h('div', { class: 'card', style: { boxShadow: 'none' } }, h('div', { class: 'card-body row between' },
        h('div', { style: { minWidth: '220px' } }, h('div', { class: 'bold' }, p?.description), h('div', { class: 'small muted' }, `${p?.item_code} · ${fmtQty(p, l.base_qty)}${l.reason ? ' · ' + l.reason : ''}`)),
        canEdit ? h('div', { class: 'col', style: { minWidth: '260px', gap: '8px' } }, h('div', { class: 'row' }, seg('accepted', 'Accept'), seg('rejected', 'Reject')), note) : h('div', null, statusBadge('line', l.store_status), l.store_note ? h('div', { class: 'small muted' }, l.store_note) : null)));
    });
    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: () => printPreview(r.rdc_no, rdcPrint(r, lines)) })];
    if (canEdit) acts.push(btn('Submit decisions', { cls: 'primary', icon: 'check', onClick: act(async () => {
      const arr = lines.map((l) => ({ line_id: l.id, decision: dec[l.id].decision, note: dec[l.id].note.trim() }));
      const bad = arr.find((x) => x.decision === 'rejected' && !x.note); if (bad) throw new Error('Give a reason for every rejected item');
      const rej = arr.filter((x) => x.decision === 'rejected').length;
      if (!(await confirmBox({ title: 'Submit decisions?', message: `${arr.length - rej} accepted into ${storeName(r.store_id)} stock, ${rej} rejected. This cannot be changed afterwards.`, confirmText: 'Submit', tone: rej ? 'warn' : 'success' }))) return;
      await rpc('rdc_decide', { p_id: id, p_decisions: arr }); toast('Return reviewed'); dec = {}; await reloadAll();
    }) }));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, r.rdc_no), statusBadge('rdc', r.status)), h('p', null, `${wsName(r.workshop_id)} → ${storeName(r.store_id)} · ${fmtDateTime(r.sent_at)}`)), h('div', { class: 'actions' }, acts)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', lockMsg)) : null, r.remarks ? h('div', { class: 'mb' }, banner('info', `Workshop remarks: ${r.remarks}`)) : null, h('div', { class: 'col' }, rows));
  }
  await load(); await acquire(); draw();
  view.destroy = async () => { if (canEdit) await unlockDoc('rdc', id); };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}
