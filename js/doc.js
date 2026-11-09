// Shared workflow helpers for Job Cards, MRFs and Delivery Challans:
// status buttons, two-step confirmation, Reversal Token panel, printing.
import { sb, isolatedClient } from './db.js';
import { getState } from './auth.js';
import { toLoginEmail } from './config.js';
import { esc, badge, fmtDate, toast, confirmTwoStep, openForm } from './ui.js';

const HEADS = ['stores_head', 'workshop_head'];
const me = () => getState().profile;
export const atLoc = (loc) => !!loc && me().location_id === loc;
export const isHeadOf = (loc) => HEADS.includes(me().role) && atLoc(loc);
export const isWorkshopUser = () => me().locations?.type === 'workshop';
export const isStoreUser = () => me().locations?.type === 'store';
export const inScope = (...ids) => !getState().scope || ids.includes(getState().scope);
export const fail = (error) => toast(error.message || String(error), 'error');

export const STATUS_FLOW = ['draft', 'pending_verification', 'confirmed', 'approved', 'closed'];

// What buttons may this person press on this document right now?
export function nextActions(status, origin, authority) {
  const out = [];
  if (status === 'draft' && atLoc(origin)) out.push({ to: 'pending_verification', label: 'Submit for verification', kw: 'SUBMIT' });
  if (status === 'pending_verification' && isHeadOf(authority)) {
    out.push({ to: 'confirmed', label: 'Confirm', kw: 'CONFIRM' });
    out.push({ to: 'rejected', label: 'Reject', kw: 'REJECT', danger: true });
  }
  if (status === 'confirmed' && isHeadOf(authority)) out.push({ to: 'approved', label: 'Approve', kw: 'APPROVE' });
  if (status === 'approved' && isHeadOf(authority)) out.push({ to: 'closed', label: 'Close document', kw: 'CLOSE' });
  return out;
}

export function progressBar(status) {
  if (status === 'rejected') return `<div class="flow"><span class="on bad">Rejected</span></div>`;
  const idx = STATUS_FLOW.indexOf(status);
  return `<div class="flow">${STATUS_FLOW.map((s, i) =>
    `<span class="${i < idx ? 'done' : i === idx ? 'on' : ''}">${s.replace('_', ' ')}</span>`).join('')}</div>`;
}

export async function advance(table, id, act) {
  const warn = act.to === 'pending_verification'
    ? 'After submission this document becomes <b>read-only (frozen)</b>. Any later change needs a Reversal Token authorised by the Head.'
    : act.to === 'rejected' ? 'The document will be rejected and cannot continue.'
    : `This moves the document to <b>${act.to.replace('_', ' ')}</b> and keeps it frozen.`;
  if (!(await confirmTwoStep({ title: act.label + '?', message: warn, keyword: act.kw }))) return false;
  const { error } = await sb.rpc('advance_doc', { p_table: table, p_id: id, p_to: act.to });
  if (error) { fail(error); return false; }
  toast('Done', 'ok');
  return true;
}

// ---------------------------------------------------------------------
// Reversal Token panel.  Returns { html, editable, bind(root, reload) }
// ---------------------------------------------------------------------
export async function tokenState(table, row, origin, authority) {
  await sb.rpc('expire_tokens');
  const { data } = await sb.from('reversal_tokens').select('*').eq('doc_table', table).eq('doc_id', row.id)
    .in('status', ['pending', 'authorized']).order('requested_at', { ascending: false }).limit(1);
  const tok = data?.[0] || null;
  const mine = tok && tok.requested_by === me().id;
  const live = tok && tok.status === 'authorized' && new Date(tok.expires_at) > new Date();
  const editable = (row.status === 'draft' && atLoc(origin)) || (live && mine);

  let html = '';
  const canRaise = row.status !== 'draft' && row.status !== 'rejected' && (atLoc(origin) || atLoc(authority));
  if (!tok && canRaise) {
    html = `<div class="notice">🔒 This document is frozen. <button class="btn ghost" data-act="raise">Raise Reversal Token</button></div>`;
  } else if (tok && tok.status === 'pending') {
    html = `<div class="notice amber">🔑 Token <b>${esc(tok.token_code)}</b> is waiting for the Head's authorisation.
      <small>Reason: ${esc(tok.reason)}</small>
      ${isHeadOf(tok.authority_location_id) ? `<button class="btn" data-act="auth" data-id="${tok.id}">Authorise</button>
        <button class="btn ghost" data-act="rej" data-id="${tok.id}">Reject</button>` : ''}</div>`;
  } else if (live) {
    html = `<div class="notice blue">🔓 Token <b>${esc(tok.token_code)}</b> authorised. Fields are unlocked until <b>${fmtDate(tok.expires_at)}</b>.
      ${mine ? `<button class="btn" data-act="finish" data-id="${tok.id}">Finish correction &amp; re-freeze</button>`
             : '<small>Only the person who raised the token can edit.</small>'}</div>`;
  } else if (row.status === 'draft') {
    html = '';
  } else {
    html = '<div class="notice">🔒 Frozen.</div>';
  }

  async function bind(root, reload) {
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const a = b.dataset.act;
        if (a === 'raise') {
          const v = await openForm({ title: 'Raise Reversal Token', submitText: 'Raise token', fields: [
            { name: 'reason', label: 'Why does this document need correcting?', type: 'textarea', required: true } ] });
          if (!v) return;
          const { error } = await sb.rpc('raise_token', { p_table: table, p_id: row.id, p_reason: v.reason });
          error ? fail(error) : (toast('Token raised. Ask the Head to authorise it.', 'ok'), reload());
        }
        if (a === 'auth') { if (await authoriseWithCredentials(b.dataset.id)) reload(); }
        if (a === 'rej') {
          const { error } = await sb.rpc('reject_token', { p_token: b.dataset.id });
          error ? fail(error) : (toast('Token rejected', 'ok'), reload());
        }
        if (a === 'finish') {
          if (!(await confirmTwoStep({ title: 'Finish correction?', message: 'The token expires immediately and the document is frozen again.', keyword: 'SUBMIT' }))) return;
          const { error } = await sb.rpc('consume_token', { p_token: b.dataset.id });
          error ? fail(error) : (toast('Document re-frozen', 'ok'), reload());
        }
      };
    });
  }
  return { html, editable, token: tok, bind };
}

// Dual key: the Head types their own credentials. A separate sign-in is used so
// the current user's session is not disturbed.
export async function authoriseWithCredentials(tokenId) {
  const v = await openForm({ title: 'Head authorisation', submitText: 'Authorise', fields: [
    { name: 'userid', label: 'Head User ID', required: true, value: HEADS.includes(me().role) ? me().login_id || '' : '' },
    { name: 'password', label: 'Head password', type: 'password', required: true },
  ] });
  if (!v) return false;
  const c = isolatedClient();
  const { error: e1 } = await c.auth.signInWithPassword({ email: toLoginEmail(v.userid), password: v.password });
  if (e1) { toast('Wrong User ID or password', 'error'); return false; }
  const { error } = await c.rpc('authorize_token', { p_token: tokenId });
  await c.auth.signOut();
  if (error) { fail(error); return false; }
  toast('Token authorised. Fields are unlocked for 30 minutes.', 'ok');
  return true;
}

// ---------------------------------------------------------------------
// Printing: built live in the browser, never stored on the server
// ---------------------------------------------------------------------
export function printDoc(title, bodyHtml) {
  const a = document.getElementById('printArea');
  a.innerHTML = `<div class="pdoc"><h1>${esc(title)}</h1>${bodyHtml}
    <p class="pfoot">Reference copy generated ${fmtDate(new Date())} by ${esc(me().full_name)}</p></div>`;
  setTimeout(() => window.print(), 60);
}
export const printKV = (pairs) => `<table class="pkv">${pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v ?? '—')}</td></tr>`).join('')}</table>`;
export const printTable = (heads, rows) =>
  `<table class="ptab"><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</table>`;

export const statusBadge = (s) => badge(s);
