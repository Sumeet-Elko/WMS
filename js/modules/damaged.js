// Damaged Products Stock - kept separate from workshop stock. Maintained automatically from job-card spares.
import { sb, S, fetchAll, isAdmin, myWorkshopId, wsName, productById, userName } from '../core/api.js';
import { h, pageHead, card, kpi, tabsBar, badge } from '../core/ui.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { fmtDateTime, fmtNum } from '../core/format.js';

export async function render(ctx) {
  const root = h('div'); let bal = [], led = []; let cur = ctx.query.tab || 'balance';
  const wsFilter = isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : [];
  const prodCols = [
    { key: 'item', label: 'Item', value: (r) => productById(r.product_id)?.description || '', render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description || '?'), h('div', { class: 'cell-sub mono' }, `${p?.item_code || ''}${p?.part_no ? ' · ' + p.part_no : ''}`)); } },
  ];
  const wsCol = isAdmin() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : [];
  const balT = dataTable({ exportName: 'damaged-stock', defaultSort: { key: 'item', dir: 'asc' }, searchPlaceholder: 'Search item...', filters: wsFilter,
    columns: [...prodCols, ...wsCol,
      { key: 'qty', label: 'Damaged qty', num: true, render: (r) => h('b', null, `${fmtNum(r.qty)} ${productById(r.product_id)?.base_uom || ''}`) },
      { key: 'updated_at', label: 'Last change', render: (r) => fmtDateTime(r.updated_at) }],
    empty: { icon: 'alert', title: 'No damaged products', text: 'When a product marked "Spare needed" is used on a job card, the old part is counted here automatically.' } });
  const histT = dataTable({ exportName: 'damaged-history', defaultSort: { key: 'ts', dir: 'desc' }, searchPlaceholder: 'Search item, job card...', filters: wsFilter,
    columns: [{ key: 'ts', label: 'Date & time', render: (r) => fmtDateTime(r.ts) }, ...prodCols, ...wsCol,
      { key: 'qty', label: 'Change', num: true, render: (r) => h('b', { style: { color: Number(r.qty) > 0 ? 'var(--danger)' : 'var(--success)' } }, `${Number(r.qty) > 0 ? '+' : ''}${fmtNum(r.qty)}`) },
      { key: 'balance_qty', label: 'Balance', num: true, render: (r) => fmtNum(r.balance_qty) },
      { key: 'ref_no', label: 'Job card', render: (r) => (r.job_card_id ? h('a', { href: `#/jobcards/${r.job_card_id}`, class: 'mono', onClick: (e) => e.stopPropagation() }, r.ref_no) : r.ref_no || '') },
      { key: 'note', label: 'Reason' }, { key: 'by', label: 'By', value: (r) => userName(r.created_by) }],
    empty: { icon: 'history', title: 'No history yet' } });
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'balance', label: 'Damaged stock' }, { key: 'history', label: 'History (audit)' }], onChange: (k) => { cur = k; apply(); } });
  const holder = h('div');
  const apply = () => holder.replaceChildren(cur === 'history' ? histT.el : balT.el);
  const k = h('div', { class: 'grid c3 mb' });
  async function load() {
    const ws = isAdmin() ? null : myWorkshopId();
    const q1 = sb.from('damaged_stock').select('*').gt('qty', 0); const q2 = sb.from('damaged_ledger').select('*').order('ts', { ascending: false });
    [bal, led] = await Promise.all([fetchAll(() => (ws ? q1.eq('workshop_id', ws) : q1)), fetchAll(() => (ws ? q2.eq('workshop_id', ws) : q2))]);
    balT.setRows(bal); histT.setRows(led); apply();
    k.replaceChildren(kpi({ icon: 'alert', tone: 'red', label: 'Damaged items (distinct)', value: bal.length }), kpi({ icon: 'package', tone: 'amber', label: 'Total damaged qty', value: fmtNum(bal.reduce((a, r) => a + Number(r.qty), 0)) }), kpi({ icon: 'history', tone: 'blue', label: 'Movements recorded', value: led.length }));
  }
  await load();
  root.append(pageHead({ title: 'Damaged Products Stock', sub: `${isAdmin() ? 'All workshops' : wsName(myWorkshopId())} - maintained automatically from job cards. Not part of workshop stock.` }), k, h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), holder));
  return { el: root, refresh: load };
}
