// Workshop side: receive & acknowledge materials issued by stores
import { sb, S, run, rpc, fetchAll, isAdmin, isWs, myWorkshopId, wsName, storeName, productById, vehicleById, userName, lockDoc, unlockDoc } from '../core/api.js';
import { h, icon, pageHead, card, btn, act, toast, statusBadge, badge, confirmBox, banner, kv, tabsBar, inp } from '../core/ui.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { printPreview } from '../core/print.js';
import { dcPrintHtml } from './dc.js';
import { fmtDateTime, fmtNum, fmtMoney, num, round } from '../core/format.js';

const embed = '*, mrfs(mrf_no), job_cards(jc_no,vehicle_id), dc_lines(amount,ack_status)';

export async function list(ctx) {
  const root = h('div'); let rows = []; let cur = ctx.query.tab || 'issued';
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'issued', label: 'To acknowledge' }, { key: 'acknowledged', label: 'Acknowledged' }, { key: 'reversed', label: 'Reversed' }, { key: 'all', label: 'All' }], onChange: (k) => { cur = k; apply(); } });
  const tbl = dataTable({
    exportName: 'receipts', defaultSort: { key: 'issued_at', dir: 'desc' }, searchPlaceholder: 'Search DC, MRF, job card, vehicle, store...',
    rowClass: (r) => (r.status === 'issued' ? 'row-warn' : r.status === 'reversed' ? 'row-muted' : ''),
    filters: [{ key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }, ...(isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : [])],
    columns: [
      { key: 'dc_no', label: 'DC no', render: (r) => h('span', { class: 'cell-main mono' }, r.dc_no) },
      { key: 'store_id', label: 'From store', value: (r) => storeName(r.store_id) },
      { key: 'mrf', label: 'MRF', value: (r) => r.mrfs?.mrf_no || '' }, { key: 'jc', label: 'Job card', value: (r) => r.job_cards?.jc_no || '' },
      { key: 'reg', label: 'Vehicle', value: (r) => vehicleById(r.job_cards?.vehicle_id)?.reg_no || '' },
      ...(isAdmin() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
      { key: 'pending', label: 'Lines pending', num: true, value: (r) => r.dc_lines.filter((l) => l.ack_status === 'pending').length, render: (r) => { const n = r.dc_lines.filter((l) => l.ack_status === 'pending').length; return r.status === 'issued' ? badge(`${n} of ${r.dc_lines.length}`, 'warn', true) : `${r.dc_lines.length}`; } },
      { key: 'amount', label: 'Value', num: true, value: (r) => r.dc_lines.reduce((a, l) => a + Number(l.amount), 0), render: (r) => fmtMoney(r.dc_lines.reduce((a, l) => a + Number(l.amount), 0)) },
      { key: 'status', label: 'Status', render: (r) => statusBadge('dc', r.status) },
      { key: 'issued_at', label: 'Issued', render: (r) => fmtDateTime(r.issued_at) },
    ],
    onRowClick: (r) => navigate(`/receipts/${r.id}`),
    empty: { icon: 'packagePlus', title: 'Nothing to receive', text: 'Materials issued by stores against your MRFs appear here.' },
  });
  const apply = () => tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur));
  async function load() {
    rows = await fetchAll(() => sb.from('delivery_challans').select(embed).neq('status', 'draft').order('issued_at', { ascending: false }));
    const c = { all: rows.length }; ['issued', 'acknowledged', 'reversed'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length)); tabs.setCounts(c); apply();
  }
  await load();
  root.append(pageHead({ title: 'Receive Materials', sub: 'Acknowledge every product: consume it on the job card, keep it in workshop stock, or queue it for return.' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

export async function detail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false };
  let d, lines, mrf, jc; let canAck = false; let lockMsg = null;

  async function load() {
    d = await run(sb.from('delivery_challans').select('*').eq('id', id).maybeSingle()); if (!d || d.status === 'draft') throw new Error('Delivery challan not found.');
    [lines, mrf, jc] = await Promise.all([run(sb.from('dc_lines').select('*').eq('dc_id', id).order('line_no')), run(sb.from('mrfs').select('*').eq('id', d.mrf_id).maybeSingle()), run(sb.from('job_cards').select('*').eq('id', d.job_card_id).maybeSingle())]);
  }
  async function acquire() {
    canAck = false; lockMsg = null;
    if (!(isWs() && d.workshop_id === myWorkshopId() && d.status === 'issued' && jc?.status === 'open')) return;
    const r = await lockDoc('dc', id); if (r.ok) canAck = true; else lockMsg = `${r.holder} is acknowledging this challan right now.`;
  }
  async function reloadAll() { await load(); await acquire(); draw(); }

  function draw() {
    root.replaceChildren(); view.isForm = canAck; ctx.setTitle(d.dc_no, wsName(d.workshop_id));
    const pending = lines.filter((l) => l.ack_status === 'pending');
    const cards = lines.map((l) => {
      const p = productById(l.product_id); const done = l.ack_status === 'acknowledged';
      const stockI = inp({ type: 'number', min: '0', step: p?.allow_decimal ? 'any' : '1', value: 0, style: { width: '110px' } });
      const retI = inp({ type: 'number', min: '0', step: p?.allow_decimal ? 'any' : '1', value: 0, style: { width: '110px' } });
      const cons = h('b', null, fmtNum(l.qty));
      const upd = () => { const c = round(Number(l.qty) - num(stockI.value) - num(retI.value), 3); cons.textContent = fmtNum(c); cons.style.color = c < 0 ? 'var(--danger)' : ''; };
      stockI.oninput = retI.oninput = upd;
      const ackBtn = btn('Acknowledge', { cls: 'primary sm', icon: 'check', onClick: act(async () => {
        const s = num(stockI.value), r = num(retI.value);
        if (s < 0 || r < 0 || s + r > Number(l.qty)) throw new Error(`Stock + return cannot exceed the issued quantity (${fmtNum(l.qty)})`);
        await rpc('dc_ack_line', { p_line: l.id, p_stock: s, p_return: r }); toast(`${p.item_code} acknowledged`); await reloadAll();
      }) });
      return h('div', { class: 'card', style: { boxShadow: 'none', borderColor: done ? 'var(--border)' : 'var(--warn)' } },
        h('div', { class: 'card-body' }, h('div', { class: 'row between' },
          h('div', null, h('div', { class: 'bold' }, p?.description), h('div', { class: 'small muted' }, `${p?.item_code}${p?.part_no ? ' · Part ' + p.part_no : ''}`)),
          h('div', { class: 'row' }, h('span', { class: 'badge b-info plain' }, `Issued ${fmtNum(l.qty)} ${p?.uom}`), Number(p?.pack_qty) > 1 ? h('span', { class: 'small muted' }, `= ${fmtNum(l.base_qty)} ${p.base_uom}`) : null, done ? badge('Acknowledged', 'ok', true) : null)),
          done ? h('div', { class: 'row mt gap-lg small' }, h('span', null, 'Consumed on job card: ', h('b', null, fmtNum(l.ack_consume))), h('span', null, 'To workshop stock: ', h('b', null, fmtNum(l.ack_stock))), h('span', null, 'Queued for return: ', h('b', null, fmtNum(l.ack_return))), h('span', { class: 'muted' }, fmtDateTime(l.acked_at)))
            : canAck ? h('div', { class: 'mt' }, h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '16px' } },
              h('div', { class: 'field' }, h('label', null, `Keep in workshop stock (${p?.uom})`), stockI), h('div', { class: 'field' }, h('label', null, `Send to return queue (${p?.uom})`), retI),
              h('div', { class: 'field' }, h('label', null, 'Consumed on job card (automatic)'), h('div', { style: { height: '40px', display: 'flex', alignItems: 'center', fontSize: '16px' } }, cons, h('span', { class: 'muted', style: { marginLeft: '6px' } }, p?.uom))), h('div', { class: 'grow' }), ackBtn))
            : h('div', { class: 'mt small muted' }, 'Waiting for acknowledgement')));
    });
    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: () => printPreview(d.dc_no, dcPrintHtml(d, lines, mrf, jc)) })];
    if (canAck && pending.length > 1) acts.push(btn('Consume all remaining', { cls: 'sm', icon: 'checkCircle', onClick: act(async () => {
      if (!(await confirmBox({ title: 'Acknowledge everything as consumed?', message: `${pending.length} remaining line(s) will be fully consumed on job card ${jc.jc_no}. If you want to keep stock or return some, use the per-line boxes instead.`, confirmText: 'Consume all', tone: 'success' }))) return;
      for (const l of pending) await rpc('dc_ack_line', { p_line: l.id, p_stock: 0, p_return: 0 }); toast('All lines acknowledged'); await reloadAll();
    }) }));
    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, d.dc_no), statusBadge('dc', d.status)), h('p', null, `${storeName(d.store_id)} → ${wsName(d.workshop_id)} · issued ${fmtDateTime(d.issued_at)}`)), h('div', { class: 'actions' }, acts)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', lockMsg)) : null,
      d.status === 'reversed' ? h('div', { class: 'mb' }, banner('danger', `This challan was reversed by the store: ${d.reverse_reason || ''}`)) : null,
      d.status === 'issued' && jc?.status !== 'open' ? h('div', { class: 'mb' }, banner('warn', 'The job card is no longer open, so these items cannot be acknowledged.')) : null,
      canAck ? h('div', { class: 'mb' }, banner('info', 'Quantities are in the issue unit. Whatever you do not keep in stock or return is added automatically to the job card as consumption.')) : null,
      card({ title: 'Reference', cls: 'mb', body: kv([['MRF', mrf ? h('a', { href: `#/mrfs/${mrf.id}` }, mrf.mrf_no) : null], ['Job card', jc ? h('a', { href: `#/jobcards/${jc.id}` }, jc.jc_no) : null], ['Vehicle', vehicleById(jc?.vehicle_id)?.reg_no], ['Issued by', userName(d.issued_by)], ['Remarks', d.remarks]]) }),
      h('div', { class: 'col' }, cards));
  }
  await load(); await acquire(); draw();
  view.destroy = async () => { if (canAck) await unlockDoc('dc', id); };
  view.refresh = async () => { if (canAck || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}
