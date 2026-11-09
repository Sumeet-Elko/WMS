import { isConfigured } from './config.js';
import { sb, clearWatches } from './db.js';
import { login, logout, resume, getState, onForcedLogout } from './auth.js';

const V = (f) => () => import('./views/' + f + '.js');
const ROUTES = {
  dashboard: ['Dashboard', null, []],            // chosen by role below
  users: ['Users & Access', V('users'), []],
  locations: ['Stores & Workshops', V('locations'), []],
  sessions: ['Live Sessions', V('sessions'), []],
  settings: ['Session Settings', V('settings'), []],
  vehicles: ['Vehicle Master', V('masters'), ['vehicles']],
  employees: ['Employee Master', V('masters'), ['employees']],
  products: ['Spare Master', V('masters'), ['products']],
  audit: ['Audit Ledger', V('audit'), []],
  ops: ['Operations health', V('opsdash'), []],
  jobcards: ['Job Cards', V('jobcards'), null],
  mrfs: ['Material Requests', V('mrf'), null],
  dcs: ['Delivery Challans', V('dc'), null],
  stock: ['Stock', V('stock'), []],
  tokens: ['Reversal Tokens', V('tokens'), []],
};

function groups() {
  const p = getState().profile;
  if (p.role === 'admin') return [
    ['Overview', ['dashboard', 'ops']],
    ['Access control', ['users', 'locations', 'sessions', 'settings']],
    ['Master data', ['vehicles', 'employees', 'products']],
    ['Operations (view)', ['jobcards', 'mrfs', 'dcs', 'stock', 'tokens']],
    ['Compliance', ['audit']],
  ];
  if (p.locations?.type === 'workshop') return [['Workshop', ['dashboard', 'jobcards', 'mrfs', 'dcs', 'stock', 'tokens']]];
  return [['Store', ['dashboard', 'mrfs', 'dcs', 'stock', 'tokens']]];
}
function label(name) {
  const p = getState().profile;
  if (name === 'stock') return p.role === 'admin' ? 'Stock' : p.locations?.type === 'store' ? 'Store Stock' : 'Floor Stock';
  if (name === 'mrfs' && p.locations?.type === 'store') return 'Requests from Workshops';
  return ROUTES[name][0];
}

const $ = (id) => document.getElementById(id);

function showLogin(message) {
  clearWatches();
  $('app').hidden = true; $('login').hidden = false;
  const m = $('loginMsg');
  m.textContent = message || ''; m.hidden = !message;
}

async function route() {
  const [, seg1, seg2, seg3] = location.hash.split('/');
  const name = ROUTES[seg1] ? seg1 : 'dashboard';
  const r = ROUTES[name];
  clearWatches();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
  const root = $('view');
  root.innerHTML = '<p class="muted">Loading…</p>';
  try {
    let loader = r[1];
    if (name === 'dashboard') loader = V(getState().profile.role === 'admin' ? 'dashboard' : 'opsdash');
    const mod = await loader();
    root.onclick = null;
    await (r[2] && r[2].length ? mod.render(root, ...r[2]) : mod.render(root, seg2, seg3));
  } catch (e) {
    console.error(e);
    root.innerHTML = `<p class="err">Something went wrong: ${e.message}</p>`;
  }
}

async function showApp() {
  const { profile } = getState();
  $('login').hidden = true; $('app').hidden = false;
  const loc = profile.locations ? ` · ${profile.locations.code}` : '';
  $('who').textContent = `${profile.full_name} · ${profile.role.replace('_', ' ')}${loc}`;
  $('nav').innerHTML = groups().map(([g, items]) => `<h4>${g}</h4>` +
    items.map((i) => `<a href="#/${i}" data-r="${i}">${label(i)}</a>`).join('')).join('');
  // Cross-entity telemetry toggle (admin only)
  const sc = $('scope');
  if (profile.role === 'admin') {
    const { data } = await sb.from('locations').select('id,code,name,type').order('code');
    sc.innerHTML = '<option value="">All locations</option>' + (data || []).map((l) => `<option value="${l.id}">${l.code} · ${l.name}</option>`).join('');
    sc.value = getState().scope || '';
    sc.hidden = false;
    sc.onchange = () => { getState().scope = sc.value; route(); };
  } else { sc.hidden = true; getState().scope = ''; }
  if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
  route();
}

window.addEventListener('hashchange', () => { if (!$('app').hidden) route(); });
$('logout').onclick = async () => { await logout(); showLogin('You have been logged out.'); };
$('menu').onclick = () => $('side').classList.toggle('open');
$('nav').onclick = () => $('side').classList.remove('open');
onForcedLogout((msg) => showLogin(msg));

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try {
    await login($('userid').value, $('password').value);
    $('password').value = '';
    await showApp();
  } catch (err) {
    showLogin(err.message);
  } finally { btn.disabled = false; }
};

(async function start() {
  if (!isConfigured()) {
    $('setupWarn').hidden = false;
    $('loginForm').querySelector('button').disabled = true;
    return;
  }
  if (await resume()) await showApp(); else showLogin();
})();
