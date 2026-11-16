// Attachments for job cards of every type: photos (compressed) and PDFs, kept in Supabase Storage.
// Deleting removes the file for ever. When the card is finalized everything is kept and locked.
import { sb, S, rpc, setting } from './api.js';
import { h, icon, card, btn, iconBtn, act, toast, confirmBox, modal, badge } from './ui.js';
import { fmtDateTime } from './format.js';

const BUCKET = 'job-attachments';
const MAX_PDF_MB = 5;

// shrink a photo to max 1600 px, JPEG 70 %  (usually 150-400 KB)
async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.7));
  if (!blob) throw new Error('Could not process the image');
  return blob;
}
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

/**
 * kind: 'job_card' | 'consumable' (consumable and facility cards)
 * canAdd: user may add/delete (workshop user of the card's workshop, or admin) and card is not finalized
 */
export function attachmentsCard({ kind, cardId, workshopId, status, canAdd }) {
  const maxImg = Number(setting('max_images_per_card', 10)); const maxPdf = Number(setting('max_pdfs_per_card', 10));
  const locked = status === 'finalized'; const can = canAdd && !locked;
  const body = h('div'); const count = h('span'); let rows = [];
  const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  const pdfIn = h('input', { type: 'file', accept: 'application/pdf', multiple: true, style: { display: 'none' } });

  async function load() {
    const { data, error } = await sb.from('attachments').select('*').eq('card_kind', kind).eq('card_id', cardId).order('created_at');
    if (error) { body.replaceChildren(h('div', { class: 'small muted', style: { padding: '12px 18px' } }, 'Attachments are not available yet (run patch 13 in Supabase).')); return; }
    rows = data || []; await draw();
  }
  async function draw() {
    const imgs = rows.filter((r) => r.att_type === 'image'); const pdfs = rows.filter((r) => r.att_type === 'pdf');
    count.replaceChildren(badge(`Photos ${imgs.length}/${maxImg}`, 'info', true), ' ', badge(`PDFs ${pdfs.length}/${maxPdf}`, 'teal', true), locked ? ' ' : null, locked ? badge('Locked - finalized', 'success', true) : null);
    let urls = {};
    if (rows.length) { const { data } = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600); (data || []).forEach((u) => { if (u.signedUrl) urls[u.path] = u.signedUrl; }); }
    const del = (r) => (can ? iconBtn('trash', 'Delete for ever', act(() => remove(r))) : null);
    const thumbs = imgs.map((r) => h('div', { style: { position: 'relative', width: '110px' } },
      h('a', { href: urls[r.path] || '#', target: '_blank', rel: 'noopener', title: r.file_name }, h('img', { src: urls[r.path] || '', alt: r.file_name, style: { width: '110px', height: '110px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2, #eee)' } })),
      h('div', { style: { position: 'absolute', top: '2px', right: '2px' } }, del(r)), h('div', { class: 'small muted', style: { marginTop: '2px' } }, fmtSize(r.size_bytes))));
    const files = pdfs.map((r) => h('div', { class: 'row between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } },
      h('a', { href: urls[r.path] || '#', target: '_blank', rel: 'noopener', class: 'row', style: { gap: '8px', textDecoration: 'none', color: 'inherit' } }, icon('file'), h('div', null, h('div', { class: 'bold' }, r.file_name), h('div', { class: 'small muted' }, `${fmtSize(r.size_bytes)} · ${fmtDateTime(r.created_at)}`))), del(r)));
    body.replaceChildren(
      !rows.length ? h('div', { class: 'small muted', style: { padding: '4px 0' } }, can ? 'No attachments yet. Photos and PDFs are optional - add them for reference.' : 'No attachments.') : null,
      thumbs.length ? h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', marginBottom: '10px' } }, thumbs) : null, files.length ? h('div', null, files) : null);
  }
  async function remove(r) {
    if (!(await confirmBox({ title: 'Delete this file?', message: `${r.file_name} is deleted for ever. The audit log keeps a note that it was deleted.`, tone: 'danger', confirmText: 'Delete' }))) return;
    const path = await rpc('attach_delete', { p_id: r.id });
    await sb.storage.from(BUCKET).remove([path || r.path]);
    toast('File deleted', 'warn'); await load();
  }
  async function addFiles(files, type) {
    let ok = 0; const errs = [];
    for (const f of files) {
      try {
        const have = rows.filter((r) => r.att_type === type).length; if (have >= (type === 'image' ? maxImg : maxPdf)) throw new Error(`Limit of ${type === 'image' ? maxImg + ' photos' : maxPdf + ' PDFs'} reached`);
        if (type === 'pdf' && f.size > MAX_PDF_MB * 1048576) throw new Error(`${f.name} is larger than ${MAX_PDF_MB} MB`);
        const blob = type === 'image' ? await compressImage(f) : f;
        const name = type === 'image' ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name;
        const path = `${workshopId}/${cardId}/${crypto.randomUUID()}.${type === 'image' ? 'jpg' : 'pdf'}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type === 'image' ? 'image/jpeg' : 'application/pdf', upsert: false });
        if (up.error) throw new Error(up.error.message);
        try { await rpc('attach_register', { p_kind: kind, p_card: cardId, p_type: type, p_name: name, p_path: path, p_size: blob.size }); }
        catch (e) { await sb.storage.from(BUCKET).remove([path]); throw e; }
        ok++; rows.push({ att_type: type }); // keeps the limit check right inside this loop
      } catch (e) { errs.push(e.message || String(e)); }
    }
    if (ok) toast(`${ok} file(s) added`);
    if (errs.length) toast(errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} more)` : ''), 'error');
    await load();
  }
  imgIn.onchange = act(async () => { const f = [...imgIn.files]; imgIn.value = ''; if (f.length) await addFiles(f, 'image'); });
  pdfIn.onchange = act(async () => { const f = [...pdfIn.files]; imgIn.value = ''; pdfIn.value = ''; if (f.length) await addFiles(f, 'pdf'); });
  load();
  return card({ title: h('div', { class: 'row' }, h('h3', null, 'Attachments'), count), cls: 'mb',
    actions: can ? [btn('Add photos', { cls: 'sm', icon: 'upload', onClick: () => imgIn.click() }), btn('Add PDF', { cls: 'sm', icon: 'upload', onClick: () => pdfIn.click() })] : null,
    body: h('div', null, imgIn, pdfIn, body) });
}
