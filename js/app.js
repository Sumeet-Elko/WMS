// Application bootstrap: auth, shell (sidebar/topbar), routes, live sync
import { CONFIG, isConfigured } from './config.js';
import { sb, S, loadMasters, role, isAdmin, isWs, isStore, isManager, myWorkshop, myStore, pendingCounts, unlockAll } from './core/api.js';
import { h, $, clear, icon, toast, errMsg, modal, popover, closePopovers, field, inp, act, banner } from './core/ui.js';
import { defineRoutes, startRouter, navigate, currentView } from './core/router.js';
import { startSession, stopSession, doLogout } from './core/session.js';
import { greeting, ROLE_LABEL, initials, debounce } from './core/format.js';

const app = document.getElementById('app');
const lazy = (file, fn) => () => import(`./modules/${file}.js`).then((m) => ({ render: m[fn] }));
const WS = ['workshop_manager', 'workshop_supervisor'];
const ALL = ['admin', 'workshop_manager', 'workshop_supervisor', 'store_user'];

const ROUTES = [
  { path: '/dashboard', title: 'Dashboard', view: lazy('dashboard', 'render'), roles: ALL },
  // workshop
  { path: '/jobcards', title: 'Job Cards', view: lazy('jobcards', 'list'), roles: ['admin', ...WS] },
  { path: '/jobcards/:id', title: 'Job Card', view: lazy('jobcards', 'detail'), roles: ['admin', ...WS, 'store_user'] },
  { path: '/cjc', title: 'Consumable Job Cards', view: lazy('cjc', 'list'), roles: ['admin', ...WS] },
  { path: '/cjc/:id', title: 'Consumable Job Card', view: lazy('cjc', 'detail'), roles: ['admin', ...WS] },
  { path: '/mrfs', title: 'Material Requests', view: lazy('mrf', 'list'), roles: ['admin', ...WS] },
  { path: '/mrfs/:id', title: 'Material Request', view: lazy('mrf', 'detail'), roles: ['admin', ...WS] },
  { path: '/receipts', title: 'Receive Materials', view: lazy('receipts', 'list'), roles: ['admin', ...WS] },
  { path: '/receipts/:id', title: 'Delivery Challan', view: lazy('receipts', 'detail'), roles: ['admin', ...WS] },
  { path: '/returns', title: 'Returns', view: lazy('returns', 'workshopList'), roles: ['admin', ...WS] },
  { path: '/returns/:id', title: 'Return Delivery Challan', view: lazy('returns', 'workshopDetail'), roles: ['admin', ...WS] },
  { path: '/wstock', title: 'Workshop Stock', view: lazy('stock', 'workshopStock'), roles: WS },
  // stores
  { path: '/inbox', title: 'MRF Inbox', view: lazy('mrf', 'storeInbox'), roles: ['admin', 'store_user'] },
  { path: '/inbox/:id', title: 'Material Request', view: lazy('mrf', 'storeDetail'), roles: ['admin', 'store_user'] },
  { path: '/dcs', title: 'Delivery Challans', view: lazy('dc', 'list'), roles: ['admin', 'store_user'] },
  { path: '/dcs/:id', title: 'Delivery Challan', view: lazy('dc', 'detail'), roles: ['admin', 'store_user'] },
  { path: '/return-inbox', title: 'Return Inbox', view: lazy('returns', 'storeInbox'), roles: ['admin', 'store_user'] },
  { path: '/return-inbox/:id', title: 'Return Delivery Challan', view: lazy('returns', 'storeDetail'), roles: ['admin', 'store_user'] },
  { path: '/inwards', title: 'Stock Inward', view: lazy('stock', 'inwards'), roles: ['admin', 'store_user'] },
  // inventory
  { path: '/stock', title: 'Stock', view: lazy('stock', 'allStock'), roles: ['admin', 'store_user'] },
  { path: '/ledger', title: 'Stock Ledger', view: lazy('stock', 'ledger'), roles: ALL },
  // masters
  { path: '/products', title: 'Products', view: lazy('masters', 'products'), roles: ALL },
  { path: '/vehicles', title: 'Vehicles', view: lazy('masters', 'vehicles'), roles: ALL },
  { path: '/employees', title: 'Employees', view: lazy('masters', 'employees'), roles: ['admin', ...WS] },
  // admin
  { path: '/workshops', title: 'Workshops', view: lazy('admin', 'workshops'), roles: ['admin'] },
  { path: '/stores', title: 'Stores', view: lazy('admin', 'stores'), roles: ['admin'] },
  { path: '/users', title: 'Users', view: lazy('admin', 'users'), roles: ['admin'] },
  { path: '/dropdowns', title: 'Dropdown Lists', view: lazy('admin', 'dropdowns'), roles: ['admin'] },
  { path: '/settings', title: 'Settings', view: lazy('admin', 'settings'), roles: ['admin'] },
  { path: '/audit', title: 'Audit Log', view: lazy('admin', 'audit'), roles: ['admin'] },
];
defineRoutes(ROUTES);

const NAV = [
  { title: 'Overview', items: [{ path: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ALL }] },
  { title: 'Workshop', items: [
    { path: '/jobcards', label: 'Job Cards', icon: 'wrench', roles: ['admin', ...WS], badge: (c) => (c.jcDrafts || 0) + (c.jcApproval || 0) },
    { path: '/cjc', label: 'Consumable Job Cards', icon: 'layers', roles: ['admin', ...WS], badge: (c) => (c.cjcDrafts || 0) + (c.cjcApproval || 0) },
    { path: '/mrfs', label: 'Material Requests', icon: 'clipboard', roles: ['admin', ...WS], badge: (c) => c.mrfReturned },
    { path: '/receipts', label: 'Receive Materials', icon: 'packagePlus', roles: ['admin', ...WS], badge: (c) => c.receipts },
    { path: '/returns', label: 'Returns', icon: 'undo', roles: ['admin', ...WS], badge: (c) => c.queue },
    { path: '/wstock', label: 'My Workshop Stock', icon: 'layers', roles: WS },
  ] },
  { title: 'Stores', items: [
    { path: '/inbox', label: 'MRF Inbox', icon: 'inbox', roles: ['admin', 'store_user'], badge: (c) => c.mrfInbox },
    { path: '/dcs', label: 'Delivery Challans', icon: 'truck', roles: ['admin', 'store_user'], badge: (c) => c.dcDrafts },
    { path: '/return-inbox', label: 'Return Inbox', icon: 'undo', roles: ['admin', 'store_user'], badge: (c) => c.rdcInbox },
    { path: '/inwards', label: 'Stock Inward', icon: 'download', roles: ['admin', 'store_user'] },
  ] },
  { title: 'Inventory', items: [
    { path: '/stock', label: 'Stock (All Locations)', icon: 'layers', roles: ['admin', 'store_user'] },
    { path: '/ledger', label: 'Stock Ledger', icon: 'history', roles: ALL },
  ] },
  { title: 'Masters', items: [
    { path: '/products', label: 'Spare Parts', icon: 'package', roles: ALL },
    { path: '/vehicles', label: 'Vehicles', icon: 'truck', roles: ALL },
    { path: '/employees', label: 'Employees', icon: 'users', roles: ['admin', ...WS] },
  ] },
  { title: 'Administration', items: [
    { path: '/workshops', label: 'Workshops', icon: 'factory', roles: ['admin'] },
    { path: '/stores', label: 'Stores', icon: 'store', roles: ['admin'] },
    { path: '/users', label: 'Users', icon: 'user', roles: ['admin'] },
    { path: '/dropdowns', label: 'Dropdown Lists', icon: 'list', roles: ['admin'] },
    { path: '/settings', label: 'Settings', icon: 'sliders', roles: ['admin'] },
    { path: '/audit', label: 'Audit Log', icon: 'shield', roles: ['admin'] },
  ] },
];

/* ------------------------------------------------------------------ boot */
async function boot() {
  if (!isConfigured()) return showSetup();
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) return showLogin();
    await enter();
  } catch (e) { console.error(e); showLogin(errMsg(e)); }
}

function showSetup() {
  clear(app).appendChild(h('div', { style: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '20px' } },
    h('div', { class: 'card', style: { maxWidth: '620px', padding: '28px' } },
      h('img', { src: 'assets/logo.png', style: { height: '56px', marginBottom: '16px' }, alt: '' }),
      h('h1', null, 'Almost there - connect Supabase'),
      h('p', { class: 'muted mt' }, 'Open ', h('code', null, 'js/config.js'), ' and paste your Supabase Project URL and anon key (Supabase → Project Settings → API). Then run the four SQL files in ', h('code', null, 'supabase/'), ' in order. The README has the full step-by-step guide.'))));
}

// Users sign in with a User ID; Supabase needs an e-mail, so we map it to a hidden internal address.
const toLoginEmail = (v) => { const s = String(v).trim().toLowerCase(); return s.includes('@') ? s : `${s}@wms.local`; };

function showLogin(message) {
  stopSession();
  document.body.classList.remove('nav-open');
  const email = inp({ type: 'text', placeholder: 'Your User ID', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, autofocus: true });
  const pw = inp({ type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
  const eye = h('button', { type: 'button', class: 'btn icon sm ghost', style: { position: 'absolute', right: '4px', top: '4px' }, title: 'Show / hide password', onClick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; } }, icon('eye'));
  const err = h('div', { class: message ? 'banner warn' : 'hide', style: { marginBottom: '14px' } }, message ? [icon('alert'), h('div', null, message)] : null);
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'col', style: { gap: '16px' }, onSubmit: async (e) => {
    e.preventDefault(); submit.classList.add('loading'); err.className = 'hide';
    try {
      const { error } = await sb.auth.signInWithPassword({ email: toLoginEmail(email.value), password: pw.value });
      if (error) throw error;
      await enter();
    } catch (ex) {
      err.className = 'banner danger'; err.replaceChildren(icon('alert'), h('div', null, /Invalid login/i.test(ex.message) ? 'Incorrect User ID or password.' : errMsg(ex)));
    } finally { submit.classList.remove('loading'); }
  } },
  err, field('User ID', email), field('Password', h('div', { style: { position: 'relative' } }, pw, eye)), submit);
  const points = [['wrench', 'Job cards with man-hours and spares per vehicle'], ['clipboard', 'Material requests to stores, tracked end to end'], ['shield', 'Audit-proof ledger - nothing is ever overwritten'], ['zap', 'Live sync across every workshop and store']];
  clear(app).appendChild(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-hero' },
      h('div', { class: 'logo-card' }, h('img', { src: 'assets/logo.png', alt: 'WMS' })),
      h('div', null, h('h2', null, 'Every repair, every spare, fully accounted for.'), h('p', null, 'Run your company vehicle workshops with one connected system for job cards, material requests, store issues and stock.'),
        h('div', { class: 'hero-points' }, points.map(([i, t]) => h('div', null, icon(i), t)))),
      h('div', { class: 'small', style: { color: '#8d9bb0' } }, `${CONFIG.APP_FULL_NAME}`)),
    h('div', { class: 'login-form-side' }, h('div', { class: 'login-card' },
      h('div', { class: 'logo-mobile' }, h('img', { src: 'assets/logo.png', alt: 'WMS' })),
      h('h1', null, 'Welcome back'), h('p', { class: 'muted', style: { margin: '4px 0 22px' } }, 'Sign in to continue to your workspace.'), form,
      h('p', { class: 'small muted mt-lg' }, 'Forgot your password? Ask your administrator to reset it.')))));
}

async function enter() {
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return showLogin();
  S.user = u.user;
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', u.user.id).maybeSingle();
  if (error) throw error;
  if (!p || !p.active) { await sb.auth.signOut(); return showLogin(!p ? 'Your login is not linked to a WMS profile yet. Please contact the administrator.' : 'Your account has been deactivated.'); }
  S.profile = p;
  clear(app).appendChild(h('div', { style: { display: 'grid', placeItems: 'center', minHeight: '100vh' } }, h('div', { class: 'muted' }, `${greeting()}, ${p.full_name.split(' ')[0]} - loading your workspace…`)));
  await loadMasters();
  buildShell();
  startSession((msg) => showLogin(msg));
  subscribeLive();
  refreshBadges();
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  startRouter({ outlet: $('#outlet'), setTitle, afterRoute: highlightNav });
}

/* ------------------------------------------------------------------ shell */
let counts = {};
function scopeLabel() {
  if (isAdmin()) return 'All workshops & stores';
  if (isWs()) return myWorkshop()?.name || '';
  return myStore()?.name || '';
}
function setTitle(t, sub) {
  const el = $('#top-title'); if (!el) return;
  el.textContent = t || ''; $('#top-sub').textContent = sub || scopeLabel();
  document.title = `${t ? t + ' · ' : ''}WMS`;
}
function buildShell() {
  const me = S.profile;
  const nav = h('nav', { class: 'nav', id: 'nav' });
  NAV.forEach((g) => {
    const items = g.items.filter((i) => i.roles.includes(me.role));
    if (!items.length) return;
    nav.appendChild(h('div', { class: 'nav-group' }, h('div', { class: 'nav-title' }, g.title),
      items.map((i) => h('a', { href: '#' + i.path, 'data-path': i.path, onClick: () => document.body.classList.remove('nav-open') }, icon(i.icon), h('span', null, i.label), h('span', { class: 'count hide', 'data-badge': i.path })))));
  });
  const dark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const themeBtn = h('button', { class: 'btn icon ghost', title: 'Light / dark mode', onClick: () => {
    const t = dark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('wms-theme', t); } catch { /* ignore */ }
    themeBtn.replaceChildren(icon(dark() ? 'sun' : 'moon'));
  } }, icon(dark() ? 'sun' : 'moon'));
  const bell = h('button', { class: 'btn icon ghost bell', title: 'Pending work', onClick: () => showBell(bell) }, icon('bell'), h('span', { class: 'n hide', id: 'bell-n' }));
  const chip = h('div', { class: 'user-chip', onClick: () => userMenu(chip) }, h('div', { class: 'avatar' }, initials(me.full_name)),
    h('div', { class: 'who' }, h('b', null, me.full_name), h('span', null, ROLE_LABEL[me.role])), icon('chevDown', 14));
  const live = h('div', { class: 'side-foot' }, h('span', { class: 'dot', id: 'live-dot' }), h('span', { id: 'live-txt' }, 'Live sync connecting…'));

  clear(app).appendChild(h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, h('div', { class: 'brand-card' }, h('img', { src: 'assets/logo.png', alt: 'WMS' }))), nav, live),
    h('div', { class: 'backdrop', onClick: () => document.body.classList.remove('nav-open') }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn icon ghost menu-btn', 'aria-label': 'Menu', onClick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
        h('div', { class: 'title' }, h('h1', { id: 'top-title' }), h('div', { class: 'sub', id: 'top-sub' })),
        h('div', { class: 'top-actions' }, themeBtn, bell, chip)),
      h('main', { id: 'outlet' }))));
}
function highlightNav(path) {
  document.querySelectorAll('#nav a').forEach((a) => {
    const p = a.dataset.path; a.classList.toggle('active', path === p || path.startsWith(p + '/'));
  });
}
async function refreshBadges() {
  try { counts = await pendingCounts(); } catch { return; }
  NAV.forEach((g) => g.items.forEach((i) => {
    const el = document.querySelector(`[data-badge="${i.path}"]`); if (!el || !i.badge) return;
    const n = i.badge(counts) || 0; el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hide', !n);
  }));
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  const b = $('#bell-n'); if (b) { b.textContent = total > 99 ? '99+' : total; b.classList.toggle('hide', !total); }
}
function showBell(anchor) {
  const L = {
    cjcDrafts: ['Draft consumable job cards', '/cjc', 'layers'], cjcApproval: ['Consumable job cards awaiting approval', '/cjc?tab=completed', 'checkCircle'],
    jcDrafts: ['Draft job cards', '/jobcards', 'wrench'], jcApproval: ['Job cards awaiting your approval', '/jobcards?tab=completed', 'checkCircle'],
    mrfReturned: ['MRFs returned by stores', '/mrfs?tab=returned', 'clipboard'], receipts: ['Deliveries to acknowledge', '/receipts', 'packagePlus'],
    queue: ['Items in return queue', '/returns', 'undo'], mrfInbox: ['MRFs waiting for issue', '/inbox', 'inbox'],
    dcDrafts: ['Draft delivery challans', '/dcs?tab=draft', 'truck'], rdcInbox: ['Returns waiting for review', '/return-inbox', 'undo'],
  };
  const items = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => h('a', { class: 'item', href: '#' + L[k][1], onClick: closePopovers }, icon(L[k][2]), h('span', { class: 'grow' }, L[k][0]), h('b', null, n)));
  popover(anchor, h('div', null, h('div', { class: 'head' }, h('b', null, 'Pending work')), items.length ? items : h('div', { class: 'muted', style: { padding: '16px', textAlign: 'center' } }, 'You are all caught up 🎉')), { width: 320 });
}
function userMenu(anchor) {
  const me = S.profile;
  popover(anchor, h('div', null,
    h('div', { class: 'head' }, h('b', null, me.full_name), h('div', { class: 'small muted' }, me.username || me.email), h('div', { class: 'small muted' }, `${ROLE_LABEL[me.role]} · ${scopeLabel()}`)),
    h('button', { class: 'item', onClick: () => { closePopovers(); changePassword(); } }, icon('key'), 'Change password'),
    h('button', { class: 'item', onClick: () => { closePopovers(); doLogout(); } }, icon('logout'), 'Sign out')));
}
function changePassword() {
  const a = inp({ type: 'password', autocomplete: 'new-password' }); const b = inp({ type: 'password', autocomplete: 'new-password' });
  const m = modal({ title: 'Change password', content: h('div', { class: 'col' }, field('New password (min 8 characters)', a, { required: true }), field('Confirm new password', b, { required: true })),
    foot: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: act(async () => {
      if (a.value.length < 8) throw new Error('Password must be at least 8 characters');
      if (a.value !== b.value) throw new Error('Passwords do not match');
      const { error } = await sb.auth.updateUser({ password: a.value }); if (error) throw error;
      toast('Password updated'); m.close();
    }) }, 'Update password')] });
}

/* ------------------------------------------------------------------ live sync */
let channel = null;
function subscribeLive() {
  if (channel) sb.removeChannel(channel);
  const bump = debounce(() => {
    refreshBadges();
    const v = currentView();
    if (v && v.refresh && !v.isForm) v.refresh().catch?.(() => {});
    else if (v && v.liveNotice) v.liveNotice();
  }, 800);
  channel = sb.channel('wms-live');
  ['job_cards', 'consumable_jcs', 'mrfs', 'delivery_challans', 'return_dcs', 'stock_balances', 'return_queue'].forEach((t) => channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, bump));
  channel.subscribe((status) => {
    const dot = $('#live-dot'), txt = $('#live-txt'); if (!dot) return;
    const ok = status === 'SUBSCRIBED'; dot.classList.toggle('off', !ok); txt.textContent = ok ? 'Live sync · connected' : 'Live sync · reconnecting…';
  });
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.profile) { S.profile = null; showLogin(); } });
window.addEventListener('beforeunload', () => { try { unlockAll(); } catch { /* ignore */ } });
boot();
