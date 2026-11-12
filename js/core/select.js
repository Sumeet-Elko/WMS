// Searchable dropdown (single select) - keyboard friendly, mobile friendly
import { h, icon } from './ui.js';

let activePop = null;
export function closeSelectPop() { if (activePop) { activePop.close(); activePop = null; } }

/**
 * selectBox({ options:[{value,label,sub?,search?,disabled?}], value, placeholder, onChange, clearable, disabled, small, searchable })
 * returns element with: getValue(), setValue(v, silent), setOptions(opts), setDisabled(b), markInvalid(b), getOption()
 */
export function selectBox({ options = [], value = null, placeholder = 'Select...', onChange, clearable = true, disabled = false, small = false, searchable = true, cls = '' } = {}) {
  let opts = options; let val = value; let dis = disabled;
  const label = h('span', { class: 'val ph' }, placeholder);
  const arrow = icon('chevDown');
  const trigger = h('button', { type: 'button', class: `select-trigger${small ? ' sm' : ''}`, disabled: dis || null }, label, arrow);
  const root = h('div', { class: `select ${cls}`.trim() }, trigger);

  const find = (v) => opts.find((o) => String(o.value) === String(v));
  const paint = () => {
    const o = val !== null && val !== undefined && val !== '' ? find(val) : null;
    label.textContent = o ? o.label : placeholder;
    label.classList.toggle('ph', !o);
  };

  const open = () => {
    if (dis) return;
    closeSelectPop();
    let q = ''; let hi = 0; let shown = [];
    const input = h('input', { type: 'text', placeholder: 'Type to search...', autocomplete: 'off' });
    const list = h('div', { class: 'list', role: 'listbox' });
    const pop = h('div', { class: 'select-pop' }, searchable ? h('div', { class: 'search' }, input) : null, list);
    const r = trigger.getBoundingClientRect();
    pop.style.width = Math.max(r.width, 260) + 'px';
    pop.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 260) - 8) + 'px';
    document.body.appendChild(pop);
    trigger.classList.add('open');

    const phone = window.innerWidth <= 720;
    const place = () => {
      if (phone) { // on phones the keyboard covers the lower half: pin the list to the top of the visible area
        const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        pop.style.left = '8px'; pop.style.right = '8px'; pop.style.width = 'auto'; pop.style.top = '8px'; pop.style.bottom = 'auto';
        pop.style.maxHeight = Math.min(420, vh - 16) + 'px'; return;
      }
      const below = window.innerHeight - r.bottom - 12; const above = r.top - 12;
      const maxH = 330;
      if (below >= 200 || below >= above) { pop.style.top = r.bottom + 6 + 'px'; pop.style.bottom = 'auto'; pop.style.maxHeight = Math.min(maxH, below) + 'px'; }
      else { pop.style.bottom = window.innerHeight - r.top + 6 + 'px'; pop.style.top = 'auto'; pop.style.maxHeight = Math.min(maxH, above) + 'px'; }
    };
    place();

    const mark = (s) => {
      if (!q) return document.createTextNode(s);
      const i = s.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return document.createTextNode(s);
      return h('span', null, s.slice(0, i), h('mark', null, s.slice(i, i + q.length)), s.slice(i + q.length));
    };
    const render = () => {
      list.innerHTML = '';
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      shown = opts.filter((o) => {
        if (!terms.length) return true;
        const hay = `${o.label} ${o.sub || ''} ${o.search || ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      }).slice(0, 300);
      if (hi >= shown.length) hi = Math.max(0, shown.length - 1);
      if (!shown.length) list.appendChild(h('div', { class: 'none' }, 'No matches'));
      shown.forEach((o, i) => {
        const el = h('div', { class: `opt${i === hi ? ' hl' : ''}${String(o.value) === String(val) ? ' sel' : ''}${o.disabled ? ' dis' : ''}`, role: 'option', onMouseenter: () => { hi = i; hlite(); }, onMousedown: (e) => { e.preventDefault(); choose(o); } },
          h('div', { class: 't' }, mark(o.label)), o.sub ? h('div', { class: 's' }, o.sub) : null);
        list.appendChild(el);
      });
    };
    const hlite = () => [...list.children].forEach((c, i) => c.classList && c.classList.toggle('hl', i === hi));
    const choose = (o) => { if (o.disabled) return; api.close(); setValue(o.value); };
    const api = {
      close() {
        pop.remove(); trigger.classList.remove('open');
        document.removeEventListener('mousedown', outside, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onScroll, true); if (window.visualViewport) window.visualViewport.removeEventListener('resize', place);
        if (activePop === api) activePop = null;
      },
    };
    const outside = (e) => { if (!pop.contains(e.target) && !trigger.contains(e.target)) api.close(); };
    // phones fire resize/scroll when the on-screen keyboard opens - those must NOT close the list
    const openedAt = Date.now(); const w0 = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== w0) api.close(); };
    const onScroll = (e) => { if (pop.contains(e.target) || phone || Date.now() - openedAt < 500 || document.activeElement === input) return; api.close(); };
    input.addEventListener('input', () => { q = input.value; hi = 0; render(); });
    const keys = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(shown.length - 1, hi + 1); hlite(); list.children[hi]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); hlite(); list.children[hi]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shown[hi]) choose(shown[hi]); }
      else if (e.key === 'Escape') { e.stopPropagation(); api.close(); trigger.focus(); }
      else if (e.key === 'Tab') api.close();
    };
    input.addEventListener('keydown', keys); pop.addEventListener('keydown', keys);
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', onResize); window.addEventListener('scroll', onScroll, true);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', place);
    activePop = api;
    render();
    // scroll selected into view
    const selEl = list.querySelector('.sel'); if (selEl) selEl.scrollIntoView({ block: 'center' });
    if (searchable) { input.focus({ preventScroll: true }); setTimeout(() => { if (document.activeElement !== input) input.focus({ preventScroll: true }); }, 60); }
    else { pop.tabIndex = 0; pop.focus(); }
  };

  const setValue = (v, silent = false) => {
    val = v === undefined || v === '' ? null : v; paint();
    root.classList.remove('invalid'); trigger.classList.remove('invalid');
    if (!silent && onChange) onChange(val, find(val));
  };

  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && clearable && val) { e.preventDefault(); setValue(null); }
  });
  if (clearable) {
    const x = h('span', { class: 'clear', title: 'Clear', style: { display: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '0 2px', lineHeight: 1 } }, icon('x'));
    x.querySelector('svg').style.width = '14px';
    x.addEventListener('click', (e) => { e.stopPropagation(); setValue(null); });
    trigger.insertBefore(x, arrow);
    const sync = () => (x.style.display = val && !dis ? 'inline-flex' : 'none');
    const _paint = paint; // eslint-disable-line
    const orig = paint;
    root._sync = sync;
    const wrapped = () => { orig(); sync(); };
    // replace paint with wrapped
    Object.defineProperty(root, '_paint', { value: wrapped });
  }

  root.getValue = () => (val === undefined ? null : val);
  root.getOption = () => find(val);
  root.setValue = (v, silent = true) => { val = v === undefined || v === '' ? null : v; paint(); root._sync && root._sync(); if (!silent && onChange) onChange(val, find(val)); };
  root.setOptions = (o, keep = true) => { opts = o || []; if (!keep || (val !== null && !find(val))) val = keep && find(val) ? val : null; paint(); root._sync && root._sync(); };
  root.setDisabled = (b) => { dis = !!b; trigger.disabled = dis; root._sync && root._sync(); };
  root.markInvalid = (b = true) => trigger.classList.toggle('invalid', b);
  root.focus = () => trigger.focus();
  // keep clear icon in sync after user selection
  const _setValue = setValue;
  trigger.addEventListener('mouseenter', () => root._sync && root._sync());
  // sync after any choose
  const obs = new MutationObserver(() => root._sync && root._sync());
  obs.observe(label, { childList: true, characterData: true, subtree: true });
  paint(); root._sync && root._sync();
  return root;
}

// convenience: build options from plain strings / objects
export const opts = (arr, v = (x) => x.id, l = (x) => x.name, s) => arr.map((x) => ({ value: v(x), label: l(x), sub: s ? s(x) : undefined }));
export const strOpts = (arr) => arr.map((x) => ({ value: x, label: x }));
