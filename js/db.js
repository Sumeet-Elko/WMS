import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// The main connection used by the whole app
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// A second, throw-away connection used only to create new users
// without logging the admin out.
export function isolatedClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'erp-isolated' },
  });
}

// ---- live updates (real-time) for the screen currently open ----
let channels = [];
export function watch(table, callback) {
  let t;
  const debounced = () => { clearTimeout(t); t = setTimeout(callback, 400); };
  const ch = sb.channel('view-' + table + '-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table }, debounced)
    .subscribe();
  channels.push(ch);
}
export function clearWatches() {
  channels.forEach((c) => sb.removeChannel(c));
  channels = [];
}
