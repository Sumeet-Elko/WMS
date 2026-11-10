// Stock views, ledger and store inwards
import { sb, S, run, rpc, fetchAll, isAdmin, isWs, isStore, myWorkshopId, myStoreId, wsName, storeName, productById, userName, productOptions } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, kpi, emptyState } from '../core/ui.js';
import { selectBox, strOpts } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { fmtDateTime, fmtDate, fmtNum, fmtMoney, fmtQty, num, daysSince, toDateInput, round } from '../core/format.js';

const locName = (r) => (r.location_type === 'workshop' ? wsName(r.location_id) : storeName(r.location_id));
const ageTone = (d) => (d > 90 ? 'danger' : d > 60 ? 'warn' : d > 30 ? 'info' : 'ok');

function stockColumns({ showLoc }) {
  return [
    { key: 'item', label: 'Item', value: (r) => productById(r.product_id)?.item_code, render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description || '?'), h('div', { class: 'cell-sub mono' }, [p?.item_code, p?.brand, p?.spare_type].filter(Boolean).join(' · '))); } },
    ...(showLoc ? [{ key: 'loc', label: 'Location', value: locName, render: (r) => h('div', null, h('div', { class: 'cell-main' }, locName(r)), h('div', { class: 'cell-sub' }, r.location_type === 'workshop' ? 'Workshop' : 'Store')) }] : []),
    { key: 'qty', label: 'On hand', num: true, value: (r) => Number(r.qty), render: (r) => { const p = productById(r.product_id); const low = p && Number(p.min_stock) > 0 && Number(r.qty) <= Number(p.min_stock); return h('div', { style: { color: low ? 'var(--danger)' : '' } }, h('b', null, fmtQty(p, r.qty)), low ? h('div', { class: 'cell-sub', style: { color: 'var(--danger)' } }, `Min ${fmtNum(p.min_stock)}`) : null); } },
    { key: 'value', label: 'Value (cost)', num: true, value: (r) => Number(r.value), render: (r) => fmtMoney(r.value) },
    { key: 'avg', label: 'Avg cost / unit', num: true, value: (r) => (Number(r.qty) ? Number(r.value) / Number(r.qty) : 0), render: (r) => (Number(r.qty) ? fmtMoney(Number(r.value) / Number(r.qty)) : '—') },
    { key: 'age', label: 'Last movement', num: true, value: (r) => daysSince(r.updated_at), render: (r) => { const d = daysSince(r.updated_at); return h('div', null, badge(d === 0 ? 'Today' : `${d} d ago`, ageTone(d), true)); } },
  ];
}
const stockFooter = (rows) => h('tr', null, h('td', { colspan: 2 }, `${rows.length} item(s)`), h('td', { class: 'num' }), h('td', { class: 'num' }, fmtMoney(rows.reduce((a, r) => a + Number(r.value), 0))), h('td', { colspan: 2 }));

/* =================================================================== WORKSHOP STOCK (own only) */
export async function workshopStock() {
  const root = h('div'); let rows = [];
  const tbl = dataTable({
    exportName: 'workshop-stock', defaultSort: { key: 'item', dir: 'asc' }, searchPlaceholder: 'Search item...', columns: stockColumns({ showLoc: false }),
    filters: [{ key: 'brand', label: 'All brands', value: (r) => productById(r.product_id)?.brand }, { key: 'cat', label: 'All categories', value: (r) => productById(r.product_id)?.category }],
    footer: stockFooter, onRowClick: (r) => navigate(`/ledger?product=${r.product_id}`),
    empty: { icon: 'layers', title: 'No stock in your workshop', text: 'Stock arrives when you acknowledge deliveries and choose "keep in workshop stock".' },
  });
  const k = h('div', { class: 'grid c3 mb' });
  async function load() {
    rows = await fetchAll(() => sb.from('stock_balances').select('*').eq('location_type', 'workshop').eq('location_id', myWorkshopId()).gt('qty', 0).order('updated_at', { ascending: false }));
    tbl.setRows(rows);
    k.replaceChildren(kpi({ icon: 'package', tone: 'blue', label: 'Items in stock', value: rows.length }), kpi({ icon: 'rupee', tone: 'green', label: 'Stock value (cost)', value: fmtMoney(rows.reduce((a, r) => a + Number(r.value), 0)) }),
      kpi({ icon: 'alert', tone: 'red', label: 'At / below minimum', value: rows.filter((r) => { const p = productById(r.product_id); return p && Number(p.min_stock) > 0 && Number(r.qty) <= Number(p.min_stock); }).length }));
  }
  await load();
  root.append(pageHead({ title: 'My Workshop Stock', sub: `${wsName(myWorkshopId())} - only your workshop's stock is visible to you. Click an item to see its movements.` }), k, h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== ALL STOCK (admin / stores) */
export async function allStock() {
  const root = h('div'); let rows = [];
  const tbl = dataTable({
    exportName: 'stock', defaultSort: { key: 'item', dir: 'asc' }, searchPlaceholder: 'Search item, location...', columns: stockColumns({ showLoc: true }),
    filters: [{ key: 'location_type', label: 'Workshops & stores', options: [{ value: 'workshop', label: 'Workshops only' }, { value: 'store', label: 'Stores only' }] },
      { key: 'loc', label: 'All locations', value: locName }, { key: 'cat', label: 'All categories', value: (r) => productById(r.product_id)?.category },
      { key: 'low', label: 'All stock levels', options: [{ value: 'low', label: 'At / below minimum' }, { value: 'ok', label: 'Above minimum' }], test: (r, v) => { const p = productById(r.product_id); const low = p && Number(p.min_stock) > 0 && Number(r.qty) <= Number(p.min_stock); return v === 'low' ? low : !low; } },
      { key: 'age', label: 'All ageing', options: [{ value: '30', label: 'Idle over 30 days' }, { value: '60', label: 'Idle over 60 days' }, { value: '90', label: 'Idle over 90 days' }], test: (r, v) => daysSince(r.updated_at) > Number(v) }],
    footer: stockFooter, onRowClick: (r) => navigate(`/ledger?product=${r.product_id}&loc=${r.location_id}`),
    empty: { icon: 'layers', title: 'No stock recorded yet', text: 'Post a Stock Inward in a store to add opening / purchased stock.' },
  });
  const k = h('div', { class: 'grid c4 mb' });
  async function load() {
    rows = await fetchAll(() => sb.from('stock_balances').select('*').gt('qty', 0).order('updated_at', { ascending: false }));
    tbl.setRows(rows);
    const st = rows.filter((r) => r.location_type === 'store'); const ws = rows.filter((r) => r.location_type === 'workshop'); const sum = (a) => a.reduce((x, r) => x + Number(r.value), 0);
    k.replaceChildren(kpi({ icon: 'store', tone: 'blue', label: 'Store stock value', value: fmtMoney(sum(st)), hint: `${st.length} lines` }), kpi({ icon: 'factory', tone: 'teal', label: 'Workshop stock value', value: fmtMoney(sum(ws)), hint: `${ws.length} lines` }),
      kpi({ icon: 'clock', tone: 'amber', label: 'Idle over 60 days', value: rows.filter((r) => daysSince(r.updated_at) > 60).length, hint: 'stock lines' }), kpi({ icon: 'alert', tone: 'red', label: 'At / below minimum', value: rows.filter((r) => { const p = productById(r.product_id); return p && Number(p.min_stock) > 0 && Number(r.qty) <= Number(p.min_stock); }).length, hint: 'stock lines' }));
  }
  await load();
  root.append(pageHead({ title: 'Stock - All Locations', sub: 'Live stock of every store and workshop, with ageing. Click a line to see its movements.' }), k, h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== LEDGER */
const TXN = { inward: ['Inward', 'ok'], issue: ['Issued to workshop', 'info'], issue_reversal: ['Issue reversed', 'danger'], receive: ['Received', 'teal'], consume: ['Consumed', 'purple'], consume_void: ['Consumption voided', 'danger'], return_queue: ['To return queue', 'warn'], return_in: ['Return accepted', 'ok'], rejected_back: ['Rejected - taken back', 'warn'], inward_reversal: ['Inward reversed', 'danger'] };
export async function ledger(ctx) {
  const root = h('div'); let rows = [];
  const from = inp({ type: 'date', value: toDateInput(new Date(Date.now() - 30 * 86400000)) }); const to = inp({ type: 'date', value: toDateInput(new Date()) });
  const prod = selectBox({ options: productOptions(false), value: ctx.query.product || null, placeholder: 'All items' });
  const locOpts = isAdmin() || isStore() ? [...S.workshops.map((w) => ({ value: w.id, label: w.name, sub: 'Workshop' })), ...S.stores.map((w) => ({ value: w.id, label: w.name, sub: 'Store' }))] : [];
  const loc = selectBox({ options: locOpts, value: ctx.query.loc || null, placeholder: 'All locations' });
  const tbl = dataTable({
    exportName: 'stock-ledger', defaultSort: { key: 'id', dir: 'desc' }, searchPlaceholder: 'Search reference, item, note...',
    filters: [{ key: 'txn_type', label: 'All movement types', options: Object.entries(TXN).map(([k, v]) => ({ value: k, label: v[0] })) }],
    rowClass: (r) => (r.reverses_id ? 'row-warn' : ''),
    columns: [
      { key: 'id', label: 'Entry', num: true, render: (r) => h('span', { class: 'mono muted' }, '#' + r.id) }, { key: 'ts', label: 'Date & time', render: (r) => fmtDateTime(r.ts) },
      ...(isAdmin() || isStore() ? [{ key: 'loc', label: 'Location', value: locName }] : []),
      { key: 'item', label: 'Item', value: (r) => productById(r.product_id)?.item_code, render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description), h('div', { class: 'cell-sub mono' }, p?.item_code)); } },
      { key: 'txn_type', label: 'Movement', value: (r) => TXN[r.txn_type]?.[0] || r.txn_type, render: (r) => badge(TXN[r.txn_type]?.[0] || r.txn_type, TXN[r.txn_type]?.[1] || 'muted', true) },
      { key: 'qty', label: 'Qty (base unit)', num: true, render: (r) => h('b', { style: { color: Number(r.qty) > 0 ? 'var(--ok)' : 'var(--danger)' } }, `${Number(r.qty) > 0 ? '+' : ''}${fmtNum(r.qty)}`) },
      { key: 'value', label: 'Value', num: true, render: (r) => fmtMoney(r.value) }, { key: 'balance_qty', label: 'Balance qty', num: true, render: (r) => fmtNum(r.balance_qty) }, { key: 'balance_value', label: 'Balance value', num: true, render: (r) => fmtMoney(r.balance_value) },
      { key: 'ref_no', label: 'Reference', render: (r) => h('span', { class: 'mono' }, r.ref_no || '—') }, { key: 'note', label: 'Note' }, { key: 'created_by', label: 'By', value: (r) => userName(r.created_by) },
    ],
    empty: { icon: 'history', title: 'No movements in this period' },
  });
  async function load() {
    rows = await fetchAll(() => {
      let q = sb.from('stock_ledger').select('*').gte('ts', new Date(from.value + 'T00:00:00').toISOString()).lte('ts', new Date(to.value + 'T23:59:59').toISOString()).order('id', { ascending: false });
      if (prod.getValue()) q = q.eq('product_id', prod.getValue()); if (loc.getValue()) q = q.eq('location_id', loc.getValue()); return q;
    });
    tbl.setRows(rows);
  }
  const bar = h('div', { class: 'toolbar' }, h('div', { class: 'field' }, h('label', null, 'From'), from), h('div', { class: 'field' }, h('label', null, 'To'), to), h('div', { class: 'field', style: { minWidth: '240px' } }, h('label', null, 'Item'), prod), locOpts.length ? h('div', { class: 'field', style: { minWidth: '200px' } }, h('label', null, 'Location'), loc) : null, h('div', { style: { alignSelf: 'end' } }, btn('Show', { cls: 'primary', icon: 'search', onClick: act(load) })));
  await load();
  root.append(pageHead({ title: 'Stock Ledger', sub: 'Every stock movement is recorded here and can never be edited or deleted - corrections appear as reversing entries.' }), h('div', { class: 'card' }, bar, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== INWARDS */
export async function inwards() {
  const root = h('div'); let rows = []; const canPost = isStore();
  const sum = (r) => (r.store_inward_lines || []).reduce((a, l) => a + Number(l.qty) * Number(l.rate), 0);
  const tbl = dataTable({
    exportName: 'inwards', defaultSort: { key: 'created_at', dir: 'desc' }, rowClass: (r) => (r.status === 'reversed' ? 'row-muted' : ''), searchPlaceholder: 'Search inward no, supplier, reference...',
    filters: isAdmin() ? [{ key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }] : [],
    columns: [{ key: 'inward_no', label: 'Inward no', render: (r) => h('span', { class: 'cell-main mono' }, r.inward_no) }, ...(isAdmin() ? [{ key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) }] : []),
      { key: 'supplier', label: 'Supplier' }, { key: 'ref_no', label: 'Invoice / ref', value: (r) => [r.ref_no, r.ref_date && fmtDate(r.ref_date)].filter(Boolean).join(' · ') },
      { key: 'n', label: 'Items', num: true, value: (r) => (r.store_inward_lines || []).length }, { key: 'val', label: 'Value', num: true, value: sum, render: (r) => fmtMoney(sum(r)) },
      { key: 'status', label: 'Status', render: (r) => statusBadge('inward', r.status) }, { key: 'created_at', label: 'Posted', render: (r) => h('div', null, h('div', null, fmtDateTime(r.created_at)), h('div', { class: 'cell-sub' }, userName(r.created_by))) },
      { key: 'x', label: '', sortable: false, exportable: false, render: (r) => (r.status === 'posted' ? h('div', { class: 'actions' }, btn('Reverse', { cls: 'sm danger ghost', onClick: act(async () => { const reason = await promptBox({ title: `Reverse ${r.inward_no}`, message: 'The stock is removed again through reversing ledger entries. This only works if the stock is still available.', label: 'Reason', tone: 'danger', confirmText: 'Reverse inward' }); if (!reason) return; await rpc('store_inward_reverse', { p_id: r.id, p_reason: reason }); toast('Inward reversed', 'warn'); await load(); }) })) : h('span', { class: 'small muted', title: r.reverse_reason }, r.reverse_reason || '')) }],
    toolbar: canPost ? [btn('New stock inward', { cls: 'primary sm', icon: 'plus', onClick: form })] : [],
    empty: { icon: 'download', title: 'No inwards yet', text: 'Record purchases / opening stock here so the store has stock to issue.' },
  });
  async function load() { rows = await fetchAll(() => sb.from('store_inwards').select('*, store_inward_lines(qty,rate)').order('created_at', { ascending: false })); tbl.setRows(rows); }

  function form() {
    const key = `wms-inward-draft-${S.user.id}`; let d; try { d = JSON.parse(localStorage.getItem(key) || 'null'); } catch { d = null; }
    d = d || { supplier: '', ref_no: '', ref_date: toDateInput(new Date()), remarks: '', lines: [{ product_id: null, qty: '', rate: '' }] };
    const persist = () => { try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* ignore */ } };
    const sup = inp({ value: d.supplier, placeholder: 'Supplier / source' }); const ref = inp({ value: d.ref_no, placeholder: 'Invoice / DC no' }); const rd = inp({ type: 'date', value: d.ref_date }); const rem = inp({ value: d.remarks, placeholder: 'Remarks' });
    sup.oninput = () => { d.supplier = sup.value; persist(); }; ref.oninput = () => { d.ref_no = ref.value; persist(); }; rd.oninput = () => { d.ref_date = rd.value; persist(); }; rem.oninput = () => { d.remarks = rem.value; persist(); };
    const grid = h('div', { class: 'lines-wrap' }); const totalEl = h('b');
    const sums = () => { totalEl.textContent = fmtMoney(d.lines.reduce((a, l) => a + num(l.qty) * num(l.rate), 0)); };
    function drawLines() {
      const tb = h('tbody');
      d.lines.forEach((l, i) => {
        const p = productById(l.product_id);
        const ps = selectBox({ options: productOptions(true), value: l.product_id, placeholder: 'Search item...', clearable: false, onChange: (v) => { l.product_id = v; persist(); drawLines(); } });
        const q = inp({ type: 'number', min: '0', step: p?.allow_decimal ? 'any' : '1', value: l.qty, style: { minWidth: '90px' } }); q.oninput = () => { l.qty = q.value; persist(); sums(); };
        const r = inp({ type: 'number', min: '0', step: 'any', value: l.rate, style: { minWidth: '100px' } }); r.oninput = () => { l.rate = r.value; persist(); sums(); };
        tb.appendChild(h('tr', null, h('td', { class: 'n' }, i + 1), h('td', { style: { minWidth: '280px' } }, ps, p ? h('div', { class: 'small muted' }, `1 ${p.uom} = ${fmtNum(p.pack_qty)} ${p.base_uom}`) : null),
          h('td', null, h('div', { class: 'row nowrap' }, q, h('span', { class: 'small muted nowrap' }, p?.uom || ''))), h('td', null, h('div', { class: 'row nowrap' }, r, h('span', { class: 'small muted nowrap' }, p ? `/ ${p.uom}` : ''))),
          h('td', { style: { width: '48px' } }, iconBtn('trash', 'Remove', () => { d.lines.splice(i, 1); if (!d.lines.length) d.lines.push({ product_id: null, qty: '', rate: '' }); persist(); drawLines(); }))));
      });
      grid.replaceChildren(h('table', { class: 'lines' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Product'), h('th', null, 'Qty (issue UOM)'), h('th', null, 'Rate (cost)'), h('th'))), tb), h('div', { style: { marginTop: '10px' } }, btn('Add item', { cls: 'sm', icon: 'plus', onClick: () => { d.lines.push({ product_id: null, qty: '', rate: '' }); persist(); drawLines(); } }))); sums();
    }
    drawLines();
    const m = modal({ title: 'New stock inward', size: 'lg', dismissable: true, content: h('div', { class: 'col' }, banner('info', 'Your entry is saved as a draft on this device automatically until you post it. Posting adds stock to your store and cannot be edited - only reversed.'),
      h('div', { class: 'form-grid' }, field('Supplier', sup), field('Invoice / reference no.', ref), field('Reference date', rd), field('Remarks', rem)), grid),
    foot: [h('div', { class: 'grow', style: { alignSelf: 'center' } }, 'Total: ', totalEl), btn('Close (keep draft)', { cls: '', onClick: () => m.close() }), btn('Discard', { cls: 'danger ghost', onClick: () => { try { localStorage.removeItem(key); } catch { /* ignore */ } m.close(); } }),
      btn('Post inward', { cls: 'primary', icon: 'check', onClick: act(async () => {
        const ls = d.lines.filter((l) => l.product_id); if (!ls.length) throw new Error('Add at least one item');
        for (const l of ls) { const p = productById(l.product_id); if (!(num(l.qty) > 0)) throw new Error(`Enter a quantity for ${p.item_code}`); if (l.rate === '' || num(l.rate) < 0) throw new Error(`Enter the rate for ${p.item_code}`); if (!p.allow_decimal && num(l.qty) !== Math.trunc(num(l.qty))) throw new Error(`${p.item_code} must be in whole numbers`); }
        const no = await rpc('store_inward_post', { p_store: S.profile.store_id, p_supplier: d.supplier || null, p_ref_no: d.ref_no || null, p_ref_date: d.ref_date || null, p_remarks: d.remarks || null, p_lines: ls.map((l) => ({ product_id: l.product_id, qty: num(l.qty), rate: num(l.rate) })) });
        try { localStorage.removeItem(key); } catch { /* ignore */ } toast(`Inward ${no} posted`); m.close(); await load();
      }) })] });
  }
  await load();
  root.append(pageHead({ title: 'Stock Inward', sub: 'Add purchased or opening stock to a store. Rates entered here become the cost used when issuing.' }), h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}
