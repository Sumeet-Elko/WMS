// UI toolkit: DOM helper, modal, toast, confirm/prompt, badges, tabs, form helpers
import { icon, iconSvg } from './icons.js';
import { esc } from './format.js';
export { icon, iconSvg, esc };

// Make native append/prepend/replaceChildren ignore null / undefined / false (and accept nested arrays)
['append', 'prepend', 'replaceChildren'].forEach((m) => {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false)); };
});

/* ------------------------------------------------------------------ h() */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (['value', 'checked', 'disabled', 'readOnly', 'required', 'selected', 'indeterminate'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ progress + busy */
let _prog = 0, _progEl;
export const progress = {
  start() {
    _prog++; if (!_progEl) { _progEl = h('div', { id: 'topbar-progress' }); document.body.appendChild(_progEl); }
    _progEl.style.opacity = 1; _progEl.style.width = '65%';
  },
  done() {
    _prog = Math.max(0, _prog - 1); if (_prog > 0 || !_progEl) return;
    _progEl.style.width = '100%'; setTimeout(() => { if (_prog === 0 && _progEl) { _progEl.style.opacity = 0; _progEl.style.width = '0'; } }, 250);
  },
};

// Wrap an async click handler: shows spinner on the button, toasts errors.
export function act(fn) {
  return async (e) => {
    const btn = e && e.currentTarget && e.currentTarget.classList ? e.currentTarget : null;
    if (btn && btn.classList.contains('loading')) return;
    btn?.classList.add('loading'); progress.start();
    try { return await fn(e, btn); }
    catch (err) { if (err && err.silent) return; console.error(err); toast(errMsg(err), 'err', 6000); }
    finally { btn?.classList.remove('loading'); progress.done(); }
  };
}
export function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.details)) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network problem - please check your connection and try again.';
  if (/JWT expired/i.test(m)) return 'Your session expired. Please sign in again.';
  if (/violates row-level security/i.test(m)) return 'You do not have permission to do that.';
  if (/duplicate key value violates unique constraint/i.test(m)) return 'That value already exists - it must be unique.';
  if (/violates foreign key constraint/i.test(m)) return 'This record is referenced elsewhere and cannot be removed.';
  return m;
}

/* ------------------------------------------------------------------ toast */
export function toast(msg, type = 'ok', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); }
  const ic = { ok: 'checkCircle', err: 'xCircle', warn: 'alert', info: 'info' }[type] || 'info';
  const t = h('div', { class: `toast ${type}` }, icon(ic), h('div', { class: 'grow' }, msg));
  box.appendChild(t);
  const kill = () => { t.style.transition = 'opacity .2s, transform .2s'; t.style.opacity = 0; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 220); };
  t.addEventListener('click', kill); setTimeout(kill, ms);
}

/* ------------------------------------------------------------------ modal */
const modalStack = [];
export function modal({ title, content, foot, size = '', dismissable = true, onClose, icon: ic } = {}) {
  let resolveClosed; const closed = new Promise((r) => (resolveClosed = r));
  const titleEl = h('h2', null, title || '');
  const closeBtn = h('button', { class: 'btn icon sm ghost', title: 'Close', onClick: () => api.close() }, icon('x'));
  const body = h('div', { class: 'modal-body' }, content);
  const footer = foot && (Array.isArray(foot) ? foot.length : true) ? h('div', { class: 'modal-foot' }, foot) : null;
  const box = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, ic ? icon(ic) : null, titleEl, dismissable ? closeBtn : null), body, footer);
  const overlay = h('div', { class: 'overlay' }, box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && dismissable) api.close(); });
  const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === api && dismissable && !document.querySelector('.select-pop')) api.close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const api = {
    el: overlay, box, body, footer, closed,
    setTitle: (t) => (titleEl.textContent = t),
    close(result) {
      if (api._done) return; api._done = true;
      document.removeEventListener('keydown', onKey);
      const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      overlay.remove(); if (!modalStack.length) document.body.style.overflow = '';
      onClose && onClose(result); resolveClosed(result);
    },
  };
  modalStack.push(api);
  setTimeout(() => { const f = box.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), textarea'); f && f.focus && f.focus(); }, 60);
  return api;
}
export const closeAllModals = () => [...modalStack].forEach((m) => m.close());

export function confirmBox({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', tone = 'primary', extra } = {}) {
  return new Promise((resolve) => {
    const toneCls = { danger: 't-red', warn: 't-amber', primary: 't-blue', success: 't-green' }[tone] || 't-blue';
    const ic = { danger: 'alert', warn: 'alert', primary: 'info', success: 'checkCircle' }[tone] || 'info';
    const content = h('div', { class: 'row nowrap', style: { alignItems: 'flex-start', gap: '14px' } },
      h('div', { class: `confirm-ico ${toneCls}` }, icon(ic)),
      h('div', { class: 'grow' }, h('div', { style: { lineHeight: 1.6 } }, message), extra || null));
    const m = modal({
      title, content, size: '', dismissable: true, onClose: (r) => resolve(!!r),
      foot: [
        h('button', { class: 'btn', onClick: () => m.close(false) }, cancelText),
        h('button', { class: `btn ${tone === 'danger' ? 'danger' : 'primary'}`, onClick: () => m.close(true), autofocus: true }, confirmText),
      ],
    });
  });
}

// Ask for a text (e.g. a reason). Resolves to the string or null if cancelled.
export function promptBox({ title = 'Reason', message = '', label = 'Reason', placeholder = '', required = true, multiline = true, confirmText = 'Submit', tone = 'primary', value = '' } = {}) {
  return new Promise((resolve) => {
    const ctl = multiline ? h('textarea', { class: 'textarea', placeholder, value, autofocus: true }) : h('input', { class: 'input', placeholder, value, autofocus: true });
    const err = h('div', { class: 'err hide' }, 'This is required');
    const submit = () => {
      const v = ctl.value.trim();
      if (required && !v) { ctl.classList.add('invalid'); err.classList.remove('hide'); ctl.focus(); return; }
      m.close(v);
    };
    if (!multiline) ctl.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    const m = modal({
      title, dismissable: true, onClose: (r) => resolve(typeof r === 'string' ? r : null),
      content: h('div', { class: 'col' }, message ? h('div', null, message) : null,
        h('div', { class: 'field' }, h('label', null, label, required ? h('span', { class: 'req' }, '*') : null), ctl, err)),
      foot: [h('button', { class: 'btn', onClick: () => m.close(null) }, 'Cancel'),
        h('button', { class: `btn ${tone === 'danger' ? 'danger' : 'primary'}`, onClick: submit }, confirmText)],
    });
  });
}

/* ------------------------------------------------------------------ popover (anchored menu) */
export function popover(anchor, content, { align = 'right', width } = {}) {
  closePopovers();
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'popover', style: { top: `${r.bottom + 8}px` } }, content);
  if (width) pop.style.width = width + 'px';
  document.body.appendChild(pop);
  const pw = pop.offsetWidth;
  let left = align === 'right' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  pop.style.left = left + 'px';
  const off = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const close = () => { pop.remove(); document.removeEventListener('mousedown', off, true); };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  pop.close = close; pop.dataset.pop = '1';
  return pop;
}
export const closePopovers = () => $$('.popover[data-pop]').forEach((p) => p.close && p.close());

/* ------------------------------------------------------------------ status badges */
export const STATUS = {
  jc:   { draft: ['Draft', 'muted'], open: ['Open', 'info'], completed: ['Awaiting approval', 'warn'], finalized: ['Finalized', 'ok'] },
  mrf:  { draft: ['Draft', 'muted'], sent: ['Sent to store', 'info'], returned: ['Returned by store', 'warn'], closed: ['Closed', 'purple'] },
  dc:   { draft: ['Draft', 'muted'], issued: ['Issued', 'info'], acknowledged: ['Acknowledged', 'ok'], reversed: ['Reversed', 'danger'] },
  rdc:  { draft: ['Draft', 'muted'], sent: ['Sent to store', 'info'], reviewed: ['Rejections pending', 'warn'], closed: ['Closed', 'ok'] },
  inward: { posted: ['Posted', 'ok'], reversed: ['Reversed', 'danger'] },
  line: { open: ['Open', 'muted'], fulfilled: ['Fulfilled', 'ok'], rejected: ['Rejected', 'danger'], pending: ['Pending', 'muted'], accepted: ['Accepted', 'ok'], acknowledged: ['Acknowledged', 'ok'] },
  rq:   { queued: ['In queue', 'warn'], in_draft: ['In draft DC', 'muted'], sent: ['Sent', 'info'] },
  master: { active: ['Active', 'ok'], inactive: ['Inactive', 'muted'] },
};
export function badge(text, tone = 'muted', plain = false) { return h('span', { class: `badge b-${tone}${plain ? ' plain' : ''}` }, text); }
export function statusBadge(kind, status) {
  const m = (STATUS[kind] || {})[status] || [status, 'muted'];
  return badge(m[0], m[1]);
}
export const statusLabel = (kind, status) => ((STATUS[kind] || {})[status] || [status])[0];
export const activeBadge = (a) => (a ? badge('Active', 'ok') : badge('Inactive', 'muted'));

/* ------------------------------------------------------------------ layout blocks */
export function pageHead({ title, sub, actions } = {}) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null),
    actions ? h('div', { class: 'actions' }, actions) : null);
}
export function card({ title, actions, body, flush = false, foot, cls = '' } = {}) {
  return h('div', { class: `card ${cls}` },
    title || actions ? h('div', { class: 'card-head' }, typeof title === 'string' ? h('h3', null, title) : title, actions ? h('div', { class: 'row' }, actions) : null) : null,
    h('div', { class: `card-body${flush ? ' flush' : ''}` }, body),
    foot ? h('div', { class: 'card-foot' }, foot) : null);
}
export function kpi({ icon: ic, tone = 'blue', label, value, hint, href, onClick }) {
  const tag = href ? 'a' : 'div';
  return h(tag, { class: `card kpi${onClick ? ' link' : ''}`, href: href || null, onClick: onClick || null },
    h('div', { class: `ico t-${tone}` }, icon(ic)),
    h('div', { class: 'grow' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, value), hint ? h('div', { class: 'hint' }, hint) : null));
}
export function emptyState({ icon: ic = 'inbox', title = 'Nothing here yet', text = '', action } = {}) {
  return h('div', { class: 'empty' }, icon(ic), h('b', null, title), text ? h('div', null, text) : null, action ? h('div', { class: 'mt' }, action) : null);
}
export function banner(tone, content, ic) {
  const i = ic || { info: 'info', warn: 'alert', danger: 'alert', ok: 'checkCircle' }[tone];
  return h('div', { class: `banner ${tone}` }, icon(i), h('div', { class: 'grow bt' }, content));
}
export function kv(pairs) {
  return h('div', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v === null || v === undefined || v === '' ? '—' : v))));
}
export const sectionTitle = (t) => h('div', { class: 'section-title' }, t);

export function tabsBar({ tabs, active, onChange }) {
  const el = h('div', { class: 'tabs' });
  const state = { active };
  const draw = () => {
    clear(el);
    tabs.forEach((t) => el.appendChild(h('button', { class: `tab${t.key === state.active ? ' active' : ''}`, onClick: () => { state.active = t.key; draw(); onChange && onChange(t.key); } },
      t.label, t.count !== undefined && t.count !== null ? h('span', { class: 'n' }, t.count) : null)));
  };
  draw();
  el.setCounts = (m) => { tabs.forEach((t) => { if (m[t.key] !== undefined) t.count = m[t.key]; }); draw(); };
  el.setActive = (k) => { state.active = k; draw(); };
  return el;
}
export function pills({ items, active, onChange }) {
  const el = h('div', { class: 'pill-row' });
  const st = { active };
  const draw = () => {
    clear(el);
    items.forEach((t) => el.appendChild(h('button', { class: `pill${t.key === st.active ? ' active' : ''}`, onClick: () => { st.active = t.key; draw(); onChange && onChange(t.key); } },
      t.label, t.count !== undefined && t.count !== null ? h('span', { class: 'n' }, t.count) : null)));
  };
  draw();
  el.setCounts = (m) => { items.forEach((t) => { if (m[t.key] !== undefined) t.count = m[t.key]; }); draw(); };
  return el;
}

/* ------------------------------------------------------------------ form helpers */
export function field(label, control, { required = false, hint, cls = '', err } = {}) {
  return h('div', { class: `field ${cls}` }, label ? h('label', null, label, required ? h('span', { class: 'req' }, '*') : null) : null, control,
    hint ? h('div', { class: 'hint' }, hint) : null, err ? h('div', { class: 'err' }, err) : null);
}
export function inp(props = {}) {
  const { cls = '', type = 'text', ...rest } = props;
  return h('input', { class: `input ${cls}`.trim(), type, ...rest });
}
export function textarea(props = {}) {
  const { cls = '', ...rest } = props;
  return h('textarea', { class: `textarea ${cls}`.trim(), ...rest });
}
export function checkbox(label, props = {}) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', ...props }), label);
}
export function toggle(props = {}) {
  return h('label', { class: 'switch' }, h('input', { type: 'checkbox', ...props }), h('span'));
}
export function searchInput(props = {}) {
  return h('div', { class: 'input-icon' }, icon('search'), h('input', { class: 'input', type: 'search', placeholder: 'Search...', ...props }));
}
export function markInvalid(el, on = true) { el.classList.toggle('invalid', on); }
export function btn(label, { cls = 'primary', icon: ic, onClick, title, type = 'button', disabled } = {}) {
  return h('button', { class: `btn ${cls}`, type, title: title || null, disabled: disabled || null, onClick }, ic ? icon(ic) : null, label);
}
export function iconBtn(ic, title, onClick, cls = 'ghost sm') {
  return h('button', { class: `btn icon ${cls}`, title, 'aria-label': title, onClick }, icon(ic));
}

// highlight search text in a plain string => Node
export function hl(text, q) {
  const s = String(text ?? '');
  if (!q) return document.createTextNode(s);
  const parts = q.trim().split(/\s+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!parts.length) return document.createTextNode(s);
  const re = new RegExp(`(${parts.join('|')})`, 'ig');
  const frag = document.createDocumentFragment();
  s.split(re).forEach((seg, i) => frag.appendChild(i % 2 ? h('mark', { style: { background: '#ffe58f', color: 'inherit', borderRadius: '3px' } }, seg) : document.createTextNode(seg)));
  return frag;
}
