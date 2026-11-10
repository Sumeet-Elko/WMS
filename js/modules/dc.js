// Delivery challans issued by stores (list, draft form, issue, reverse, print)
import { sb, S, run, rpc, reload, setting, fetchAll, isAdmin, isStore, myStoreId, wsById, wsName, storeById, storeName, productById, vehicleById, userName, productOptions, lockDoc, unlockDoc } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, tabsBar, emptyState } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { autosaver } from '../core/autosave.js';
import { printPreview, docHeader, docFooter, box } from '../core/print.js';
import { fmtDateTime, fmtNum, fmtMoney, fmtQty, num, esc, round } from '../core/format.js';

const embed = '*, mrfs(mrf_no), job_cards(jc_no,vehicle_id), dc_lines(amount)';
const total = (r) => (r.dc_lines || []).reduce((a, l) => a + Number(l.amount), 0);

/* =================================================================== LIST */
export async function list(ctx) {
  const root = h('div'); let rows = []; let cur = ctx.query.tab || 'all';
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'all', label: 'All' }, { key: 'draft', label: 'Draft queue' }, { key: 'issued', label: 'Issued' }, { key: 'acknowledged', label: 'Acknowledged' }, { key: 'reversed', label: 'Reversed' }], onChange: (k) => { cur = k; apply(); } });
  const tbl = dataTable({
    exportName: 'delivery-challans', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search DC, MRF, job card, vehicle, workshop...',
    rowClass: (r) => (r.status === 'reversed' ? 'row-muted' : r.status === 'draft' ? 'row-warn' : ''),
    filters: [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }, ...(isAdmin() ? [{ key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }] : [])],
    columns: [
      { key: 'dc_no', label: 'DC no', render: (r) => h('span', { class: 'cell-main mono' }, r.dc_no || 'DRAFT') },
      { key: 'mrf', label: 'MRF', value: (r) => r.mrfs?.mrf_no || '' }, { key: 'jc', label: 'Job card', value: (r) => r.job_cards?.jc_no || '' },
      { key: 'reg', label: 'Vehicle', value: (r) => vehicleById(r.job_cards?.vehicle_id)?.reg_no || '' },
      { key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) },
      ...(isAdmin() ? [{ key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) }] : []),
      { key: 'lines', label: 'Items', num: true, value: (r) => (r.dc_lines || []).length },
      { key: 'amount', label: 'Value', num: true, value: total, render: (r) => fmtMoney(total(r)) },
      { key: 'status', label: 'Status', render: (r) => statusBadge('dc', r.status) },
      { key: 'created_at', label: 'Date', render: (r) => h('div', null, h('div', null, fmtDateTime(r.issued_at || r.created_at)), h('div', { class: 'cell-sub' }, userName(r.issued_by || r.created_by))) },
    ],
    onRowClick: (r) => navigate(`/dcs/${r.id}`),
    empty: { icon: 'truck', title: 'No delivery challans', text: 'Open a request in the MRF Inbox and create a delivery challan.' },
  });
  const apply = () => tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur));
  async function load() {
    rows = await fetchAll(() => sb.from('delivery_challans').select(embed).order('created_at', { ascending: false }));
    const c = { all: rows.length }; ['draft', 'issued', 'acknowledged', 'reversed'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length)); tabs.setCounts(c); apply();
  }
  await load();
  root.append(pageHead({ title: 'Delivery Challans', sub: 'Drafts wait in the queue until you review and issue them. Challans are numbered per store.' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== PRINT (shared with workshop view) */
export function dcPrintHtml(d, lines, mrf, jc) {
  const s = storeById(d.store_id); const w = wsById(d.workshop_id); const v = vehicleById(jc?.vehicle_id);
  const amt = lines.reduce((a, l) => a + Number(l.amount || num(l.qty) * num(l.rate)), 0);
  const blank = Array.from({ length: Math.max(0, 6 - lines.length) }, () => '<tr class="blankrow"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  return `${docHeader({ title: 'Delivery Challan', no: d.dc_no, status: d.status === 'draft' ? 'Draft' : d.status === 'reversed' ? 'Reversed' : '' })}
    <div class="grid2">
      ${box('From - Store', `<div class="big">${esc(s?.name)}</div>${esc(s?.address || '')}<br>${esc([s?.contact_name, s?.contact_phone].filter(Boolean).join(' · '))}${s?.gstin ? `<br>GSTIN: ${esc(s.gstin)}` : ''}`)}
      ${box('To - Workshop', `<div class="big">${esc(w?.name)}</div>${esc(w?.address || '')}<br>${esc([w?.contact_name, w?.contact_phone].filter(Boolean).join(' · '))}`)}
    </div>
    <div class="grid3">
      ${box('Date & time', esc(fmtDateTime(d.issued_at || new Date())))}
      ${box('Against MRF / Job card', `<b>${esc(mrf?.mrf_no || '—')}</b><br>${esc(jc?.jc_no || '—')}`)}
      ${box('Vehicle', `<b>${esc(v?.reg_no || '—')}</b><br>${esc([v?.make, v?.model].filter(Boolean).join(' '))}`)}
    </div>
    <table><thead><tr><th style="width:26px">#</th><th style="width:15%">Item code</th><th>Description</th><th style="width:60px">HSN</th><th class="num" style="width:75px">Qty</th><th class="num" style="width:80px">Rate</th><th class="num" style="width:90px">Amount</th></tr></thead><tbody>
      ${lines.map((l, i) => { const p = productById(l.product_id); const a = Number(l.amount || num(l.qty) * num(l.rate)); return `<tr><td>${i + 1}</td><td>${esc(p?.item_code)}</td><td>${esc(p?.description)}${p?.part_no ? `<br><small>Part ${esc(p.part_no)}</small>` : ''}${Number(p?.pack_qty) > 1 ? `<br><small>1 ${esc(p.uom)} = ${fmtNum(p.pack_qty)} ${esc(p.base_uom)}</small>` : ''}${l.remarks ? `<br><small>${esc(l.remarks)}</small>` : ''}</td><td>${esc(p?.hsn || '')}</td><td class="num">${fmtNum(l.qty)} ${esc(p?.uom || '')}</td><td class="num">${fmtNum(l.rate, 2)}</td><td class="num">${fmtNum(a, 2)}</td></tr>`; }).join('')}${blank}</tbody>
      <tfoot><tr><td colspan="6" class="num">Total value</td><td class="num">${fmtMoney(amt)}</td></tr></tfoot></table>
    ${d.remarks ? `<div class="note"><b>Remarks:</b> ${esc(d.remarks)}</div>` : ''}
    <div class="note">Goods issued for internal use against the job card above. Not for sale.</div>
    <div class="sig"><div>Prepared by</div><div>Store In-charge</div><div>Received by (Workshop)</div><div>Date / time received</div></div>
    ${docFooter(S.profile.full_name)}`;
}

/* =================================================================== DETAIL / FORM */
export async function detail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false };
  let d, lines = [], mrf, mrfLines = [], jc, storeBal = new Map(), wsBal = new Map(); let canEdit = false; let lockMsg = null; let auto = null; let st = null;

  async function load() {
    d = await run(sb.from('delivery_challans').select('*').eq('id', id).maybeSingle()); if (!d) throw new Error('Delivery challan not found.');
    [lines, mrf, mrfLines, jc] = await Promise.all([
      run(sb.from('dc_lines').select('*').eq('dc_id', id).order('line_no')), run(sb.from('mrfs').select('*').eq('id', d.mrf_id).maybeSingle()),
      run(sb.from('mrf_lines').select('*').eq('mrf_id', d.mrf_id).order('line_no')), run(sb.from('job_cards').select('*').eq('id', d.job_card_id).maybeSingle())]);
    if (d.status === 'draft' && (isStore() || isAdmin())) {
      const [sbal, wbal] = await Promise.all([run(sb.from('stock_balances').select('*').eq('location_type', 'store').eq('location_id', d.store_id)), run(sb.from('stock_balances').select('*').eq('location_type', 'workshop').eq('location_id', d.workshop_id))]);
      storeBal = new Map(sbal.map((b) => [b.product_id, b])); wsBal = new Map(wbal.map((b) => [b.product_id, b]));
    }
  }
  const editable = () => isStore() && d.store_id === myStoreId() && d.status === 'draft' && mrf?.status === 'sent';
  async function acquire() { canEdit = false; lockMsg = null; if (!editable()) return; const r = await lockDoc('dc', id); if (r.ok) canEdit = true; else lockMsg = `${r.holder} is editing this delivery challan right now.`; }
  async function reloadAll() { if (auto) await auto.flush().catch(() => {}); const had = canEdit; await load(); await acquire(); if (had && !canEdit) await unlockDoc('dc', id); draw(); }

  async function save() {
    if (!canEdit || !st) return;
    await run(sb.from('delivery_challans').update({ remarks: st.remarks.value || null }).eq('id', id));
    const keep = st.lines.filter((l) => l.product_id && num(l.qty) > 0);
    await run(sb.from('dc_lines').delete().eq('dc_id', id));
    if (keep.length) await run(sb.from('dc_lines').insert(keep.map((l, i) => ({ dc_id: id, line_no: i + 1, mrf_line_id: l.mrf_line_id || null, product_id: l.product_id, qty: num(l.qty), rate: Math.max(0, num(l.rate)), remarks: l.remarks || null }))));
  }

  const avgRate = (pid) => { const p = productById(pid); const b = storeBal.get(pid); return p && b && Number(b.qty) > 0 ? round((Number(b.value) / Number(b.qty)) * Number(p.pack_qty), 2) : 0; };

  function draw() {
    root.replaceChildren(); view.isForm = canEdit; auto = canEdit ? autosaver({ save }) : null; ctx.setTitle(d.dc_no || 'New delivery challan', storeName(d.store_id));
    const dis = !canEdit;
    const remarks = textarea({ value: d.remarks || '', disabled: dis, rows: 2, placeholder: 'Optional remarks' }); remarks.oninput = () => auto?.trigger();
    st = { remarks, lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, rate: l.rate, mrf_line_id: l.mrf_line_id, remarks: l.remarks || '' })) };
    if (canEdit && !st.lines.length) st.lines.push({ product_id: null, qty: '', rate: '', mrf_line_id: null, remarks: '' });

    const grid = h('div', { class: 'lines-wrap' }); const totalEl = h('b'); const warnEl = h('div');
    const mrfOpts = mrfLines.map((l) => ({ value: l.id, label: `#${l.line_no} ${l.item_text}`, sub: `Requested ${fmtNum(l.qty)} ${l.unit || ''}` }));
    function sums() { const t = st.lines.reduce((a, l) => a + num(l.qty) * num(l.rate), 0); totalEl.textContent = fmtMoney(t); }
    function drawLines() {
      const tb = h('tbody');
      st.lines.forEach((l, i) => {
        const p = productById(l.product_id); const sbq = storeBal.get(l.product_id); const wbq = wsBal.get(l.product_id);
        const stock = h('div', { class: 'small muted' });
        const setStock = () => { const pp = productById(l.product_id); if (!pp) { stock.textContent = ''; return; } const a = storeBal.get(pp.id); const w = wsBal.get(pp.id); const need = num(l.qty) * Number(pp.pack_qty); stock.replaceChildren(h('span', { style: { color: a && Number(a.qty) >= need ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 } }, `Store stock: ${fmtQty(pp, a?.qty || 0)}`), ` · Workshop holds: ${fmtQty(pp, w?.qty || 0)}`); };
        const psel = selectBox({ options: productOptions(true), value: l.product_id, placeholder: 'Search item code / description / part no...', disabled: dis, clearable: false, onChange: (v) => { l.product_id = v; if (!num(l.qty)) l.qty = 1; l.rate = avgRate(v) || l.rate || 0; drawLines(); auto?.trigger(); } });
        const q = inp({ type: 'number', min: '0', step: p?.allow_decimal ? 'any' : '1', value: l.qty, disabled: dis, style: { minWidth: '80px' } }); q.oninput = () => { l.qty = q.value; sums(); setStock(); auto?.trigger(); };
        const r = inp({ type: 'number', min: '0', step: 'any', value: l.rate, disabled: dis, style: { minWidth: '90px' }, placeholder: 'Rate' }); r.oninput = () => { l.rate = r.value; sums(); auto?.trigger(); };
        const ml = selectBox({ options: mrfOpts, value: l.mrf_line_id, placeholder: 'Requested line (optional)', disabled: dis, onChange: (v) => { l.mrf_line_id = v; auto?.trigger(); } });
        const rm = inp({ value: l.remarks, disabled: dis, placeholder: 'Remarks' }); rm.oninput = () => { l.remarks = rm.value; auto?.trigger(); };
        setStock();
        tb.appendChild(h('tr', null, h('td', { class: 'n' }, i + 1),
          h('td', { style: { minWidth: '280px' } }, psel, stock),
          h('td', null, h('div', { class: 'row nowrap' }, q, h('span', { class: 'muted small nowrap' }, p?.uom || ''))),
          h('td', null, h('div', { class: 'row nowrap' }, r, h('span', { class: 'muted small nowrap' }, p ? `/ ${p.uom}` : ''))),
          h('td', { class: 'num nowrap', style: { paddingTop: '16px', fontWeight: 600 } }, fmtMoney(num(l.qty) * num(l.rate))),
          h('td', { style: { minWidth: '200px' } }, ml, h('div', { style: { height: '6px' } }), rm),
          h('td', { style: { width: '48px' } }, canEdit ? iconBtn('trash', 'Remove line', () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push({ product_id: null, qty: '', rate: '', mrf_line_id: null, remarks: '' }); drawLines(); auto?.trigger(); }) : null)));
      });
      grid.replaceChildren(h('table', { class: 'lines' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Product'), h('th', null, 'Qty (issue UOM)'), h('th', null, 'Rate'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Against request / remarks'), h('th'))), tb));
      if (canEdit) grid.appendChild(h('div', { style: { marginTop: '10px' } }, btn('Add product', { cls: 'sm', icon: 'plus', onClick: () => { st.lines.push({ product_id: null, qty: '', rate: '', mrf_line_id: null, remarks: '' }); drawLines(); } })));
      sums();
    }

    let body;
    if (canEdit) { drawLines(); body = h('div', { class: 'col' }, grid, h('div', { class: 'row between' }, field('Remarks', remarks, { cls: 'grow' }), h('div', { style: { fontSize: '16px' } }, 'Total: ', totalEl))); }
    else {
      const t = dataTable({ hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 200, rows: lines,
        columns: [{ key: 'line_no', label: '#', num: true }, { key: 'p', label: 'Product', value: (r) => productById(r.product_id)?.item_code, render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description), h('div', { class: 'cell-sub mono' }, p?.item_code)); } },
          { key: 'qty', label: 'Issued', num: true, render: (r) => `${fmtNum(r.qty)} ${productById(r.product_id)?.uom || ''}` }, { key: 'base_qty', label: 'In base unit', num: true, render: (r) => `${fmtNum(r.base_qty)} ${productById(r.product_id)?.base_uom || ''}` },
          { key: 'rate', label: 'Rate', num: true, render: (r) => fmtMoney(r.rate) }, { key: 'amount', label: 'Amount', num: true, render: (r) => fmtMoney(r.amount) },
          { key: 'ack', label: 'Workshop acknowledgement', render: (r) => (r.ack_status === 'acknowledged' ? h('div', { class: 'small' }, badge('Acknowledged', 'ok', true), h('div', { class: 'cell-sub' }, `Consumed ${fmtNum(r.ack_consume)} · To stock ${fmtNum(r.ack_stock)} · Returned ${fmtNum(r.ack_return)}`)) : badge('Pending', 'muted', true)) }],
        footer: () => h('tr', null, h('td', { colspan: 5 }, 'Total value'), h('td', { class: 'num' }, fmtMoney(lines.reduce((a, l) => a + Number(l.amount), 0))), h('td')) });
      body = h('div', { class: 'col' }, h('div', { style: { margin: '-18px -18px 0' } }, t.el), d.remarks ? banner('info', `Remarks: ${d.remarks}`) : null);
    }

    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: act(print) })];
    if (canEdit) acts.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(delDraft) }), btn('Issue products', { cls: 'primary', icon: 'send', onClick: act(issue) }));
    if (d.status === 'issued' && ((isStore() && d.store_id === myStoreId()) || isAdmin())) acts.push(btn('Reverse issue', { cls: 'danger ghost sm', icon: 'undo', onClick: act(reverse) }));

    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, d.dc_no || 'New delivery challan'), statusBadge('dc', d.status)), h('p', null, `${storeName(d.store_id)} → ${wsName(d.workshop_id)}`)), h('div', { class: 'actions' }, auto ? auto.el : null, acts)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', lockMsg)) : null,
      d.status === 'draft' && mrf && mrf.status !== 'sent' ? h('div', { class: 'mb' }, banner('danger', `The MRF is ${mrf.status}. Products can no longer be issued against it.`, 'lock')) : null,
      d.status === 'reversed' ? h('div', { class: 'mb' }, banner('danger', `Reversed ${fmtDateTime(d.reversed_at)} by ${userName(d.reversed_by)}: ${d.reverse_reason || ''}. Stock was returned to the store.`)) : null,
      card({ title: 'Reference', cls: 'mb', body: kv([['MRF', mrf ? h('a', { href: `#/inbox/${mrf.id}` }, mrf.mrf_no) : null], ['Job card', jc?.jc_no], ['Vehicle', vehicleById(jc?.vehicle_id)?.reg_no], ['Workshop', wsName(d.workshop_id)], ['Issued', d.issued_at ? `${fmtDateTime(d.issued_at)} by ${userName(d.issued_by)}` : 'Not issued yet']]) }),
      card({ title: canEdit ? 'Products to issue' : 'Products', body, flush: false, cls: 'mb' }));
  }

  async function print() {
    if (auto) await auto.flush().catch(() => {});
    const ls = canEdit ? st.lines.filter((l) => l.product_id && num(l.qty) > 0).map((l) => ({ ...l, amount: num(l.qty) * num(l.rate) })) : lines;
    if (!ls.length) throw new Error('Add at least one product first.'); printPreview(d.dc_no || 'Delivery challan', dcPrintHtml({ ...d, remarks: canEdit ? st.remarks.value : d.remarks }, ls, mrf, jc));
  }
  async function delDraft() { if (!(await confirmBox({ title: 'Delete this draft challan?', message: 'This cannot be undone.', tone: 'danger', confirmText: 'Delete' }))) return; auto.disable(); canEdit = false; await run(sb.from('delivery_challans').delete().eq('id', id)); toast('Draft deleted'); navigate(`/inbox/${d.mrf_id}`); }
  async function issue() {
    const ls = st.lines.filter((l) => l.product_id);
    if (!ls.length) throw new Error('Add at least one product');
    for (const l of ls) {
      const p = productById(l.product_id);
      if (!(num(l.qty) > 0)) throw new Error(`Enter a quantity for ${p.item_code}`);
      if (l.rate === '' || l.rate === null || num(l.rate) < 0) throw new Error(`Enter the rate for ${p.item_code} (zero or more)`);
      if (!p.allow_decimal && num(l.qty) !== Math.trunc(num(l.qty))) throw new Error(`${p.item_code} must be issued in whole numbers`);
    }
    const byP = new Map(); ls.forEach((l) => byP.set(l.product_id, (byP.get(l.product_id) || 0) + num(l.qty) * Number(productById(l.product_id).pack_qty)));
    await reload('settings');
    if (setting('enforce_store_stock', true) !== false) for (const [pid, need] of byP) { const have = Number(storeBal.get(pid)?.qty || 0); if (need > have) throw new Error(`Insufficient store stock for ${productById(pid).item_code}: have ${fmtQty(productById(pid), have)}, issuing ${fmtQty(productById(pid), need)}`); }
    const tot = ls.reduce((a, l) => a + num(l.qty) * num(l.rate), 0);
    if (!(await confirmBox({ title: 'Issue these products?', message: `${ls.length} line(s), total ${fmtMoney(tot)}. Stock is deducted from ${storeName(d.store_id)} and the challan can no longer be edited (it can only be reversed).`, confirmText: 'Issue products', tone: 'success' }))) return;
    st.lines = ls; await auto.flush(); const no = await rpc('dc_issue', { p_id: id }); toast(`Delivery challan ${no} issued`); await reloadAll();
  }
  async function reverse() {
    const r = await promptBox({ title: `Reverse ${d.dc_no}`, message: 'Stock goes back to the store through a reversing ledger entry. Only possible while the workshop has not acknowledged anything.', label: 'Reason', tone: 'danger', confirmText: 'Reverse challan' });
    if (!r) return; await rpc('dc_reverse', { p_id: id, p_reason: r }); toast('Delivery challan reversed', 'warn'); await reloadAll();
  }

  await load(); await acquire(); draw();
  view.flush = async () => { if (auto) await auto.flush(); };
  view.destroy = async () => { if (canEdit) { try { if (auto) await auto.flush(); } catch { /* ignore */ } await unlockDoc('dc', id); } };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}
