// Login + session control.
// How it works:
//  1. After password login we create a row in user_sessions (start_session).
//  2. Every few seconds we check: idle too long? -> log out.
//  3. Every heartbeat_seconds we call touch_session; if the server says the
//     session is no longer active (admin forced logout, logged in elsewhere,
//     account deactivated, too long) -> log out.
//  4. We also listen live to our own session row, so a force-logout by the
//     admin is felt immediately.
import { sb } from './db.js';
import { toLoginEmail } from './config.js';

const SID_KEY = 'erp_session_id';
const state = { user: null, profile: null, settings: null, sessionId: null, scope: '', lastActivity: Date.now(), lastBeat: 0 };
let tick = null, chan = null, setChan = null, onKicked = () => {};

export const getState = () => state;
export const onForcedLogout = (fn) => { onKicked = fn; };

const REASONS = {
  revoked: 'An administrator or a newer login ended your session.',
  expired: 'Your session expired. Please sign in again.',
  ended: 'Your session has ended.',
  missing: 'Your session could not be found. Please sign in again.',
};

async function loadProfileAndSettings() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data: profile, error } = await sb.from('profiles').select('*, locations(code,name,type)').eq('id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('This account has no profile yet. Ask the administrator to set it up.');
  if (!profile.is_active) throw new Error('This account is deactivated.');
  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  state.user = user; state.profile = profile; state.settings = settings;
}

async function newSession() {
  const device = navigator.userAgent.replace(/Mozilla\/5\.0 /, '');
  const { data, error } = await sb.rpc('start_session', { p_device: device });
  if (error) throw new Error(error.message);
  state.sessionId = data;
  sessionStorage.setItem(SID_KEY, data);
}

export async function login(userId, password) {
  const { error } = await sb.auth.signInWithPassword({ email: toLoginEmail(userId), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong User ID or password.' : error.message);
  try {
    await loadProfileAndSettings();
    await newSession();
  } catch (e) {
    await sb.auth.signOut();
    throw e;
  }
  startWatchers();
}

// Called when the page loads: continue an existing login if it is still valid
export async function resume() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return false;
  try {
    await loadProfileAndSettings();
    const old = sessionStorage.getItem(SID_KEY);
    let ok = false;
    if (old) {
      const { data } = await sb.rpc('touch_session', { p_session: old });
      if (data === 'active') { state.sessionId = old; ok = true; }
    }
    if (!ok) await newSession();
    startWatchers();
    return true;
  } catch (e) {
    await sb.auth.signOut();
    return false;
  }
}

export async function logout(reason = 'Logged out') {
  stopWatchers();
  if (state.sessionId) await sb.rpc('end_session', { p_session: state.sessionId, p_reason: reason }).catch(() => {});
  sessionStorage.removeItem(SID_KEY);
  await sb.auth.signOut();
  state.user = state.profile = state.sessionId = null;
}

async function kick(message) {
  stopWatchers();
  sessionStorage.removeItem(SID_KEY);
  await sb.auth.signOut().catch(() => {});
  state.user = state.profile = state.sessionId = null;
  onKicked(message);
}

function startWatchers() {
  stopWatchers();
  state.lastActivity = Date.now();
  state.lastBeat = Date.now();
  const bump = () => { state.lastActivity = Date.now(); };
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
  state._bump = bump;

  // live: my own session row
  chan = sb.channel('my-session')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_sessions', filter: `id=eq.${state.sessionId}` },
      (p) => { if (p.new.status !== 'active') kick(p.new.end_reason ? p.new.end_reason + '.' : REASONS[p.new.status]); })
    .subscribe();

  // live: settings changed by admin (applies immediately, no re-login)
  setChan = sb.channel('settings-watch')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' },
      (p) => { state.settings = p.new; })
    .subscribe();

  tick = setInterval(async () => {
    const s = state.settings || {};
    const idleMs = Date.now() - state.lastActivity;
    if (s.idle_timeout_minutes > 0 && idleMs > s.idle_timeout_minutes * 60000) {
      await sb.rpc('end_session', { p_session: state.sessionId, p_reason: 'Idle timeout' }).catch(() => {});
      return kick(`You were signed out after ${s.idle_timeout_minutes} minutes of inactivity.`);
    }
    if (Date.now() - state.lastBeat >= (s.heartbeat_seconds || 60) * 1000) {
      state.lastBeat = Date.now();
      const { data, error } = await sb.rpc('touch_session', { p_session: state.sessionId });
      if (!error && data && data !== 'active') kick(REASONS[data] || 'Your session ended.');
    }
  }, 10000);
}

function stopWatchers() {
  clearInterval(tick); tick = null;
  if (state._bump) ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((ev) => window.removeEventListener(ev, state._bump));
  if (chan) sb.removeChannel(chan);
  if (setChan) sb.removeChannel(setChan);
  chan = setChan = null;
}
