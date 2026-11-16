// Role based dashboard with live KPIs
import { sb, S, run, count, fetchAll, role, isAdmin, isWs, isStore, isManager, myWorkshopId, myStoreId, wsName, storeName, productById, vehicleById, userName, seesAll, isViewer } from '../core/api.js';
import { h, icon, card, kpi, btn, statusBadge, badge, emptyState, pageHead } from '../core/ui.js';
import { greeting, fmtDay, fmtMoney, fmtDateTime, fmtNum, fmtQty, ROLE_LABEL, daysSince, timeAgo } from '../core/format.js';
import { navigate } from '../core/router.js';
import { selectBox } from '../core/select.js';
import { setting } from '../core/api.js';

const head = (t, f) => count(f(sb.from(t).select('id', { count: 'exact', head: true })));

export async function render() {
  const root = h('div'); const me = S.profile; const scope = seesAll() ? 'All workshops & stores' : isWs() ? wsName(myWorkshopId()) : storeName(myStoreId());
  const hero = h('div', { class: 'hero' }, h('h1', null, `${greeting()}, ${me.full_name.split(' ')[0]}`, h('span', null, '👋')), h('p', null, `${fmtDay(new Date())} · here is your work at a glance.`),
    h('div', { class: 'chips' }, h('span', { class: 'chip' }, ROLE_LABEL[me.role]), h('span', { class: 'chip' }, scope)));
  const kpis = h('div', { class: 'grid c4 mb kpis' }); const main = h('div');
  let area = 'workshops';
  const sw = seesAll() ? h('div', { class: 'row mb', style: { alignItems: 'center', gap: '10px' } }, h('b', null, 'Show'), h('div', { style: { minWidth: '220px' } }, selectBox({ options: [{ value: 'workshops', label: 'Workshops' }, { value: 'stores', label: 'Stores' }], value: 'workshops', clearable: false, onChange: (v) => { area = v || 'workshops'; load(); } }))) : null;
  root.append(hero, sw, kpis, main);
  const enforce = () => setting('enforce_store_stock', true) !== false;

  async function load() {
    if (isWs()) await workshopView(); else if (isStore()) await storeView(); else if (area === 'stores') await storesAdmin(); else await workshopsAdmin();
  }
  /* ---------------------------------------------------------------- workshop */
  async function workshopView() {
    const [open, drafts, approval, mrfSent, mrfRet, rec, queue, bal, recent] = await Promise.all([
      head('job_cards', (q) => q.eq('workshop_id', myWorkshopId()).eq('status', 'open')), head('job_cards', (q) => q.eq('workshop_id', myWorkshopId()).eq('status', 'draft')), head('job_cards', (q) => q.eq('workshop_id', myWorkshopId()).eq('status', 'completed')),
      head('mrfs', (q) => q.eq('workshop_id', myWorkshopId()).eq('status', 'sent')), head('mrfs', (q) => q.eq('workshop_id', myWorkshopId()).eq('status', 'returned')), head('delivery_challans', (q) => q.eq('workshop_id', myWorkshopId()).eq('status', 'issued')), head('return_queue', (q) => q.eq('status', 'queued')),
      run(sb.from('stock_balances').select('qty,value,product_id').eq('location_type', 'workshop').eq('location_id', myWorkshopId()).gt('qty', 0)),
      run(sb.from('job_cards').select('*').eq('workshop_id', myWorkshopId()).neq('status', 'draft').order('opened_at', { ascending: false }).limit(6))]);
    const val = bal.reduce((a, b) => a + Number(b.value), 0);
    kpis.replaceChildren(
      kpi({ icon: 'wrench', tone: 'blue', label: 'Open job cards', value: open, href: '#/jobcards?tab=open', hint: `${drafts} draft${drafts === 1 ? '' : 's'} pending` }),
      kpi({ icon: 'checkCircle', tone: 'amber', label: isManager() ? 'Awaiting your approval' : 'Awaiting manager approval', value: approval, href: '#/jobcards?tab=completed' }),
      kpi({ icon: 'packagePlus', tone: 'purple', label: 'Deliveries to acknowledge', value: rec, href: '#/receipts' }),
      kpi({ icon: 'layers', tone: 'green', label: 'Workshop stock value', value: fmtMoney(val), href: '#/wstock', hint: `${bal.length} items` }));
    const todo = [[mrfRet, 'MRFs returned by stores - needs your changes', '/mrfs?tab=returned', 'clipboard', 'warn'], [rec, 'Deliveries waiting for acknowledgement', '/receipts', 'packagePlus', 'info'], [approval, isManager() ? 'Job cards waiting for your approval' : 'Job cards sent for manager approval', '/jobcards?tab=completed', 'checkCircle', 'warn'], [drafts, 'Draft job cards not yet created', '/jobcards?tab=draft', 'wrench', 'muted'], [queue, 'Items waiting in the return queue', '/returns', 'undo', 'muted'], [mrfSent, 'MRFs waiting at the stores', '/mrfs?tab=sent', 'inbox', 'info']].filter((x) => x[0] > 0);
    const [ovRows, ovUse] = await Promise.all([fetchAll(() => sb.from('card_summary').select('*').eq('workshop_id', myWorkshopId())), fetchAll(() => sb.from('spare_usage').select('*').eq('workshop_id', myWorkshopId()).gte('ts', new Date(Date.now() - 90 * 86400000).toISOString()))]);
    main.replaceChildren(h('div', { class: 'grid side' },
      card({ title: 'Recent job cards', flush: true, actions: [btn('View all', { cls: 'sm ghost', onClick: () => navigate('/jobcards') })], body: recent.length ? h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['Job card', 'Vehicle', 'Complaint', 'Status'].map((x) => h('th', null, x)))), h('tbody', null, recent.map((r) => h('tr', { class: 'clickable', onClick: () => navigate(`/jobcards/${r.id}`) }, h('td', { 'data-label': 'Job card' }, h('span', { class: 'cell-main mono' }, r.jc_no)), h('td', { 'data-label': 'Vehicle' }, vehicleById(r.vehicle_id)?.reg_no), h('td', { 'data-label': 'Complaint' }, h('div', { style: { maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.complaint || '—')), h('td', { 'data-label': 'Status' }, statusBadge('jc', r.status)))))) : emptyState({ icon: 'wrench', title: 'No job cards yet', text: 'Create your first job card.', action: btn('New job card', { cls: 'primary', icon: 'plus', onClick: () => navigate('/jobcards') }) }) }),
      h('div', { class: 'col' }, card({ title: 'Needs attention', body: todo.length ? h('div', { class: 'col', style: { gap: '4px' } }, todo.map(([n, t, p, i, tone]) => h('a', { href: '#' + p, class: 'row between', style: { padding: '10px 4px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' } }, h('span', { class: 'row nowrap' }, icon(i), t), badge(String(n), tone, true)))) : h('div', { class: 'muted center', style: { padding: '14px' } }, 'All caught up 🎉') }),
        isViewer() ? null : card({ title: 'Quick actions', body: h('div', { class: 'col' }, btn('New job card', { cls: 'primary block', icon: 'plus', onClick: () => navigate('/jobcards?new=1') }), btn('Consumable job cards', { cls: 'block', icon: 'layers', onClick: () => navigate('/cjc') }), btn('Material requests', { cls: 'block', icon: 'clipboard', onClick: () => navigate('/mrfs') }), btn('Workshop stock', { cls: 'block', icon: 'layers', onClick: () => navigate('/wstock') })) }))), h('div', { class: 'mt' }, overview(ovRows, ovUse, [myWorkshopId()])));
  }
  /* ---------------------------------------------------------------- store */
  async function storeView() {
    const [mrfs, dcd, rdc, bal, led, oldest] = await Promise.all([head('mrfs', (q) => q.eq('status', 'sent')), head('delivery_challans', (q) => q.eq('status', 'draft')), head('return_dcs', (q) => q.eq('status', 'sent')),
      run(sb.from('stock_balances').select('*').eq('location_type', 'store').eq('location_id', myStoreId()).gt('qty', 0)),
      run(sb.from('stock_ledger').select('ts,txn_type,value').eq('location_type', 'store').eq('location_id', myStoreId()).in('txn_type', ['inward', 'issue']).gte('ts', new Date(Date.now() - 7 * 86400000).toISOString())),
      run(sb.from('mrfs').select('*, job_cards(jc_no,vehicle_id)').eq('status', 'sent').order('sent_at', { ascending: true }).limit(6))]);
    const low = bal.filter((b) => { const p = productById(b.product_id); return p && Number(p.min_stock) > 0 && Number(b.qty) <= Number(p.min_stock); });
    kpis.replaceChildren(kpi({ icon: 'inbox', tone: 'blue', label: 'MRFs waiting for issue', value: mrfs, href: '#/inbox' }), kpi({ icon: 'truck', tone: 'amber', label: 'Draft delivery challans', value: dcd, href: '#/dcs?tab=draft' }), kpi({ icon: 'undo', tone: 'purple', label: 'Returns to review', value: rdc, href: '#/return-inbox' }), ...(enforce() ? [kpi({ icon: 'rupee', tone: 'green', label: 'Store stock value', value: fmtMoney(bal.reduce((a, b) => a + Number(b.value), 0)), href: '#/stock', hint: `${low.length} item(s) at / below minimum` })] : []));
    main.replaceChildren(h('div', { class: 'grid side' }, card({ title: 'Oldest material requests', flush: true, actions: [btn('Open inbox', { cls: 'sm ghost', onClick: () => navigate('/inbox') })], body: oldest.length ? h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['MRF', 'Workshop', 'Vehicle', 'Waiting'].map((x) => h('th', null, x)))), h('tbody', null, oldest.map((r) => h('tr', { class: 'clickable', onClick: () => navigate(`/inbox/${r.id}`) }, h('td', { 'data-label': 'MRF' }, h('span', { class: 'cell-main mono' }, r.mrf_no)), h('td', { 'data-label': 'Workshop' }, wsName(r.workshop_id)), h('td', { 'data-label': 'Vehicle' }, vehicleById(r.job_cards?.vehicle_id)?.reg_no), h('td', { 'data-label': 'Waiting' }, badge(timeAgo(r.sent_at), daysSince(r.sent_at) >= 2 ? 'danger' : 'warn', true)))))) : emptyState({ icon: 'inbox', title: 'No pending requests' }) }),
      chartCard(led), ), enforce() ? ageingCard(bal) : null, enforce() ? lowCard(low) : null);
  }
  /* ---------------------------------------------------------------- admin / viewer : workshops */
  async function workshopsAdmin() {
    const [rows, usage, bal, recent] = await Promise.all([fetchAll(() => sb.from('card_summary').select('*')),
      fetchAll(() => sb.from('spare_usage').select('*').gte('ts', new Date(Date.now() - 90 * 86400000).toISOString())),
      fetchAll(() => sb.from('stock_balances').select('*').eq('location_type', 'workshop').gt('qty', 0)),
      run(sb.from('job_cards').select('*').neq('status', 'draft').order('opened_at', { ascending: false }).limit(6))]);
    const cnt = (st) => rows.filter((r) => r.status === st).length; const wsVal = bal.reduce((a, b) => a + Number(b.value), 0);
    kpis.replaceChildren(kpi({ icon: 'wrench', tone: 'blue', label: 'Open (pending) cards', value: cnt('open'), href: '#/jobcards?tab=open', hint: 'all card types, all workshops' }),
      kpi({ icon: 'checkCircle', tone: 'amber', label: 'Awaiting manager approval', value: cnt('completed'), href: '#/jobcards?tab=completed' }),
      kpi({ icon: 'check', tone: 'green', label: 'Finalized', value: cnt('finalized') }),
      kpi({ icon: 'factory', tone: 'teal', label: 'Workshop stock value', value: fmtMoney(wsVal), href: '#/stock', hint: `${bal.length} stock lines` }));
    main.replaceChildren(overview(rows, usage, S.workshops.filter((w) => w.active).map((w) => w.id)),
      h('div', { class: 'mt' }, card({ title: 'Recent job cards', flush: true, body: recent.length ? h('table', { class: 'dt stack' }, h('tbody', null, recent.map((r) => h('tr', { class: 'clickable', onClick: () => navigate(`/jobcards/${r.id}`) }, h('td', { 'data-label': 'Job card' }, h('div', { class: 'cell-main mono' }, r.jc_no), h('div', { class: 'cell-sub' }, `${wsName(r.workshop_id)} · ${vehicleById(r.vehicle_id)?.reg_no || ''}`)), h('td', { 'data-label': 'Status' }, statusBadge('jc', r.status)))))) : emptyState({ title: 'No job cards yet' }) })));
  }
  /* ---------------------------------------------------------------- admin / viewer : stores */
  async function storesAdmin() {
    const since = new Date(Date.now() - 7 * 86400000).toISOString(); const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [mrfs, dcs, rdcs, bal, led] = await Promise.all([fetchAll(() => sb.from('mrfs').select('id,store_id,status').eq('status', 'sent')),
      fetchAll(() => sb.from('delivery_challans').select('id,store_id,status,issued_at').or(`status.eq.draft,issued_at.gte.${since30}`)),
      fetchAll(() => sb.from('return_dcs').select('id,store_id,status').eq('status', 'sent')),
      enforce() ? fetchAll(() => sb.from('stock_balances').select('*').eq('location_type', 'store').gt('qty', 0)) : Promise.resolve([]),
      run(sb.from('stock_ledger').select('ts,txn_type,value').eq('location_type', 'store').in('txn_type', enforce() ? ['inward', 'issue'] : ['issue']).gte('ts', since).limit(5000))]);
    const low = bal.filter((b) => { const p = productById(b.product_id); return p && Number(p.min_stock) > 0 && Number(b.qty) <= Number(p.min_stock); });
    kpis.replaceChildren(kpi({ icon: 'inbox', tone: 'blue', label: 'MRFs waiting for issue', value: mrfs.length, href: '#/inbox' }), kpi({ icon: 'truck', tone: 'amber', label: 'Draft delivery challans', value: dcs.filter((d) => d.status === 'draft').length, href: '#/dcs?tab=draft' }),
      kpi({ icon: 'undo', tone: 'purple', label: 'Returns to review', value: rdcs.length, href: '#/return-inbox' }),
      ...(enforce() ? [kpi({ icon: 'rupee', tone: 'green', label: 'Store stock value', value: fmtMoney(bal.reduce((a, b) => a + Number(b.value), 0)), href: '#/stock', hint: `${low.length} item(s) at / below minimum` })] : [kpi({ icon: 'truck', tone: 'green', label: 'Challans issued (30 days)', value: dcs.filter((d) => d.status !== 'draft').length })]));
    const heads = ['Store', 'MRFs waiting', 'Draft DCs', 'DCs issued (30 days)', 'Returns to review', ...(enforce() ? ['Stock value', 'Low stock items'] : [])];
    const lines = S.stores.filter((x) => x.active).map((x) => { const sb2 = bal.filter((b) => b.location_id === x.id); return [x.name, mrfs.filter((m) => m.store_id === x.id).length, dcs.filter((d) => d.store_id === x.id && d.status === 'draft').length, dcs.filter((d) => d.store_id === x.id && d.status !== 'draft').length, rdcs.filter((r) => r.store_id === x.id).length, ...(enforce() ? [fmtMoney(sb2.reduce((a, b) => a + Number(b.value), 0)), sb2.filter((b) => { const p = productById(b.product_id); return p && Number(p.min_stock) > 0 && Number(b.qty) <= Number(p.min_stock); }).length] : [])]; });
    const tot = lines.reduce((a, r) => a.map((v, i) => (i === 0 || typeof r[i] !== 'number' ? v : v + r[i])), ['Total', 0, 0, 0, 0, ...(enforce() ? ['', 0] : [])]);
    main.replaceChildren(card({ title: 'Store-wise summary', flush: true, body: h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, heads.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))), h('tbody', null, lines.map((r) => h('tr', null, r.map((v, i) => h('td', { class: i ? 'num' : '', 'data-label': heads[i] }, i === 0 ? h('span', { class: 'cell-main' }, v) : v)))), h('tr', { style: { fontWeight: 700 } }, tot.map((v, i) => h('td', { class: i ? 'num' : '' }, v)))) ) }),
      h('div', { class: 'mt' }, chartCard(led)), enforce() ? ageingCard(bal) : null, enforce() ? lowCard(low) : null);
  }
  /* ---------------------------------------------------------------- job card overview (location-wise table + analysis) */
  function overview(allRows, usage, wsIds) {
    const wrap = h('div'); let type = null;
    const sum = (a, k) => a.reduce((x, r) => x + Number(r[k] || 0), 0);
    const bar = (data, fmt) => { const max = Math.max(1, ...data.map((d) => d.v)); return h('div', { class: 'bars' }, data.map((d) => h('div', { class: 'bar-col' }, h('div', { class: 'pair' }, h('div', { class: 'b a', style: { height: `${(d.v / max) * 100}%` }, title: `${d.label}: ${fmt(d.v)}` })), h('div', { class: 'small muted' }, d.label)))); };
    const draw = () => {
      const rows = (type ? allRows.filter((r) => r.kind === type) : allRows).filter((r) => wsIds.includes(r.workshop_id));
      const lines = wsIds.map((w) => { const m = rows.filter((r) => r.workshop_id === w); const op = m.filter((r) => r.status === 'open'); return { w, open: op.length, old: op.filter((r) => daysSince(r.opened_at) > 7).length, comp: m.filter((r) => r.status === 'completed').length, fin: m.filter((r) => r.status === 'finalized').length, total: m.length, value: sum(m, 'value'), hours: sum(m, 'hours') }; }).filter((l) => l.total || wsIds.length === 1);
      const T = lines.reduce((a, l) => ({ open: a.open + l.open, old: a.old + l.old, comp: a.comp + l.comp, fin: a.fin + l.fin, total: a.total + l.total, value: a.value + l.value, hours: a.hours + l.hours }), { open: 0, old: 0, comp: 0, fin: 0, total: 0, value: 0, hours: 0 });
      const heads = ['Workshop', 'Pending (open)', 'Open > 7 days', 'Awaiting approval', 'Finalized', 'Total cards', 'Spares value', 'Man-hours'];
      const table = h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, heads.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
        h('tbody', null, lines.map((l) => h('tr', null, [wsName(l.w), l.open, l.old, l.comp, l.fin, l.total, fmtMoney(l.value), fmtNum(l.hours, 1)].map((v, i) => h('td', { class: i ? 'num' : '', 'data-label': heads[i] }, i === 0 ? h('span', { class: 'cell-main' }, v) : v)))),
          h('tr', { style: { fontWeight: 700 } }, ['Total', T.open, T.old, T.comp, T.fin, T.total, fmtMoney(T.value), fmtNum(T.hours, 1)].map((v, i) => h('td', { class: i ? 'num' : '' }, v)))));
      const stack = lines.map((l) => { const t = Math.max(1, l.open + l.comp + l.fin); const seg = (n, c, tt) => (n ? h('div', { title: `${tt}: ${n}`, style: { width: `${(n / t) * 100}%`, background: c } }) : null);
        return h('div', { style: { marginBottom: '10px' } }, h('div', { class: 'row between small' }, h('b', null, wsName(l.w)), h('span', { class: 'muted' }, `${l.open} open · ${l.comp} awaiting · ${l.fin} finalized`)), h('div', { style: { display: 'flex', height: '12px', borderRadius: '99px', overflow: 'hidden', background: 'var(--surface-3, #e5e9f0)' } }, seg(l.open, '#1f63b8', 'Open'), seg(l.comp, '#d98a00', 'Awaiting approval'), seg(l.fin, '#12804f', 'Finalized'))); });
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - (5 - i)); const n = new Date(d); n.setMonth(n.getMonth() + 1); return { label: d.toLocaleDateString('en-GB', { month: 'short' }), m: rows.filter((r) => { const t = new Date(r.created_at); return t >= d && t < n; }) }; });
      const use = new Map(); usage.filter((u) => wsIds.includes(u.workshop_id) && (!type || u.kind === type)).forEach((u) => { const c = use.get(u.product_id) || { q: 0, v: 0 }; c.q += Number(u.qty); c.v += Number(u.amount); use.set(u.product_id, c); });
      const top = [...use.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 8);
      wrap.replaceChildren(
        h('div', { class: 'row between mb', style: { alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, h('h3', { style: { margin: 0 } }, 'Job cards - location-wise status'), h('div', { style: { minWidth: '230px' } }, selectBox({ options: [{ value: 'job_card', label: 'Job Cards' }, { value: 'consumable', label: 'Consumable Job Cards' }, { value: 'facility', label: 'Facility Job Cards' }], value: type, placeholder: 'All card types', onChange: (v) => { type = v; draw(); } }))),
        card({ flush: true, body: lines.length ? table : emptyState({ title: 'No job cards yet' }) }),
        h('div', { class: 'grid c2 mt' }, card({ title: 'Status split by workshop', body: h('div', null, stack, h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#1f63b8' } }), 'Open'), h('span', null, h('i', { style: { background: '#d98a00' } }), 'Awaiting approval'), h('span', null, h('i', { style: { background: '#12804f' } }), 'Finalized'))) }),
          card({ title: 'Cards created - last 6 months', body: bar(months.map((x) => ({ label: x.label, v: x.m.length })), (n) => `${n} cards`) })),
        h('div', { class: 'grid c2 mt' }, card({ title: 'Spares value by month', body: bar(months.map((x) => ({ label: x.label, v: sum(x.m, 'value') })), fmtMoney) }),
          card({ title: 'Top consumed spares (90 days, by value)', flush: true, body: top.length ? h('table', { class: 'dt stack' }, h('thead', null, h('tr', null, ['Spare', 'Qty', 'Value'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))), h('tbody', null, top.map(([pid, c]) => { const pr = productById(pid); return h('tr', null, h('td', { 'data-label': 'Spare' }, h('div', { class: 'cell-main' }, pr?.description || '?'), h('div', { class: 'cell-sub mono' }, pr?.item_code || '')), h('td', { class: 'num', 'data-label': 'Qty' }, fmtNum(c.q)), h('td', { class: 'num', 'data-label': 'Value' }, fmtMoney(c.v))); }))) : emptyState({ title: 'No spares consumed' }) })));
    };
    draw(); return wrap;
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
