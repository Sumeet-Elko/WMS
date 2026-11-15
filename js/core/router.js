// Hash router with role guards, view lifecycle (flush -> destroy), and page title handling
import { h, clear, emptyState, btn, progress, toast, errMsg } from './ui.js';
import { role } from './api.js';

const routes = []; let container; let current = null; let onTitle = () => {}; let onRoute = () => {}; let token = 0;

export function defineRoutes(list) { routes.push(...list); }
export function startRouter({ outlet, setTitle, afterRoute }) {
  container = outlet; onTitle = setTitle || onTitle; onRoute = afterRoute || onRoute;
  window.addEventListener('hashchange', resolve);
  resolve();
}
export const navigate = (path) => { if (location.hash === '#' + path) resolve(); else location.hash = '#' + path; };
export const replacePath = (path) => history.replaceState(null, '', '#' + path); // change URL without re-render
export const currentView = () => current;
export const currentPath = () => (location.hash.slice(1) || '/dashboard').split('?')[0];

function parse(hash) {
  const [path, qs] = (hash.slice(1) || '/dashboard').split('?');
  return { path: path || '/dashboard', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function match(path) {
  for (const r of routes) {
    const names = []; const re = new RegExp('^' + r.path.replace(/:[^/]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    const m = path.match(re);
    if (m) return { route: r, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export async function leaveCurrent() {
  if (!current) return;
  const v = current; current = null;
  try { if (v.flush) await v.flush(); } catch (e) { console.warn('flush failed', e); }
  try { v.destroy && (await v.destroy()); } catch (e) { console.warn('destroy failed', e); }
}

async function resolve() {
  const my = ++token;
  const { path, query } = parse(location.hash);
  const m = match(path);
  await leaveCurrent();
  if (my !== token) return;
  clear(container);
  if (!m) { container.appendChild(h('div', { class: 'page' }, emptyState({ icon: 'search', title: 'Page not found', text: path, action: btn('Go to dashboard', { onClick: () => navigate('/dashboard') }) }))); onTitle('Not found'); return; }
  if (m.route.roles && !m.route.roles.includes(role())) {
    container.appendChild(h('div', { class: 'page' }, emptyState({ icon: 'lock', title: 'Not available for your role', text: 'Ask the administrator if you need access.', action: btn('Go to dashboard', { onClick: () => navigate('/dashboard') }) })));
    onTitle('No access'); return;
  }
  const page = h('div', { class: 'page' });
  page.appendChild(h('div', { class: 'skeleton', style: { height: '84px', marginBottom: '14px' } }));
  page.appendChild(h('div', { class: 'skeleton', style: { height: '320px' } }));
  container.appendChild(page);
  window.scrollTo(0, 0);
  onTitle(m.route.title || '', '');
  progress.start();
  try {
    const mod = await m.route.view();
    const ctx = { params: m.params, query, path, setTitle: (t, s) => onTitle(t, s) };
    const res = await mod.render(ctx);
    if (my !== token) { res && res.destroy && res.destroy(); return; }
    const view = res instanceof Node ? { el: res } : res;
    clear(container);
    const wrap = h('div', { class: 'page' }, view.el);
    container.appendChild(wrap);
    current = view;
    onRoute(path);
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    clear(container);
    container.appendChild(h('div', { class: 'page' }, emptyState({ icon: 'alert', title: 'Something went wrong', text: errMsg(e), action: btn('Retry', { onClick: resolve }) })));
  } finally { progress.done(); }
}
