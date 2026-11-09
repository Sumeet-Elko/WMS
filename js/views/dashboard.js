import { sb, watch } from '../db.js';
import { esc, fmtDate } from '../ui.js';

const count = async (table, filter) => {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: c } = await q;
  return c ?? 0;
};

export async function render(root) {
  root.innerHTML = `<h2>Dashboard</h2><div class="cards" id="cards"></div>
    <h3>Latest activity</h3><div class="tablewrap"><table id="recent"></table></div>`;

  async function load() {
    await sb.rpc('sweep_sessions');
    const [live, users, activeUsers, locs, veh, emp, prod] = await Promise.all([
      count('user_sessions', (q) => q.eq('status', 'active')),
      count('profiles'), count('profiles', (q) => q.eq('is_active', true)),
      count('locations', (q) => q.eq('is_active', true)),
      count('vehicles', (q) => q.eq('is_active', true)),
      count('employees', (q) => q.eq('is_active', true)),
      count('products', (q) => q.eq('is_active', true)),
    ]);
    const card = (n, label, kind) => `<div class="card ${kind}"><b>${n}</b><span>${label}</span></div>`;
    root.querySelector('#cards').innerHTML =
      card(live, 'Users online now', 'green') + card(`${activeUsers}/${users}`, 'Active / total users', 'blue') +
      card(locs, 'Active locations', 'blue') + card(veh, 'Active vehicles', 'slate') +
      card(emp, 'Active employees', 'slate') + card(prod, 'Active spares / products', 'slate');

    const { data } = await sb.from('audit_log')
      .select('*, operator:profiles!operator_id(full_name)').order('at', { ascending: false }).limit(10);
    root.querySelector('#recent').innerHTML =
      '<tr><th>When</th><th>Who</th><th>Action</th><th>Table</th></tr>' +
      (data || []).map((r) => `<tr><td>${fmtDate(r.at)}</td><td>${esc(r.operator?.full_name || 'System')}</td>
        <td>${esc(r.action)}</td><td>${esc(r.table_name)}</td></tr>`).join('') ||
      '<tr><td colspan="4" class="muted">Nothing yet</td></tr>';
  }
  await load();
  watch('user_sessions', load);
  watch('audit_log', load);
}
