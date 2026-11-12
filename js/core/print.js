// A4 documents: on-screen preview, Print, and real PDF (View / Download / Share)
import { h, modal, icon, toast, errMsg } from './ui.js';
import { esc, fmtDateTime } from './format.js';
import { setting } from './api.js';

let cssCache = null;
async function printCss() {
  if (cssCache) return cssCache;
  try { cssCache = await (await fetch(new URL('css/print.css', document.baseURI).href)).text(); } catch { cssCache = ''; }
  return cssCache;
}
// company logo: uploaded by the admin in Settings, otherwise the bundled default
export const logoUrl = () => { const l = setting('company_logo', ''); return l && String(l).startsWith('data:') ? l : new URL('assets/company-logo.png', document.baseURI).href; };

export function docHeader({ title, no, status }) {
  const addr = String(setting('company_address', '') || '').trim(); const gst = String(setting('company_gstin', '') || '').trim();
  return `<div class="ph2">
    <img class="lg" src="${logoUrl()}" alt="">
    <div class="co">${esc(setting('company_name', ''))}</div>
    ${addr ? `<div class="ad">${esc(addr).replace(/\n/g, '<br>')}</div>` : ''}
    ${gst ? `<div class="ad">GSTIN: ${esc(gst)}</div>` : ''}
  </div>
  <div class="tbar"><div class="t">${esc(title)}</div><div class="n">${esc(no || 'DRAFT')}</div><div class="s">${status ? `<span>${esc(status)}</span>` : ''}</div></div>`;
}
export const docFooter = (by) => `<div class="foot"><span>${esc(setting('print_footer', ''))}</span><span>Printed ${esc(fmtDateTime(new Date()))}${by ? ' by ' + esc(by) : ''}</span></div>`;
export const box = (t, body, extra = '') => `<div class="box" ${extra}><h4>${esc(t)}</h4>${body}</div>`;

/* ------------------------------------------------------------------ PDF engine */
const loaded = {};
function loadScript(src) {
  if (loaded[src]) return loaded[src];
  return (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL(src, document.baseURI).href; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF library')); document.head.appendChild(s); }));
}
const waitImages = (root) => Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 3000); }))));

// Build a real A4 PDF (selectable layout, page breaks never cut through a table row / box)
export async function buildPdf(html) {
  await Promise.all([loadScript('js/vendor/html2canvas.min.js'), loadScript('js/vendor/jspdf.umd.min.js')]);
  const css = await printCss();
  const host = h('div', { style: { position: 'fixed', left: '-10000px', top: '0', width: '190mm', background: '#fff', zIndex: -1 } });
  const st = document.createElement('style'); st.textContent = css.replace(/@media print\s*{[\s\S]*$/, ''); host.appendChild(st);
  const doc = h('div', { class: 'print-doc', html }); doc.style.cssText = 'width:190mm;margin:0;padding:0;box-shadow:none;min-height:0';
  host.appendChild(doc); document.body.appendChild(host);
  try {
    await waitImages(doc); if (document.fonts?.ready) await document.fonts.ready;
    const SC = 2; const canvas = await window.html2canvas(doc, { scale: SC, backgroundColor: '#fff', useCORS: true, logging: false, windowWidth: doc.scrollWidth });
    const docW = doc.getBoundingClientRect().width; const k = canvas.width / docW; // canvas px per css px
    const pageHcss = (277 / 190) * docW; const base = doc.getBoundingClientRect().top;
    const marks = [...doc.querySelectorAll('tr, .box, .write, .sig, .foot, .ph2, .tbar, .note, .grid2, .grid3')].map((e) => e.getBoundingClientRect().bottom - base).filter((b) => b > 0).sort((a, b) => a - b);
    const totalCss = canvas.height / k; const cuts = []; let start = 0;
    while (totalCss - start > pageHcss + 1) {
      let cut = start + pageHcss; const cands = marks.filter((b) => b > start + pageHcss * 0.35 && b <= start + pageHcss);
      if (cands.length) cut = cands[cands.length - 1];
      cuts.push([start, cut]); start = cut;
    }
    cuts.push([start, totalCss]);
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    cuts.forEach(([a, b], i) => {
      if (i) pdf.addPage();
      const sy = Math.round(a * k); const sh = Math.max(1, Math.round((b - a) * k));
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = sh; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, 190, (sh / canvas.width) * 190);
    });
    return pdf.output('blob');
  } finally { host.remove(); }
}
const safeName = (t) => `${String(t || 'document').replace(/[^\w.-]+/g, '_')}.pdf`;
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }

// Show a preview dialog with Print / View PDF / Download PDF / Share
export async function printPreview(title, html) {
  const css = await printCss();
  const doc = h('div', { class: 'print-doc', html }); const style = document.createElement('style'); style.textContent = css.replace(/@media print\s*{[\s\S]*$/, '');
  const wrap = h('div', { class: 'print-preview' }, style, doc);
  const fit = () => { const w = wrap.clientWidth - 24; const need = 794; doc.style.zoom = w > 0 && w < need ? String(Math.max(0.35, w / need)) : ''; };
  let blobP = null; const getBlob = () => (blobP ||= buildPdf(html).catch((e) => { blobP = null; throw e; }));
  const busy = (b, fn) => async () => { if (b.disabled) return; b.disabled = true; b.classList.add('loading'); try { await fn(); } catch (e) { toast(errMsg(e), 'err'); } finally { b.disabled = false; b.classList.remove('loading'); } };
  const bView = h('button', { class: 'btn', type: 'button' }, icon('eye'), 'View PDF');
  const bDown = h('button', { class: 'btn', type: 'button' }, icon('download'), 'Download');
  const bShare = h('button', { class: 'btn primary', type: 'button' }, icon('share'), 'Share');
  const bPrint = h('button', { class: 'btn', type: 'button', onClick: () => printHtml(html, title) }, icon('printer'), 'Print');
  bView.onclick = busy(bView, async () => { const w = window.open('', '_blank'); const blob = await getBlob(); const url = URL.createObjectURL(blob); if (w) w.location.href = url; else downloadBlob(blob, safeName(title)); });
  bDown.onclick = busy(bDown, async () => { downloadBlob(await getBlob(), safeName(title)); toast('PDF downloaded'); });
  bShare.onclick = busy(bShare, async () => {
    const blob = await getBlob(); const file = new File([blob], safeName(title), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title }); } catch (e) { if (e.name !== 'AbortError') throw e; } }
    else { downloadBlob(blob, safeName(title)); toast('Sharing is not supported on this device/browser - the PDF was downloaded instead. Attach it from your downloads.', 'warn', 6000); }
  });
  const m = modal({ title: `${title}`, size: 'lg', content: wrap,
    foot: [h('button', { class: 'btn ghost', type: 'button', onClick: () => m.close() }, 'Close'), h('div', { class: 'grow' }), bPrint, bView, bDown, bShare] });
  requestAnimationFrame(fit); window.addEventListener('resize', fit); const oc = m.close; m.close = (...a) => { window.removeEventListener('resize', fit); return oc(...a); };
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
