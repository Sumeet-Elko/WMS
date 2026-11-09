// Small helpers shared by every screen

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDate = (d) => d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

// Status badge colours (Slate / Amber / Blue / Emerald / Coral)
const KINDS = {
  active: 'green', approved: 'green', online: 'green', yes: 'green', closed: 'green', matched: 'green', used: 'green',
  ended: 'slate', expired: 'slate', draft: 'slate', issued: 'slate',
  stale: 'amber', pending: 'amber', pending_verification: 'amber',
  info: 'blue', confirmed: 'blue', accepted: 'blue', authorized: 'blue',
  revoked: 'red', inactive: 'red', rejected: 'red', no: 'red', mismatch: 'red',
};
const pretty = (s) => { const t = String(s).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
export const badge = (text, kind) => {
  const key = kind || String(text).toLowerCase();
  return `<span class="badge ${KINDS[key] || 'slate'}">${esc(kind || /[a-z]_[a-z]/.test(text) ? pretty(text) : text)}</span>`;
};

export const fmtQty = (n) => (n === null || n === undefined ? '—' : String(+Number(n).toFixed(3)));
export const toLocalInput = (d) => {
  const x = new Date(d), p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
export const table = (heads, rows, empty = 'Nothing here yet') =>
  `<div class="tablewrap"><table><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>${
    rows.length ? rows.join('') : `<tr><td colspan="${heads.length}" class="muted">${esc(empty)}</td></tr>`}</table></div>`;

export function toast(msg, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 3500);
}

function overlay(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(o);
  return o;
}

// ---- generic form popup. Returns an object of values, or null if cancelled ----
// fields: [{name,label,type:'text|number|password|email|select|checkbox',options:[{value,label}],required,value,readonly,hint}]
export function openForm({ title, fields, submitText = 'Save' }) {
  return new Promise((resolve) => {
    const rows = fields.map((f) => {
      const id = 'f_' + f.name;
      let input;
      if (f.type === 'select') {
        input = `${f.search && (f.options || []).length > 12 ? `<input class="sfilter" data-for="${id}" placeholder="Type to filter the list…">` : ''}<select id="${id}" ${f.readonly ? 'disabled' : ''}>${(f.options || []).map((o) =>
          `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="${id}" rows="3" ${f.readonly ? 'readonly' : ''}>${esc(f.value ?? '')}</textarea>`;
      } else if (f.type === 'checkbox') {
        input = `<label class="chk"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}> ${esc(f.hint || 'Yes')}</label>`;
      } else {
        input = `<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.readonly ? 'readonly' : ''} ${f.type === 'number' ? 'step="any"' : ''} autocomplete="off">`;
      }
      return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${
        f.hint && f.type !== 'checkbox' ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
    }).join('');
    const o = overlay(`<h3>${esc(title)}</h3><form>${rows}<p class="err" hidden></p>
      <div class="row-end"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn">${esc(submitText)}</button></div></form>`);
    const close = (v) => { o.remove(); resolve(v); };
    o.querySelector('[data-x]').onclick = () => close(null);
    o.querySelectorAll('.sfilter').forEach((inp) => {
      const sel = o.querySelector('#' + inp.dataset.for);
      const f = fields.find((x) => 'f_' + x.name === inp.dataset.for);
      inp.oninput = () => {
        const t = inp.value.trim().toLowerCase(), keep = sel.value;
        sel.innerHTML = f.options.filter((op) => !t || String(op.label).toLowerCase().includes(t) || String(op.value) === keep)
          .map((op) => `<option value="${esc(op.value)}" ${String(op.value) === keep ? 'selected' : ''}>${esc(op.label)}</option>`).join('');
      };
    });
    o.querySelector('input,select,textarea')?.focus();
    o.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = o.querySelector('#f_' + f.name);
        if (!el) continue;
        let v = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (f.type === 'number' && v !== '') v = Number(v);
        if (f.required && (v === '' || v === null)) {
          const er = o.querySelector('.err'); er.hidden = false; er.textContent = `${f.label} is required`; return;
        }
        out[f.name] = v === '' ? null : v;
      }
      close(out);
    };
  });
}

// ---- two-step confirmation: step 1 warning, step 2 type a keyword ----
export function confirmTwoStep({ title, message, keyword = 'CONFIRM' }) {
  return new Promise((resolve) => {
    const o = overlay(`<h3>${esc(title)}</h3>
      <div class="step1"><p>${message}</p><div class="row-end">
        <button class="btn ghost" data-x>Cancel</button><button class="btn" data-next>Continue</button></div></div>
      <div class="step2" hidden><p>Type <b>${esc(keyword)}</b> to confirm:</p>
        <input id="kw" autocomplete="off"><div class="row-end">
        <button class="btn ghost" data-x>Cancel</button><button class="btn danger" id="go" disabled>${esc(keyword)}</button></div></div>`);
    const close = (v) => { o.remove(); resolve(v); };
    o.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => close(false)));
    o.querySelector('[data-next]').onclick = () => {
      o.querySelector('.step1').hidden = true; o.querySelector('.step2').hidden = false; o.querySelector('#kw').focus();
    };
    const kw = o.querySelector('#kw'), go = o.querySelector('#go');
    kw.oninput = () => (go.disabled = kw.value.trim() !== keyword);
    go.onclick = () => close(true);
  });
}

export function showInfo(title, html) {
  return new Promise((resolve) => {
    const o = overlay(`<h3>${esc(title)}</h3>${html}<div class="row-end"><button class="btn" data-x>Close</button></div>`);
    o.querySelector('[data-x]').onclick = () => { o.remove(); resolve(); };
  });
}
