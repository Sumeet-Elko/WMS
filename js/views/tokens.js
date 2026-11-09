import { sb, watch } from '../db.js';
import { getState } from '../auth.js';
import { esc, badge, fmtDate, table, toast } from '../ui.js';
import { isHeadOf, authoriseWithCredentials, inScope, fail } from '../doc.js';

const LINK = { job_cards: 'jobcards', mrfs: 'mrfs', delivery_challans: 'dcs' };

export async function render(root) {
  root.innerHTML = `<h2>Reversal Tokens</h2>
    <p class="muted">A frozen document can be corrected only through a single-use, time-bound token that the designated Head authorises with their own credentials.</p>
    <div id="t"></div>`;
  async function load() {
    await sb.rpc('expire_tokens');
    const { data, error } = await sb.from('reversal_tokens')
      .select('*, req:profiles!requested_by(full_name), auth:profiles!authorized_by(full_name), loc:locations!authority_location_id(code)')
      .order('requested_at', { ascending: false }).limit(200);
    if (error) return fail(error);
    const rows = data.filter((r) => inScope(r.origin_location_id, r.authority_location_id));
    root.querySelector('#t').innerHTML = table(['Token', 'Document', 'Reason', 'Raised', 'Head location', 'Status', ''],
      rows.map((r) => `<tr><td><b>${esc(r.token_code)}</b></td>
        <td><a class="link" href="#/${LINK[r.doc_table]}/${r.doc_id}">${esc(r.doc_no)}</a></td>
        <td class="wrap">${esc(r.reason)}</td><td>${fmtDate(r.requested_at)}<br><small>${esc(r.req?.full_name || '')}</small></td>
        <td>${esc(r.loc?.code)}</td>
        <td>${badge(r.status)}${r.status === 'authorized' ? `<br><small>until ${fmtDate(r.expires_at)}</small>` : ''}</td>
        <td class="acts">${r.status === 'pending' && isHeadOf(r.authority_location_id)
          ? `<button class="btn sm" data-a="${r.id}">Authorise</button> <button class="btn ghost sm" data-r="${r.id}">Reject</button>` : ''}</td></tr>`),
      'No tokens yet');
    root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => { if (await authoriseWithCredentials(b.dataset.a)) load(); }));
    root.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => {
      const { error: e } = await sb.rpc('reject_token', { p_token: b.dataset.r });
      e ? fail(e) : (toast('Token rejected', 'ok'), load());
    }));
  }
  await load();
  watch('reversal_tokens', load);
}
