// Notifications: bell list + live toast + sound.
// ---------------------------------------------------------------------------
//  CHANGE THE SOUND HERE:  put your own file in  assets/sounds/  and write its name below.
//  (mp3, wav, ogg and m4a all work.  Keep it short - 1 to 3 seconds.)
// ---------------------------------------------------------------------------
const NOTIFY_SOUND = 'assets/sounds/notify.wav';

import { sb, S } from './api.js';
import { h, icon, toast } from './ui.js';
import { fmtDateTime } from './format.js';

let items = []; let channel = null; let audio = null; let unlocked = false; let onChange = () => {};
const MUTE_KEY = 'wms.notify.mute';
export const isMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };
export const setMuted = (v) => { try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
export const unreadCount = () => items.filter((n) => !n.read_at).length;

function getAudio() { if (!audio) { audio = new Audio(NOTIFY_SOUND); audio.preload = 'auto'; } return audio; }

// Phones / browsers only allow sound after the user has touched the page once.
function unlockOnFirstTouch() {
  const go = () => { unlocked = true; const a = getAudio(); a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); ['pointerdown', 'keydown'].forEach((e) => window.removeEventListener(e, go)); };
  ['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, go, { once: true }));
}

export function playSound(force = false) {
  if (isMuted() && !force) return;
  try { const a = getAudio(); a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => { if (!unlocked) toast('Tap anywhere on the screen once to enable the notification sound', 'info', 6000); }); } catch { /* ignore */ }
  try { navigator.vibrate?.(200); } catch { /* ignore */ }
}

export async function startNotify(changed) {
  onChange = changed || (() => {}); stopNotify(); items = []; if (!S.profile || S.profile.role === 'viewer') return;
  unlockOnFirstTouch();
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
  items = data || []; onChange();
  channel = sb.channel('wms-notify-' + S.profile.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${S.profile.id}` }, (p) => {
      const n = p.new; if (!n || items.some((x) => x.id === n.id)) return;
      items.unshift(n); onChange(); playSound(); toast(`${n.title}${n.body ? ' - ' + n.body : ''}`, 'info', 6000);
    }).subscribe();
}
export function stopNotify() { if (channel) { sb.removeChannel(channel); channel = null; } }
// re-read the list (used when realtime missed something, e.g. phone was asleep)
export async function reloadNotify() { if (!S.profile || S.profile.role === 'viewer') return; const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(40); if (data) { items = data; onChange(); } }

async function markRead(n) { if (n.read_at) return; n.read_at = new Date().toISOString(); onChange(); try { await sb.rpc('notif_mark_read', { p_id: n.id }); } catch { /* ignore */ } }
async function markAll() { items.forEach((n) => { if (!n.read_at) n.read_at = new Date().toISOString(); }); onChange(); try { await sb.rpc('notif_mark_all_read'); } catch { /* ignore */ } }

// the block shown at the top of the bell pop-up
export function notificationsBlock(close) {
  if (S.profile?.role === 'viewer') return null;
  const label = () => (isMuted() ? 'Sound off' : 'Sound on');
  const mute = h('button', { class: 'btn ghost sm', title: 'Switch the notification sound on / off', onClick: () => { setMuted(!isMuted()); mute.textContent = label(); if (!isMuted()) playSound(true); } }, label());
  const all = h('button', { class: 'btn ghost sm', onClick: () => { markAll(); close?.(); } }, 'Mark all read');
  const rows = items.slice(0, 15).map((n) => h('a', { class: 'item', style: { alignItems: 'flex-start', background: n.read_at ? '' : 'rgba(31,99,184,.08)' }, href: n.link ? '#' + n.link : '#', onClick: (e) => { if (!n.link) e.preventDefault(); markRead(n); close?.(); } },
    h('span', { class: 'grow' }, h('div', { class: n.read_at ? '' : 'bold' }, n.title), n.body ? h('div', { class: 'small muted' }, n.body) : null, h('div', { class: 'small muted' }, fmtDateTime(n.created_at)))));
  return h('div', null, h('div', { class: 'head row', style: { justifyContent: 'space-between' } }, h('b', null, `Notifications${unreadCount() ? ` (${unreadCount()} new)` : ''}`), h('div', { class: 'row' }, mute, unreadCount() ? all : null)),
    rows.length ? h('div', { style: { maxHeight: '320px', overflowY: 'auto' } }, rows) : h('div', { class: 'muted', style: { padding: '14px', textAlign: 'center' } }, 'No notifications yet'));
}
