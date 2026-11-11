// Role based dashboard with live KPIs
import { sb, S, run, count, fetchAll, role, isAdmin, isWs, isStore, isManager, myWorkshopId, myStoreId, wsName, storeName, productById, vehicleById, userName } from '../core/api.js';
import { h, icon, card, kpi, btn, statusBadge, badge, emptyState, pageHead } from '../core/ui.js';
import { greeting, fmtDay, fmtMoney, fmtDateTime, fmtNum, fmtQty, ROLE_LABEL, daysSince, timeAgo } from '../core/format.js';
import { navigate } from '../core/router.js';

const head = (t, f) => count(f(sb.from(t).select('id', { count: 'exact', head: true })));

export async function render() {
  const root = h('div'); const me = S.profile; const scope = isAdmin() ? 'All workshops & stores' : isWs() ? wsName(myWorkshopId()) : storeName(myStoreId());
  const hero = h('div', { class: 'hero' }, h('h1', null, `${greeting()}, ${me.full_name.split(' ')[0]}`, h('span', null, '👋')), h('p', null, `${fmtDay(new Date())} · here is your work at a glance.`),
    h('div', { class: 'chips' }, h('span', { class: 'chip' }, ROLE_LABEL[me.role]), h('span', { class: 'chip' }, scope)));
  const kpis = h('div', { class: 'grid c4 mb kpis' }); const main = h('div'); root.append(hero, kpis, main);

  async function load() {
    if (isWs()) await workshopView(); else if (isStore()) await storeView(); else await adminView();
  }
  /* ---------------------------------------------------------------- workshop */
  async function workshopView() {
    const [open, drafts, approval, mrfSent, mrfRet, rec, queue, bal, recent] = await Promise.all([
      head('job_cards', (q) => q.eq('status', 'open')), head('job_cards', (q) => q.eq('status', 'draft')), head('job_cards', (q) => q.eq('status', 'completed')),
      head('mrfs', (q) => q.eq('status', 'sent')), head('mrfs', (q) => q.eq('status', 'returned')), head('delivery_challans', (q) => q.eq('status', 'issued')), head('return_queue', (q) => q.eq('status', 'queued')),
      run(sb.from('stock_balances').select('qty,value,product_id').eq('location_type', 'workshop').eq('location_id', myWorkshopId()).gt('qty', 0)),
      run(sb.from('job_cards').select('*').neq('status', 'draft').order('opened_at', { ascending: false }).limit(6))]);
    const val = bal.reduce((a, b) => a + Number(b.value), 0);
    kpis.replaceChildren(
      kpi({ icon: 'wrench', tone: 'blue', label: 'Open job cards', value: open, href: '#/jobcards?tab=open', hint: `${drafts} draft${drafts === 1 ? '' : 's'} pending` }),
      kpi({ icon: 'checkCircle', tone: 'amber', label: isManager() ? 'Awaiting your approval' : 'Awaiting manager approval', value: approval, href: '#/jobcards?tab=completed' }),
      kpi({ icon: 'packagePlus', tone: 'purple', label: 'Deliveries to acknowledge', value: rec, href: '#/receipts' }),
      kpi({ icon: 'layers', tone: 'green', label: 'Workshop stock value', value: fmtMoney(val), href: '#/wstock', hint: `${bal.length} items` }));
    const todo = [[mrfRet, 'MRFs returned by stores - needs your changes', '/mrfs?tab=returned', 'clipboard', 'warn'], [rec, 'Deliveries waiting for acknowledgement', '/receipts', 'packagePlus', 'info'], [approval, isManager() ? 'Job cards waiting for your approval' : 'Job cards sent for manager approval', '/jobcards?tab=completed', 'checkCircle', 'warn'], [drafts, 'Draft job cards not yet created', '/jobcards?tab=draft', 'wrench', 'muted'], [queue, 'Items waiting in the return queue', '/returns', 'undo', 'muted'], [mrfSent, 'MRFs waiting at the stores', '/mrfs?tab=sent', 'inbox', 'info']].filter((x) => x[0] > 0);
    main.replaceChildren(h('div', { class: 'grid side' },
      card({ title: 'Recent job cards', flush: true, actions: [btn('View all', { cls: 'sm ghost', onClick: () => navigate('/jobcards') })], body: recent.length ? h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['Job card', 'Vehicle', 'Complaint', 'Status'].map((x) => h('th', null, x)))), h('tbody', null, recent.map((r) => h('tr', { class: 'clickable', onClick: () => navigate(`/jobcards/${r.id}`) }, h('td', { 'data-label': 'Job card' }, h('span', { class: 'cell-main mono' }, r.jc_no)), h('td', { 'data-label': 'Vehicle' }, vehicleById(r.vehicle_id)?.reg_no), h('td', { 'data-label': 'Complaint' }, h('div', { style: { maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.complaint || '—')), h('td', { 'data-label': 'Status' }, statusBadge('jc', r.status)))))) : emptyState({ icon: 'wrench', title: 'No job cards yet', text: 'Create your first job card.', action: btn('New job card', { cls: 'primary', icon: 'plus', onClick: () => navigate('/jobcards') }) }) }),
      h('div', { class: 'col' }, card({ title: 'Needs attention', body: todo.length ? h('div', { class: 'col', style: { gap: '4px' } }, todo.map(([n, t, p, i, tone]) => h('a', { href: '#' + p, class: 'row between', style: { padding: '10px 4px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' } }, h('span', { class: 'row nowrap' }, icon(i), t), badge(String(n), tone, true)))) : h('div', { class: 'muted center', style: { padding: '14px' } }, 'All caught up 🎉') }),
        card({ title: 'Quick actions', body: h('div', { class: 'col' }, btn('New job card', { cls: 'primary block', icon: 'plus', onClick: () => navigate('/jobcards?new=1') }), btn('Consumable job cards', { cls: 'block', icon: 'layers', onClick: () => navigate('/cjc') }), btn('Material requests', { cls: 'block', icon: 'clipboard', onClick: () => navigate('/mrfs') }), btn('Workshop stock', { cls: 'block', icon: 'layers', onClick: () => navigate('/wstock') })) }))));
  }
  /* ---------------------------------------------------------------- store */
  async function storeView() {
    const [mrfs, dcd, rdc, bal, led, oldest] = await Promise.all([head('mrfs', (q) => q.eq('status', 'sent')), head('delivery_challans', (q) => q.eq('status', 'draft')), head('return_dcs', (q) => q.eq('status', 'sent')),
      run(sb.from('stock_balances').select('*').eq('location_type', 'store').eq('location_id', myStoreId()).gt('qty', 0)),
      run(sb.from('stock_ledger').select('ts,txn_type,value').eq('location_type', 'store').eq('location_id', myStoreId()).in('txn_type', ['inward', 'issue']).gte('ts', new Date(Date.now() - 7 * 86400000).toISOString())),
      run(sb.from('mrfs').select('*, job_cards(jc_no,vehicle_id)').eq('status', 'sent').order('sent_at', { ascending: true }).limit(6))]);
    const low = bal.filter((b) => { const p = productById(b.product_id); return p && Number(p.min_stock) > 0 && Number(b.qty) <= Number(p.min_stock); });
    kpis.replaceChildren(kpi({ icon: 'inbox', tone: 'blue', label: 'MRFs waiting for issue', value: mrfs, href: '#/inbox' }), kpi({ icon: 'truck', tone: 'amber', label: 'Draft delivery challans', value: dcd, href: '#/dcs?tab=draft' }), kpi({ icon: 'undo', tone: 'purple', label: 'Returns to review', value: rdc, href: '#/return-inbox' }), kpi({ icon: 'rupee', tone: 'green', label: 'Store stock value', value: fmtMoney(bal.reduce((a, b) => a + Number(b.value), 0)), href: '#/stock', hint: `${low.length} item(s) at / below minimum` }));
    main.replaceChildren(h('div', { class: 'grid side' }, card({ title: 'Oldest material requests', flush: true, actions: [btn('Open inbox', { cls: 'sm ghost', onClick: () => navigate('/inbox') })], body: oldest.length ? h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['MRF', 'Workshop', 'Vehicle', 'Waiting'].map((x) => h('th', null, x)))), h('tbody', null, oldest.map((r) => h('tr', { class: 'clickable', onClick: () => navigate(`/inbox/${r.id}`) }, h('td', { 'data-label': 'MRF' }, h('span', { class: 'cell-main mono' }, r.mrf_no)), h('td', { 'data-label': 'Workshop' }, wsName(r.workshop_id)), h('td', { 'data-label': 'Vehicle' }, vehicleById(r.job_cards?.vehicle_id)?.reg_no), h('td', { 'data-label': 'Waiting' }, badge(timeAgo(r.sent_at), daysSince(r.sent_at) >= 2 ? 'danger' : 'warn', true)))))) : emptyState({ icon: 'inbox', title: 'No pending requests' }) }),
      chartCard(led), ), ageingCard(bal), lowCard(low));
  }
  /* ---------------------------------------------------------------- admin */
  async function adminView() {
    const [open, approval, mrfs, prods, bal, led, jcs] = await Promise.all([head('job_cards', (q) => q.eq('status', 'open')), head('job_cards', (q) => q.eq('status', 'completed')), head('mrfs', (q) => q.eq('status', 'sent')), head('products', (q) => q.eq('status', 'active')),
      fetchAll(() => sb.from('stock_balances').select('*').gt('qty', 0)), run(sb.from('stock_ledger').select('ts,txn_type,value').in('txn_type', ['inward', 'issue']).gte('ts', new Date(Date.now() - 7 * 86400000).toISOString()).limit(5000)),
      run(sb.from('job_cards').select('*').neq('status', 'draft').order('opened_at', { ascending: false }).limit(6))]);
    const st = bal.filter((b) => b.location_type === 'store'); const ws = bal.filter((b) => b.location_type === 'workshop'); const sum = (a) => a.reduce((x, b) => x + Number(b.value), 0);
    const low = bal.filter((b) => { const p = productById(b.product_id); return p && Number(p.min_stock) > 0 && Number(b.qty) <= Number(p.min_stock); });
    kpis.replaceChildren(kpi({ icon: 'wrench', tone: 'blue', label: 'Open job cards', value: open, href: '#/jobcards?tab=open', hint: `${approval} awaiting approval` }), kpi({ icon: 'inbox', tone: 'amber', label: 'MRFs at stores', value: mrfs, href: '#/inbox' }),
      kpi({ icon: 'store', tone: 'green', label: 'Store stock value', value: fmtMoney(sum(st)), href: '#/stock' }), kpi({ icon: 'factory', tone: 'teal', label: 'Workshop stock value', value: fmtMoney(sum(ws)), href: '#/stock', hint: `${prods} active products` }));
    main.replaceChildren(h('div', { class: 'grid side' }, chartCard(led), card({ title: 'Recent job cards', flush: true, body: jcs.length ? h('table', { class: 'dt stack' }, h('tbody', null, jcs.map((r) => h('tr', { class: 'clickable', onClick: () => navigate(`/jobcards/${r.id}`) }, h('td', { 'data-label': 'Job card' }, h('div', { class: 'cell-main mono' }, r.jc_no), h('div', { class: 'cell-sub' }, `${wsName(r.workshop_id)} · ${vehicleById(r.vehicle_id)?.reg_no || ''}`)), h('td', { 'data-label': 'Status' }, statusBadge('jc', r.status)))))) : emptyState({ title: 'No job cards yet' }) })), ageingCard(bal), lowCard(low));
  }
  /* ---------------------------------------------------------------- shared panels */
  function chartCard(led) {
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0, 0, 0, 0); return d; });
    const data = days.map((d) => { const n = new Date(d); n.setDate(n.getDate() + 1); const inRange = led.filter((l) => { const t = new Date(l.ts); return t >= d && t < n; }); return { label: d.toLocaleDateString('en-GB', { weekday: 'short' }), a: inRange.filter((l) => l.txn_type === 'inward').reduce((x, l) => x + Number(l.value), 0), c: inRange.filter((l) => l.txn_type === 'issue').reduce((x, l) => x + Math.abs(Number(l.value)), 0) }; });
    const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.c)));
    return card({ title: 'Last 7 days - value posted', actions: [h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--primary)' } }), 'Inward'), h('span', null, h('i', { style: { background: '#35c27a' } }), 'Issued'))],
      body: h('div', { class: 'bars' }, data.map((d) => h('div', { class: 'bar-col' }, h('div', { class: 'pair' }, h('div', { class: 'b a', style: { height: `${(d.a / max) * 100}%` }, title: `Inward ${fmtMoney(d.a)}` }), h('div', { class: 'b c', style: { height: `${(d.c / max) * 100}%` }, title: `Issued ${fmtMoney(d.c)}` })), h('div', { class: 'lab' }, d.label)))) });
  }
  function ageingCard(bal) {
    const b = [['0–30 days', 0, 30, '#12804f'], ['31–60 days', 31, 60, '#1f63b8'], ['61–90 days', 61, 90, '#d98a00'], ['Over 90 days', 91, 1e9, '#c0392b']].map(([l, lo, hi, c]) => ({ l, c, n: bal.filter((x) => { const d = daysSince(x.updated_at); return d >= lo && d <= hi; }).length }));
    const tot = b.reduce((a, x) => a + x.n, 0) || 1;
    return h('div', { class: 'mt' }, card({ title: 'Stock ageing (days since last movement)', body: h('div', { class: 'col' }, h('div', { style: { display: 'flex', height: '12px', borderRadius: '99px', overflow: 'hidden', background: 'var(--surface-3)' } }, b.map((x) => h('div', { style: { width: `${(x.n / tot) * 100}%`, background: x.c } }))), h('div', { class: 'grid c4' }, b.map((x) => h('div', null, h('div', { class: 'row', style: { gap: '8px' } }, h('i', { style: { width: '10px', height: '10px', borderRadius: '3px', background: x.c, display: 'inline-block' } }), h('span', { class: 'muted' }, x.l)), h('div', { class: 'bold', style: { fontSize: '18px' } }, `${x.n} lines`)))))}));
  }
  function lowCard(low) {
    if (!low.length) return null;
    return h('div', { class: 'mt' }, card({ title: `Low stock (${low.length})`, flush: true, body: h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['Item', 'Location', 'On hand', 'Minimum'].map((x) => h('th', null, x)))), h('tbody', null, low.slice(0, 10).map((b) => { const p = productById(b.product_id); return h('tr', null, h('td', { 'data-label': 'Item' }, h('div', { class: 'cell-main' }, p?.description), h('div', { class: 'cell-sub mono' }, p?.item_code)), h('td', { 'data-label': 'Location' }, b.location_type === 'workshop' ? wsName(b.location_id) : storeName(b.location_id)), h('td', { 'data-label': 'On hand' }, h('b', { style: { color: 'var(--danger)' } }, fmtQty(p, b.qty))), h('td', { 'data-label': 'Minimum' }, fmtNum(p?.min_stock))); }))) }));
  }
  await load();
  return { el: root, refresh: load };
}
