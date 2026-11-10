// Inactivity logout (admin configurable), idle form auto-save, activity tracking
import { sb, setting, unlockAll } from './api.js';
import { currentView, navigate, leaveCurrent } from './router.js';
import { modal, h, toast, closeAllModals } from './ui.js';

let last = Date.now(); let timer = null; let warned = null; let onLogout = () => {}; let idleSaved = false;
const EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
const bump = () => { last = Date.now(); idleSaved = false; };

export function startSession(logoutCb) {
  onLogout = logoutCb; last = Date.now();
  EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));
  clearInterval(timer); timer = setInterval(tick, 5000);
}
export function stopSession() {
  EVENTS.forEach((e) => window.removeEventListener(e, bump));
  clearInterval(timer); timer = null; warned?.close(); warned = null;
}

async function tick() {
  const idleMs = Date.now() - last;
  const logoutMs = Number(setting('session_timeout_min', 30)) * 60000;
  const draftMs = Number(setting('idle_draft_min', 5)) * 60000;

  // 1. idle form -> save as draft and go back to the menu
  const v = currentView();
  if (v && v.isForm && !idleSaved && idleMs >= draftMs) {
    idleSaved = true;
    try {
      closeAllModals();
      await leaveCurrent();            // flush() saves the draft, destroy() releases the lock
      toast('You were idle for a while - your entry was saved as a draft.', 'info', 6000);
      navigate('/dashboard');
    } catch (e) { console.warn(e); }
  }

  // 2. session timeout
  if (idleMs >= logoutMs) { await doLogout('You were signed out after a period of inactivity.'); return; }
  if (logoutMs - idleMs <= 60000 && !warned) {
    let left = Math.ceil((logoutMs - idleMs) / 1000);
    const msg = h('b', null, `${left}s`);
    const m = modal({ title: 'Still there?', dismissable: false, content: h('div', null, 'For security you will be signed out in ', msg, ' because of inactivity.'),
      foot: [h('button', { class: 'btn', onClick: () => doLogout() }, 'Sign out now'), h('button', { class: 'btn primary', onClick: () => { bump(); m.close(); warned = null; } }, 'Stay signed in')] });
    warned = m;
    const c = setInterval(() => { left--; msg.textContent = `${Math.max(0, left)}s`; if (!warned || left <= 0) clearInterval(c); }, 1000);
  }
}

export async function doLogout(message) {
  stopSession();
  try { await leaveCurrent(); } catch { /* ignore */ }
  await unlockAll();
  await sb.auth.signOut();
  onLogout(message);
}
