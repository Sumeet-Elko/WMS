// Debounced draft auto-save with a visible indicator.
//   const a = autosaver({ save: async () => {...} });   // save() must be idempotent
//   a.el -> indicator node;  a.trigger() on every change;  await a.flush() before leaving
import { h, icon } from './ui.js';
import { fmtTime } from './format.js';

export function autosaver({ save, delay = 1200 } = {}) {
  const el = h('span', { class: 'save-ind' }); let t = null; let dirty = false; let running = null; let enabled = true;
  const set = (cls, text, ic) => { el.className = `save-ind ${cls}`; el.replaceChildren(icon(ic), text); };
  set('', 'Not saved yet', 'save');
  const doSave = async () => {
    if (!enabled) return;
    if (running) { await running; }
    if (!dirty) return;
    dirty = false; set('saving', 'Saving draft...', 'refresh');
    running = (async () => { try { await save(); set('saved', `Draft saved ${fmtTime(new Date())}`, 'checkCircle'); } catch (e) { dirty = true; set('err', 'Not saved: ' + (e.message || e), 'alert'); throw e; } })();
    try { await running; } finally { running = null; }
  };
  return {
    el,
    trigger() { if (!enabled) return; dirty = true; set('', 'Unsaved changes...', 'save'); clearTimeout(t); t = setTimeout(() => doSave().catch(() => {}), delay); },
    async flush() { clearTimeout(t); await doSave(); },
    markSaved(text) { dirty = false; set('saved', text || `Saved ${fmtTime(new Date())}`, 'checkCircle'); },
    disable() { enabled = false; clearTimeout(t); el.replaceChildren(); },
    isDirty: () => dirty,
  };
}
