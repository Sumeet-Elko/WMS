// A4 printing through a hidden iframe (reliable multi-page output) + on-screen preview
import { h, modal, icon } from './ui.js';
import { esc, fmtDateTime } from './format.js';
import { setting } from './api.js';

let cssCache = null;
async function printCss() {
  if (cssCache) return cssCache;
  try { cssCache = await (await fetch(new URL('css/print.css', document.baseURI).href)).text(); } catch { cssCache = ''; }
  return cssCache;
}
export const logoUrl = () => new URL('assets/logo.png', document.baseURI).href;

export function docHeader({ title, no, status }) {
  return `<div class="ph">
    <div style="display:flex;gap:12px;align-items:center"><img src="${logoUrl()}" alt="">
      <div class="co">${esc(setting('company_name', ''))}<small>${esc(setting('company_address', ''))}${setting('company_gstin', '') ? `<br>GSTIN: ${esc(setting('company_gstin'))}` : ''}</small></div></div>
    <div class="dt"><h1>${esc(title)}</h1><div class="no">${esc(no || 'DRAFT')}</div>${status ? `<div class="st">${esc(status)}</div>` : ''}</div></div>`;
}
export const docFooter = (by) => `<div class="foot"><span>${esc(setting('print_footer', ''))}</span><span>Printed ${esc(fmtDateTime(new Date()))}${by ? ' by ' + esc(by) : ''}</span></div>`;
export const box = (t, body, extra = '') => `<div class="box" ${extra}><h4>${esc(t)}</h4>${body}</div>`;

// Show a preview dialog with Print button. `html` is the inner HTML of .print-doc
export async function printPreview(title, html) {
  const css = await printCss();
  const doc = h('div', { class: 'print-doc', html });
  const style = h('style'); style.textContent = css;
  const m = modal({
    title: `Print preview - ${title}`, size: 'lg',
    content: h('div', { class: 'print-preview' }, doc),
    foot: [h('button', { class: 'btn', onClick: () => m.close() }, 'Close'),
      h('button', { class: 'btn primary', onClick: () => printHtml(html, title) }, icon('printer'), 'Print / Save PDF')],
  });
  return m;
}

export async function printHtml(html, title = 'Document') {
  const css = await printCss();
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${css}</style><style>body{margin:0;background:#fff}@media print{.print-doc{position:static!important;width:100%!important}}</style></head>
    <body><div class="print-doc">${html}</div></body></html>`);
  d.close();
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 2500); } };
  const imgs = [...d.images]; let n = imgs.length;
  if (!n) return go();
  const done = () => { if (--n <= 0) go(); };
  imgs.forEach((i) => (i.complete ? done() : (i.onload = i.onerror = done)));
  setTimeout(() => { if (n > 0) { n = 0; go(); } }, 2500);
}
