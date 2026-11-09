import { sb } from '../db.js';
import { toast, confirmTwoStep } from '../ui.js';

export async function render(root) {
  const { data: s, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
  if (error) { root.innerHTML = `<p class="err">${error.message}</p>`; return; }
  root.innerHTML = `<h2>Session Control Settings</h2>
    <p class="muted">Changes apply to everyone who is logged in, right away (no re-login needed). Use 0 to switch a limit off.</p>
    <form class="panel" id="f">
      <div class="field"><label>Idle timeout (minutes)</label><input type="number" id="idle" min="0" value="${s.idle_timeout_minutes}">
        <small>Log a user out after this many minutes without mouse/keyboard activity.</small></div>
      <div class="field"><label>Maximum session length (hours)</label><input type="number" id="max" min="0" value="${s.max_session_hours}">
        <small>Force a fresh login after this many hours, however active.</small></div>
      <div class="field"><label>Heartbeat interval (seconds)</label><input type="number" id="hb" min="15" max="600" value="${s.heartbeat_seconds}">
        <small>How often each open browser reports “I am still here”. 15–600.</small></div>
      <div class="field"><label class="chk"><input type="checkbox" id="single" ${s.single_device_login ? 'checked' : ''}>
        Single device login — a new sign-in ends the user's older session</label></div>
      <div class="row-end"><button class="btn">Save settings</button></div>
    </form>`;
  root.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const v = {
      idle_timeout_minutes: +root.querySelector('#idle').value,
      max_session_hours: +root.querySelector('#max').value,
      heartbeat_seconds: +root.querySelector('#hb').value,
      single_device_login: root.querySelector('#single').checked,
    };
    if (!(await confirmTwoStep({ title: 'Change session rules?', message: 'This affects every user immediately.' }))) return;
    const { error: er } = await sb.from('app_settings').update(v).eq('id', 1);
    er ? toast(er.message, 'error') : toast('Settings saved', 'ok');
  };
}
