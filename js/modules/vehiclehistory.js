// Vehicle History: spares consumed on a vehicle (job cards + consumable cards). Export to Excel (CSV).
// Workshop users see their own work and the work done elsewhere on their home-workshop vehicles (database rule); admin & viewer see all.
import { sb, S, fetchAll, wsName, productById, vehicleById, vehicleOptions, seesAll, myWorkshopId } from '../core/api.js';
import { h, pageHead, card, field, inp, badge, kpi } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { fmtDateTime, fmtNum, fmtMoney, fmtQty, toDateInput } from '../core/format.js';

export async function render(ctx) {
  const root = h('div'); let rows = [];
  const veh = selectBox({ options: vehicleOptions(false), value: ctx.query.vehicle || null, placeholder: 'All vehicles (or search one)', onChange: () => load() });
  const to = inp({ type: 'date', value: toDateInput(new Date()) });
  const from = inp({ type: 'date', value: toDateInput(new Date(Date.now() - 365 * 86400000)) });
  const k = h('div', { class: 'grid c3 mb' });
  const tbl = dataTable({
    exportName: 'vehicle-spare-history', defaultSort: { key: 'ts', dir: 'desc' }, searchPlaceholder: 'Search spare, card no...',
    filters: seesAll() || true ? [{ key: 'card_kind', label: 'All card types', options: [{ value: 'job_card', label: 'Job Card' }, { value: 'consumable', label: 'Consumable Job Card' }] }] : [],
    columns: [
      { key: 'ts', label: 'Date', render: (r) => fmtDateTime(r.ts) },
      { key: 'veh', label: 'Vehicle', value: (r) => vehicleById(r.vehicle_id)?.reg_no || '', render: (r) => h('span', { class: 'mono cell-main' }, vehicleById(r.vehicle_id)?.reg_no || '?') },
      { key: 'item', label: 'Spare', value: (r) => productById(r.product_id)?.description || '', render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description || '?'), h('div', { class: 'cell-sub mono' }, p?.item_code || '')); } },
      { key: 'qty', label: 'Qty', num: true, value: (r) => Number(r.qty), render: (r) => fmtQty(productById(r.product_id), r.qty) },
      { key: 'amount', label: 'Value', num: true, value: (r) => Number(r.amount), render: (r) => fmtMoney(r.amount) },
      { key: 'card_no', label: 'Card no', render: (r) => h('a', { class: 'mono bold', href: `#/${r.card_kind === 'job_card' ? 'jobcards' : 'cjc'}/${r.card_id}`, onClick: (e) => e.stopPropagation() }, r.card_no || '—') },
      { key: 'card_kind', label: 'Card type', value: (r) => (r.card_kind === 'job_card' ? 'Job Card' : 'Consumable Job Card'), render: (r) => badge(r.card_kind === 'job_card' ? 'Job Card' : 'Consumable', r.card_kind === 'job_card' ? 'info' : 'teal', true) },
      { key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id), render: (r) => h('span', null, wsName(r.workshop_id), r.workshop_id !== myWorkshopId() && !seesAll() ? h('span', { class: 'small muted' }, ' (home view)') : '') },
    ],
    empty: { icon: 'history', title: 'No spares consumed', text: 'Nothing was consumed in this period for the selection.' },
  });
  async function load() {
    const f = new Date(from.value + 'T00:00:00').toISOString(); const t = new Date(to.value + 'T23:59:59').toISOString();
    rows = await fetchAll(() => { let q = sb.from('vehicle_spare_history').select('*').gte('ts', f).lte('ts', t).order('ts', { ascending: false }); if (veh.getValue()) q = q.eq('vehicle_id', veh.getValue()); return q; });
    tbl.setRows(rows);
    const val = rows.reduce((a, r) => a + Number(r.amount), 0);
    k.replaceChildren(kpi({ icon: 'package', tone: 'blue', label: 'Spare lines', value: rows.length }), kpi({ icon: 'layers', tone: 'amber', label: 'Total value', value: fmtMoney(val) }), kpi({ icon: 'wrench', tone: 'green', label: 'Cards involved', value: new Set(rows.map((r) => r.card_id)).size }));
  }
  from.onchange = to.onchange = load;
  await load();
  root.append(pageHead({ title: 'Vehicle History', sub: seesAll() ? 'Spares consumed per vehicle - all workshops' : `Spares consumed on your vehicles - ${wsName(myWorkshopId())} work and work done elsewhere on your home-workshop vehicles` }),
    card({ cls: 'mb', body: h('div', { class: 'form-grid' }, field('Vehicle', veh), field('From', from), field('To', to)) }), k, h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}
