import { sb, watch } from '../db.js';
import { esc, badge, fmtDate, toast, confirmTwoStep } from '../ui.js';

const shortDevice = (d = '') => {
  const os = /Windows/.test(d) ? 'Windows' : /Android/.test(d) ? 'Android' : /iPhone|iPad/.test(d) ? 'iOS' : /Mac/.test(d) ? 'Mac' : /Linux/.test(d) ? 'Linux' : 'Unknown';
  const br = /Edg\//.test(d) ? 'Edge' : /Chrome\//.test(d) ? 'Chrome' : /Firefox\//.test(d) ? 'Firefox' : /Safari\//.test(d) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
};

export async function render(root) {
  root.innerHTML = `<div class="head"><h2>Live Sessions</h2>
    <label class="chk"><input type="checkbox" id="onlyActive" checked> Show active only</label></div>
    <p class="muted">Updates live. “Idle” means no heartbeat for a few minutes (browser probably closed).</p>
    <div class="tablewrap"><table id="t"></table></div>`;
  const only = root.querySelector('#onlyActive');

  async function load() {
    await sb.rpc('sweep_sessions');
    let q = sb.from('user_sessions')
      .select('*, profiles(full_name,role), locations(code)').order('started_at', { ascending: false }).limit(150);
    if (only.checked) q = q.eq('status', 'active');
    const { data, error } = await q;
    if (error) return toast(error.message, 'error');
    root.querySelector('#t').innerHTML =
      '<tr><th>User</th><th>Location</th><th>Device</th><th>Signed in</th><th>Last seen</th><th>Status</th><th>Reason ended</th><th></th></tr>' +
      (data.map((s) => {
        const stale = s.status === 'active' && Date.now() - new Date(s.last_seen) > 3 * 60000;
        return `<tr><td>${esc(s.profiles?.full_name)}</td><td>${esc(s.locations?.code || '—')}</td>
          <td>${esc(shortDevice(s.device))}</td><td>${fmtDate(s.started_at)}</td><td>${fmtDate(s.last_seen)}</td>
          <td>${stale ? badge('Idle', 'stale') : badge(s.status, s.status)}</td><td>${esc(s.end_reason || '')}</td>
          <td class="acts">${s.status === 'active' ? `<button class="link danger-t" data-kick="${s.id}">Force logout</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="8" class="muted">No sessions to show.</td></tr>');
  }

  only.onchange = load;
  root.onclick = async (e) => {
    const id = e.target.dataset.kick;
    if (!id) return;
    if (!(await confirmTwoStep({ title: 'Force logout this session?', message: 'The user is signed out immediately.' }))) return;
    const { error } = await sb.rpc('admin_revoke_session', { p_session: id });
    error ? toast(error.message, 'error') : toast('Session ended', 'ok');
  };
  await load();
  watch('user_sessions', load);
}
