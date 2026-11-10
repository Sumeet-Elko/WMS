// Material Request Forms: workshop list/form + store inbox/detail
import { sb, S, run, rpc, fetchAll, isAdmin, isWs, isManager, isStore, myWorkshopId, myStoreId, wsById, wsName, storeById, storeName, productById, vehicleById, userName, storeOptions, lockDoc, unlockDoc } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, tabsBar, emptyState } from '../core/ui.js';
import { selectBox, strOpts } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { autosaver } from '../core/autosave.js';
import { printPreview, docHeader, docFooter, box } from '../core/print.js';
import { fmtDateTime, fmtNum, num, esc } from '../core/format.js';

const embed = '*, job_cards(jc_no,vehicle_id,status), mrf_lines(count), delivery_challans(count)';
const cnt = (x) => (x && x[0] ? x[0].count : 0);
const jcNo = (r) => r.job_cards?.jc_no || '—';
const reg = (r) => vehicleById(r.job_cards?.vehicle_id)?.reg_no || '—';

/* =================================================================== WORKSHOP LIST */
export async function list(ctx) {
  const root = h('div'); let rows = []; let cur = ctx.query.tab || 'all';
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'all', label: 'All' }, { key: 'draft', label: 'Drafted MRFs' }, { key: 'sent', label: 'Sent to store' }, { key: 'returned', label: 'Returned by store' }, { key: 'closed', label: 'Closed' }], onChange: (k) => { cur = k; apply(); } });
  const tbl = dataTable({
    exportName: 'mrfs', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search MRF no, job card, vehicle, store...',
    rowClass: (r) => (r.status === 'returned' ? 'row-warn' : ''),
    filters: [...(isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : []),
      { key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }],
    columns: [
      { key: 'mrf_no', label: 'MRF no', render: (r) => h('span', { class: 'cell-main mono' }, r.mrf_no || 'DRAFT') },
      { key: 'jc', label: 'Job card', value: jcNo, render: (r) => h('a', { href: `#/jobcards/${r.job_card_id}`, class: 'mono', onClick: (e) => e.stopPropagation() }, jcNo(r)) },
      { key: 'reg', label: 'Vehicle', value: reg },
      ...(isAdmin() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
      { key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) },
      { key: 'lines', label: 'Items', num: true, value: (r) => cnt(r.mrf_lines) },
      { key: 'dcs', label: 'Challans', num: true, value: (r) => cnt(r.delivery_challans) },
      { key: 'status', label: 'Status', render: (r) => statusBadge('mrf', r.status) },
      { key: 'created_at', label: 'Raised', render: (r) => h('div', null, h('div', null, fmtDateTime(r.sent_at || r.created_at)), h('div', { class: 'cell-sub' }, userName(r.created_by))) },
      { key: 'x', label: '', sortable: false, exportable: false, render: (r) => (isManager() && ['sent', 'returned'].includes(r.status) ? h('div', { class: 'actions' }, btn('Close', { cls: 'sm danger ghost', onClick: act(() => closeMrf(r)) })) : null) },
    ],
    onRowClick: (r) => navigate(`/mrfs/${r.id}`),
    empty: { icon: 'clipboard', title: 'No material requests', text: 'Open a job card and press "Raise MRF" to request spares from a store.' },
  });
  async function closeMrf(r) {
    const reason = await promptBox({ title: `Close ${r.mrf_no}`, message: 'Once closed, stores can no longer issue products against this MRF. Draft challans are discarded.', label: 'Reason', tone: 'danger', confirmText: 'Close MRF' });
    if (!reason) return; await rpc('mrf_close', { p_id: r.id, p_reason: reason }); toast('MRF closed', 'warn'); await load();
  }
  const apply = () => tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur));
  async function load() {
    rows = await fetchAll(() => sb.from('mrfs').select(embed).order('created_at', { ascending: false }));
    const c = { all: rows.length }; ['draft', 'sent', 'returned', 'closed'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length)); tabs.setCounts(c); apply();
  }
  await load();
  root.append(pageHead({ title: 'Material Requests', sub: isManager() ? 'Monitor requests and the challans issued against them. You can close a request that is no longer needed.' : 'Drafts stay here until you send them to a store.' }),
    h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== PRINT */
export function mrfPrintHtml(m, lines, jc) {
  const v = vehicleById(jc?.vehicle_id); const w = wsById(m.workshop_id); const s = storeById(m.store_id);
  const rd = v ? [v.has_odometer && jc.odometer != null ? `Odometer ${fmtNum(jc.odometer, 1)} km` : '', v.has_engine_hour && jc.engine_hour != null ? `Engine hr ${fmtNum(jc.engine_hour, 1)}` : '', v.has_aux_hour && jc.aux_hour != null ? `Aux hr ${fmtNum(jc.aux_hour, 1)}` : ''].filter(Boolean).join(' · ') : '';
  const blank = Array.from({ length: Math.max(0, 8 - lines.length) }, () => '<tr class="blankrow"><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  return `${docHeader({ title: 'Material Request', no: m.mrf_no, status: m.status === 'draft' ? 'Draft' : m.status })}
    <div class="grid2">
      ${box('From - Workshop', `<div class="big">${esc(w?.name)}</div>${esc(w?.address || '')}<br>${esc([w?.contact_name, w?.contact_phone].filter(Boolean).join(' · '))}`)}
      ${box('To - Store', `<div class="big">${esc(s?.name || '—')}</div>${esc(s?.address || '')}<br>${esc([s?.contact_name, s?.contact_phone].filter(Boolean).join(' · '))}`)}
    </div>
    <div class="grid3">
      ${box('Job card', `<div class="big">${esc(jc?.jc_no || '—')}</div>${esc(jc?.complaint_type || '')}`)}
      ${box('Vehicle', `<div class="big">${esc(v?.reg_no || '—')}</div>${esc([v?.make, v?.model].filter(Boolean).join(' '))}<br>${esc(rd)}`)}
      ${box('Raised', `${esc(fmtDateTime(m.sent_at || m.created_at))}<br>${esc(userName(m.created_by))}`)}
    </div>
    <table><thead><tr><th style="width:28px">#</th><th>Item requested</th><th class="num" style="width:70px">Qty</th><th style="width:60px">Unit</th><th style="width:28%">Remarks</th></tr></thead><tbody>
      ${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item_text)}</td><td class="num">${fmtNum(l.qty)}</td><td>${esc(l.unit || '')}</td><td>${esc(l.remarks || '')}</td></tr>`).join('')}${blank}</tbody></table>
    ${m.remarks ? `<div class="note"><b>Remarks:</b> ${esc(m.remarks)}</div>` : ''}
    <div class="sig"><div>Requested by</div><div>Workshop Manager</div><div>Store In-charge</div><div>Received by</div></div>
    ${docFooter(S.profile.full_name)}`;
}

/* =================================================================== WORKSHOP DETAIL / FORM */
export async function detail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false };
  let m, jc, lines = [], dcs = [], dclines = []; let canEdit = false; let lockMsg = null; let auto = null; let st = null;

  async function load() {
    m = await run(sb.from('mrfs').select('*').eq('id', id).maybeSingle());
    if (!m) throw new Error('MRF not found or no access.');
    [jc, lines, dcs] = await Promise.all([
      run(sb.from('job_cards').select('*').eq('id', m.job_card_id).maybeSingle()),
      run(sb.from('mrf_lines').select('*').eq('mrf_id', id).order('line_no')),
      run(sb.from('delivery_challans').select('*').eq('mrf_id', id).order('created_at')),
    ]);
    dclines = dcs.length ? await run(sb.from('dc_lines').select('*').in('dc_id', dcs.map((d) => d.id)).order('line_no')) : [];
  }
  const editable = () => isWs() && m.workshop_id === myWorkshopId() && ['draft', 'returned'].includes(m.status);
  async function acquire() {
    canEdit = false; lockMsg = null; if (!editable()) return;
    const r = await lockDoc('mrf', id); if (r.ok) canEdit = true; else lockMsg = `${r.holder} is editing this MRF right now.`;
  }
  async function reloadAll() { if (auto) await auto.flush().catch(() => {}); const had = canEdit; await load(); await acquire(); if (had && !canEdit) await unlockDoc('mrf', id); draw(); }

  async function save() {
    if (!canEdit || !st) return;
    const patch = { remarks: st.remarks.value || null };
    if (m.status === 'draft') { patch.job_card_id = st.jc.getValue(); patch.store_id = st.store.getValue(); }
    if (!patch.job_card_id && m.status === 'draft') delete patch.job_card_id;
    await run(sb.from('mrfs').update(patch).eq('id', id));
    Object.assign(m, patch);
    const keep = st.lines.filter((l) => l.item_text.trim() || num(l.qty) > 0);
    await run(sb.from('mrf_lines').delete().eq('mrf_id', id));
    if (keep.length) await run(sb.from('mrf_lines').insert(keep.map((l, i) => ({ mrf_id: id, line_no: i + 1, item_text: l.item_text.trim() || '(item)', qty: num(l.qty) > 0 ? num(l.qty) : 1, unit: l.unit || null, remarks: l.remarks || null }))));
  }

  function draw() {
    root.replaceChildren(); view.isForm = canEdit; auto = canEdit ? autosaver({ save }) : null;
    ctx.setTitle(m.mrf_no || 'New MRF', wsName(m.workshop_id));
    const dis = !canEdit; const returned = m.status === 'returned';
    const openJcs = S.workshops && null;
    const jcSel = selectBox({ options: [], value: m.job_card_id, disabled: dis || m.status !== 'draft', clearable: false, placeholder: 'Select open job card', onChange: () => auto?.trigger() });
    (async () => {
      const js = await run(sb.from('job_cards').select('id,jc_no,vehicle_id,complaint').eq('workshop_id', m.workshop_id).eq('status', 'open').order('opened_at', { ascending: false }));
      const o = js.map((j) => ({ value: j.id, label: j.jc_no, sub: `${vehicleById(j.vehicle_id)?.reg_no || ''} · ${(j.complaint || '').slice(0, 50)}` }));
      if (!o.find((x) => x.value === m.job_card_id) && jc) o.push({ value: jc.id, label: jc.jc_no, sub: vehicleById(jc.vehicle_id)?.reg_no });
      jcSel.setOptions(o, true);
    })();
    const storeSel = selectBox({ options: storeOptions(true), value: m.store_id, disabled: dis || returned, clearable: false, placeholder: 'Select store', onChange: () => auto?.trigger() });
    const remarks = textarea({ value: m.remarks || '', disabled: dis, rows: 2, placeholder: 'Optional remarks for the store' });
    remarks.addEventListener('input', () => auto?.trigger());
    st = { jc: jcSel, store: storeSel, remarks, lines: lines.map((l) => ({ item_text: l.item_text, qty: l.qty, unit: l.unit || '', remarks: l.remarks || '', store_status: l.store_status, store_note: l.store_note })) };
    if (canEdit && !st.lines.length) st.lines.push({ item_text: '', qty: '', unit: '', remarks: '' });

    const grid = h('div', { class: 'lines-wrap' });
    function drawLines() {
      const tb = h('tbody');
      st.lines.forEach((l, i) => {
        const t = inp({ value: l.item_text, placeholder: 'Describe the item (e.g. Brake pad - front, Tata 1109)', disabled: dis }); t.oninput = () => { l.item_text = t.value; auto?.trigger(); };
        const q = inp({ type: 'number', min: '0', step: 'any', value: l.qty, placeholder: 'Qty', disabled: dis, style: { minWidth: '80px' } }); q.oninput = () => { l.qty = q.value; auto?.trigger(); };
        const u = inp({ value: l.unit, placeholder: 'Unit', disabled: dis, style: { minWidth: '70px' } }); u.oninput = () => { l.unit = u.value; auto?.trigger(); };
        const r = inp({ value: l.remarks, placeholder: 'Remarks', disabled: dis }); r.oninput = () => { l.remarks = r.value; auto?.trigger(); };
        tb.appendChild(h('tr', null, h('td', { class: 'n' }, i + 1), h('td', { style: { minWidth: '240px' } }, t), h('td', null, q), h('td', null, u), h('td', { style: { minWidth: '150px' } }, r),
          h('td', { style: { width: '48px' } }, canEdit ? iconBtn('trash', 'Remove line', () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push({ item_text: '', qty: '', unit: '', remarks: '' }); drawLines(); auto?.trigger(); }) : (l.store_status && l.store_status !== 'open' ? statusBadge('line', l.store_status) : null))));
      });
      grid.replaceChildren(h('table', { class: 'lines' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Item (plain text)'), h('th', null, 'Qty'), h('th', null, 'Unit'), h('th', null, 'Remarks'), h('th'))), tb));
      if (canEdit) grid.appendChild(h('div', { style: { marginTop: '10px' } }, btn('Add item', { cls: 'sm', icon: 'plus', onClick: () => { st.lines.push({ item_text: '', qty: '', unit: '', remarks: '' }); drawLines(); const ins = grid.querySelectorAll('tbody tr:last-child input'); ins[0]?.focus(); } })));
    }
    drawLines();

    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: act(print) })];
    if (canEdit && m.status === 'draft') acts.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(delDraft) }));
    if (canEdit) acts.push(btn(returned ? 'Re-send to store' : 'Send to store', { cls: 'primary', icon: 'send', onClick: act(send) }));
    if (isManager() && m.workshop_id === myWorkshopId() && ['sent', 'returned'].includes(m.status)) acts.push(btn('Close MRF', { cls: 'danger ghost sm', icon: 'ban', onClick: act(close) }));

    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, m.mrf_no || 'New MRF'), statusBadge('mrf', m.status), m.revision ? badge(`Revision ${m.revision}`, 'purple', true) : null), h('p', null, `${wsName(m.workshop_id)} → ${m.store_id ? storeName(m.store_id) : 'select store'}`)),
        h('div', { class: 'actions' }, auto ? auto.el : null, acts)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', lockMsg)) : null,
      returned ? h('div', { class: 'mb' }, banner('warn', h('span', null, h('b', null, 'Returned by store: '), m.return_reason || '', ' - make the changes and re-send.'))) : null,
      m.status === 'closed' ? h('div', { class: 'mb' }, banner('info', `Closed ${fmtDateTime(m.closed_at)} by ${userName(m.closed_by)}${m.close_reason ? ' - ' + m.close_reason : ''}`, 'lock')) : null,
      card({ title: 'Request details', cls: 'mb', body: h('div', { class: 'col' },
        h('div', { class: 'form-grid' }, field('Job card', jcSel, { required: true, hint: 'One MRF belongs to one job card only. You can raise many MRFs per job card.' }), field('Store', storeSel, { required: true })),
        jc ? kv([['Vehicle', vehicleById(jc.vehicle_id)?.reg_no], ['Complaint type', jc.complaint_type], ['Complaint', jc.complaint]]) : null) }),
      card({ title: 'Items requested', cls: 'mb', body: h('div', { class: 'col' }, grid, field('Remarks', remarks)) }),
      dcs.length ? dcCard() : null);
  }

  function dcCard() {
    return card({ title: 'Delivery challans issued against this MRF', cls: 'mb', body: h('div', { class: 'col' }, dcs.map((d) => {
      const ls = dclines.filter((l) => l.dc_id === d.id);
      return h('div', { class: 'card', style: { boxShadow: 'none' } },
        h('div', { class: 'card-head' }, h('div', null, h('a', { class: 'bold mono', href: `#/receipts/${d.id}` }, d.dc_no || 'Draft'), h('span', { class: 'small muted' }, ` · ${fmtDateTime(d.issued_at)}`)), statusBadge('dc', d.status)),
        h('div', { class: 'card-body' }, ls.map((l) => h('div', { class: 'row between', style: { padding: '4px 0' } }, h('span', null, productById(l.product_id)?.description || '?'), h('span', { class: 'muted' }, `${fmtNum(l.qty)} ${productById(l.product_id)?.uom || ''}`)))));
    })) });
  }

  async function print() { if (auto) await auto.flush().catch(() => {}); const ls = canEdit ? st.lines.filter((l) => l.item_text.trim()) : lines; if (!ls.length) throw new Error('Add at least one item first.'); const mm = { ...m, store_id: canEdit ? st.store.getValue() : m.store_id, remarks: canEdit ? st.remarks.value : m.remarks }; printPreview(m.mrf_no || 'MRF', mrfPrintHtml(mm, ls.map((l) => ({ ...l, qty: num(l.qty) })), jc)); }
  async function send() {
    if (!st.store.getValue()) { st.store.markInvalid(); throw new Error('Select the store'); }
    const ok = st.lines.filter((l) => l.item_text.trim() && num(l.qty) > 0);
    if (!ok.length) throw new Error('Add at least one item with a quantity');
    if (ok.length !== st.lines.filter((l) => l.item_text.trim() || l.qty).length) throw new Error('Every line needs both an item description and a quantity');
    st.lines = ok; await auto.flush();
    const no = await rpc('mrf_send', { p_id: id }); toast(`MRF ${no} sent to ${storeName(st.store.getValue())}`); await reloadAll();
  }
  async function delDraft() { if (!(await confirmBox({ title: 'Delete this draft MRF?', message: 'This cannot be undone.', tone: 'danger', confirmText: 'Delete' }))) return; auto.disable(); canEdit = false; await run(sb.from('mrfs').delete().eq('id', id)); toast('Draft deleted'); navigate('/mrfs'); }
  async function close() { const r = await promptBox({ title: `Close ${m.mrf_no}`, message: 'Stores will no longer be able to issue products against this MRF.', label: 'Reason', tone: 'danger', confirmText: 'Close MRF' }); if (!r) return; await rpc('mrf_close', { p_id: id, p_reason: r }); toast('MRF closed', 'warn'); await reloadAll(); }

  await load(); await acquire(); draw();
  view.flush = async () => { if (auto) await auto.flush(); };
  view.destroy = async () => {
    if (canEdit) {
      try { if (auto) await auto.flush(); } catch { /* ignore */ }
      try { if (m.status === 'draft' && !st.lines.some((l) => l.item_text.trim()) && !st.remarks.value.trim() && !st.store.getValue()) await sb.from('mrfs').delete().eq('id', id).eq('status', 'draft'); } catch { /* ignore */ }
      await unlockDoc('mrf', id);
    }
  };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}

/* =================================================================== STORE INBOX */
export async function storeInbox(ctx) {
  const root = h('div'); let rows = []; let cur = ctx.query.tab || 'sent';
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'sent', label: 'Waiting for issue' }, { key: 'returned', label: 'Returned to workshop' }, { key: 'closed', label: 'Closed' }, { key: 'all', label: 'All' }], onChange: (k) => { cur = k; apply(); } });
  const tbl = dataTable({
    exportName: 'mrf-inbox', defaultSort: { key: 'sent_at', dir: 'asc' }, searchPlaceholder: 'Search MRF, workshop, job card, vehicle...',
    filters: [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }, ...(isAdmin() ? [{ key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }] : [])],
    columns: [
      { key: 'mrf_no', label: 'MRF no', render: (r) => h('span', { class: 'cell-main mono' }, r.mrf_no) },
      { key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) },
      ...(isAdmin() ? [{ key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) }] : []),
      { key: 'jc', label: 'Job card', value: jcNo }, { key: 'reg', label: 'Vehicle', value: reg },
      { key: 'lines', label: 'Items', num: true, value: (r) => cnt(r.mrf_lines) }, { key: 'dcs', label: 'Challans', num: true, value: (r) => cnt(r.delivery_challans) },
      { key: 'status', label: 'Status', render: (r) => statusBadge('mrf', r.status) },
      { key: 'sent_at', label: 'Received', render: (r) => h('div', null, h('div', null, fmtDateTime(r.sent_at)), h('div', { class: 'cell-sub' }, userName(r.created_by))) },
    ],
    onRowClick: (r) => navigate(`/inbox/${r.id}`),
    empty: { icon: 'inbox', title: 'Inbox is empty', text: 'Material requests sent by workshops appear here.' },
  });
  const apply = () => tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur));
  async function load() {
    rows = (await fetchAll(() => sb.from('mrfs').select(embed).neq('status', 'draft').order('sent_at', { ascending: true })));
    const c = { all: rows.length }; ['sent', 'returned', 'closed'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length)); tabs.setCounts(c); apply();
  }
  await load();
  root.append(pageHead({ title: 'MRF Inbox', sub: 'Oldest request first. Open a request to issue products with a delivery challan.' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== STORE DETAIL */
export async function storeDetail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root };
  let m, jc, lines, dcs;
  async function load() {
    m = await run(sb.from('mrfs').select('*').eq('id', id).maybeSingle()); if (!m || m.status === 'draft') throw new Error('MRF not found.');
    [jc, lines, dcs] = await Promise.all([run(sb.from('job_cards').select('*').eq('id', m.job_card_id).maybeSingle()), run(sb.from('mrf_lines').select('*').eq('mrf_id', id).order('line_no')), run(sb.from('delivery_challans').select('*').eq('mrf_id', id).order('created_at'))]);
  }
  const mine = () => isStore() && m.store_id === myStoreId();
  function draw() {
    root.replaceChildren(); ctx.setTitle(m.mrf_no, storeName(m.store_id));
    const open = m.status === 'sent'; const v = vehicleById(jc?.vehicle_id);
    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: () => printPreview(m.mrf_no, mrfPrintHtml(m, lines, jc)) })];
    if (mine() && open) acts.push(btn('Return to workshop', { cls: 'sm', icon: 'undo', onClick: act(returnMrf) }), btn('Create delivery challan', { cls: 'primary', icon: 'truck', onClick: act(newDc) }));
    const t = dataTable({ hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 200, rows: lines, rowClass: (r) => (r.store_status === 'fulfilled' ? 'row-ok' : r.store_status === 'rejected' ? 'row-danger' : ''),
      columns: [
        { key: 'line_no', label: '#', num: true }, { key: 'item_text', label: 'Item requested', render: (r) => h('span', { class: 'cell-main' }, r.item_text) },
        { key: 'qty', label: 'Qty', num: true, render: (r) => fmtNum(r.qty) }, { key: 'unit', label: 'Unit' }, { key: 'remarks', label: 'Remarks' },
        { key: 'store_status', label: 'Store status', render: (r) => h('div', null, statusBadge('line', r.store_status), r.store_note ? h('div', { class: 'cell-sub' }, r.store_note) : null) },
        { key: 'x', label: '', sortable: false, render: (r) => (mine() && open ? h('div', { class: 'actions' }, r.store_status !== 'fulfilled' ? btn('Mark fulfilled', { cls: 'sm', onClick: act(() => setLine(r, 'fulfilled')) }) : btn('Reopen', { cls: 'sm', onClick: act(() => setLine(r, 'open')) }), r.store_status !== 'rejected' ? btn('Reject', { cls: 'sm danger ghost', onClick: act(() => setLine(r, 'rejected', true)) }) : null) : null) },
      ] });
    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, m.mrf_no), statusBadge('mrf', m.status), m.revision ? badge(`Revision ${m.revision}`, 'purple', true) : null), h('p', null, `${wsName(m.workshop_id)} · received ${fmtDateTime(m.sent_at)}`)), h('div', { class: 'actions' }, acts)),
      m.status === 'closed' ? h('div', { class: 'mb' }, banner('danger', `Closed by the workshop manager: ${m.close_reason || ''}. Products can no longer be issued.`, 'lock')) : null,
      m.status === 'returned' ? h('div', { class: 'mb' }, banner('warn', `Returned to workshop for changes: ${m.return_reason || ''}`)) : null,
      card({ title: 'Vehicle & job card (recorded for your documentation)', cls: 'mb', body: kv([['Job card', jc?.jc_no], ['Vehicle', v?.reg_no], ['Make / model', [v?.make, v?.model].filter(Boolean).join(' ')], ['Odometer', jc?.odometer != null ? `${fmtNum(jc.odometer, 1)} km` : null], ['Engine hour', jc?.engine_hour != null ? fmtNum(jc.engine_hour, 1) : null], ['Aux hour', jc?.aux_hour != null ? fmtNum(jc.aux_hour, 1) : null], ['Complaint type', jc?.complaint_type], ['Complaint', jc?.complaint], ['Raised by', userName(m.created_by)]]) }),
      card({ title: 'Items requested', flush: true, cls: 'mb', body: t.el }),
      m.remarks ? h('div', { class: 'mb' }, banner('info', `Remarks: ${m.remarks}`)) : null,
      card({ title: 'Delivery challans for this MRF', cls: 'mb', flush: !!dcs.length, body: dcs.length ? h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['DC no', 'Status', 'Created', ''].map((x) => h('th', null, x)))), h('tbody', null, dcs.map((d) => h('tr', { class: 'clickable', onClick: () => navigate(`/dcs/${d.id}`) }, h('td', { 'data-label': 'DC no' }, h('span', { class: 'cell-main mono' }, d.dc_no || 'DRAFT')), h('td', { 'data-label': 'Status' }, statusBadge('dc', d.status)), h('td', { 'data-label': 'Created' }, fmtDateTime(d.issued_at || d.created_at)), h('td', { 'data-label': '' }, icon('chevRight')))))) : emptyState({ icon: 'truck', title: 'No challans yet', text: open ? 'Press "Create delivery challan" to issue products.' : '' }) }));
  }
  async function setLine(r, status, ask) { let note = null; if (ask) { note = await promptBox({ title: 'Reject this line', label: 'Reason', confirmText: 'Reject line', tone: 'danger' }); if (!note) return; } await rpc('mrf_line_set', { p_line: r.id, p_status: status, p_note: note }); await load(); draw(); }
  async function returnMrf() { const r = await promptBox({ title: 'Return MRF to workshop', message: 'The workshop can edit and re-send it. Draft challans for this MRF are discarded.', label: 'What should the workshop change?', confirmText: 'Return MRF' }); if (!r) return; await rpc('mrf_return', { p_id: id, p_reason: r }); toast('MRF returned to workshop', 'warn'); await load(); draw(); }
  async function newDc() { const r = await run(sb.from('delivery_challans').insert({ store_id: m.store_id, mrf_id: id }).select('id').single()); navigate(`/dcs/${r.id}`); }
  await load(); draw();
  view.refresh = async () => { if (document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}
