import { sb, watch } from '../db.js';
import { getState } from '../auth.js';
import { esc, badge } from '../ui.js';
import { nextActions, inScope } from '../doc.js';

export async function render(root) {
  const p = getState().profile;
  const isAdmin = p.role === 'admin';
  root.innerHTML = `<h2>${isAdmin ? 'Operations health' : 'Dashboard'}</h2>
    <p class="muted">${isAdmin ? 'Use the location selector at the top to inspect one store or workshop.' : `${esc(p.locations?.code)} · ${esc(p.locations?.name)} — you see only your own location.`}</p>
    <div class="cards" id="cards"></div><h3>Waiting for your action</h3><div id="mine"></div>`;

  async function load() {
    const [jc, mrf, dc, di, tk] = await Promise.all([
      sb.from('job_cards').select('id,doc_no,status,location_id').limit(2000),
      sb.from('mrfs').select('id,doc_no,status,workshop_id,store_id').limit(2000),
      sb.from('delivery_challans').select('id,doc_no,status,store_id,workshop_id').limit(2000),
      sb.from('dc_items').select('id,line_status,dc:delivery_challans(store_id,workshop_id)').eq('line_status', 'mismatch'),
      sb.from('reversal_tokens').select('id,status,origin_location_id,authority_location_id').eq('status', 'pending'),
    ]);
    const J = (jc.data || []).filter((r) => inScope(r.location_id));
    const M = (mrf.data || []).filter((r) => inScope(r.workshop_id, r.store_id));
    const D = (dc.data || []).filter((r) => inScope(r.store_id, r.workshop_id));
    const X = (di.data || []).filter((r) => inScope(r.dc?.store_id, r.dc?.workshop_id));
    const T = (tk.data || []).filter((r) => inScope(r.origin_location_id, r.authority_location_id));
    const card = (n, l, k) => `<div class="card ${k}"><b>${n}</b><span>${l}</span></div>`;
    root.querySelector('#cards').innerHTML =
      card(J.filter((r) => !['closed', 'rejected'].includes(r.status)).length, 'Open Job Cards', 'blue') +
      card(M.filter((r) => ['pending_verification', 'confirmed', 'approved'].includes(r.status)).length, 'Pending Stores Requests', 'amber') +
      card(X.length, 'Active Discrepancy Returns', 'red') +
      card(D.filter((r) => ['draft', 'pending_verification', 'confirmed'].includes(r.status)).length, 'Challans in progress', 'slate') +
      card(T.length, 'Reversal Tokens pending', 'amber');

    // things I can act on right now
    const todo = [];
    J.forEach((r) => nextActions(r.status, r.location_id, r.location_id).forEach((a) => todo.push(['jobcards', r, 'Job Card', a.label])));
    M.forEach((r) => nextActions(r.status, r.workshop_id, r.store_id).forEach((a) => todo.push(['mrfs', r, 'MRF', a.label])));
    D.forEach((r) => nextActions(r.status, r.store_id, r.store_id).forEach((a) => todo.push(['dcs', r, 'Challan', a.label])));
    const seen = new Set();
    const rows = todo.filter(([, r]) => (seen.has(r.id) ? false : seen.add(r.id)));
    root.querySelector('#mine').innerHTML = isAdmin ? '<p class="muted">Administrators do not approve operational documents.</p>' :
      rows.length ? `<div class="deck">${rows.map(([route, r, label, act]) => `<a class="dcard s-${r.status}" href="#/${route}/${r.id}">
        <div class="top"><b>${esc(r.doc_no)}</b>${badge(r.status)}</div><div class="big">${esc(label)}</div><small>Next: ${esc(act)}</small></a>`).join('')}</div>`
      : '<p class="muted">Nothing waiting for you. 🎉</p>';
  }
  await load();
  ['job_cards', 'mrfs', 'delivery_challans', 'dc_items', 'reversal_tokens'].forEach((t) => watch(t, load));
}
