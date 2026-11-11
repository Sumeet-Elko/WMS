// Supabase client + data helpers + application state/lookups
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from '../config.js';

export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const fail = (error) => { const e = new Error(error.message || 'Request failed'); e.code = error.code; e.details = error.details; throw e; };

// run a query builder and return data (throws on error)
export async function run(builder) {
  const { data, error } = await builder;
  if (error) fail(error);
  return data;
}
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) fail(error);
  return data;
}
export async function count(builder) {
  const { count: c, error } = await builder;
  if (error) fail(error);
  return c || 0;
}
// Fetch all rows (pages of 1000)
export async function fetchAll(makeQuery) {
  let from = 0; const out = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) fail(error);
    out.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}

/* ------------------------------------------------------------------ app state */
export const S = {
  user: null, profile: null, settings: {}, settingRows: [],
  workshops: [], stores: [], dropdowns: [], profiles: [], products: [], vehicles: [], employees: [],
};
export const role = () => S.profile?.role;
export const isAdmin = () => role() === 'admin';
export const isManager = () => role() === 'workshop_manager';
export const isWs = () => role() === 'workshop_manager' || role() === 'workshop_supervisor';
export const isStore = () => role() === 'store_user';
export const myWorkshopId = () => S.profile?.workshop_id || null;
export const myStoreId = () => S.profile?.store_id || null;

export const setting = (k, d) => (S.settings[k] === undefined ? d : S.settings[k]);

export async function loadMasters() {
  const [ws, st, pr, dd, set, prods, veh, emp] = await Promise.all([
    run(sb.from('workshops').select('*').order('name')),
    run(sb.from('stores').select('*').order('name')),
    run(sb.from('profiles').select('*').order('full_name')),
    run(sb.from('dropdown_options').select('*').order('sort_order').order('value')),
    run(sb.from('settings').select('*')),
    fetchAll(() => sb.from('products').select('*').order('item_code')),
    fetchAll(() => sb.from('vehicles').select('*').order('reg_no')),
    fetchAll(() => sb.from('employees').select('*').order('name')),
  ]);
  S.workshops = ws; S.stores = st; S.profiles = pr; S.dropdowns = dd; S.products = prods; S.vehicles = veh; S.employees = emp;
  S.settingRows = set; S.settings = Object.fromEntries(set.map((r) => [r.key, r.value]));
}
export async function reload(...names) {
  const map = {
    workshops: async () => (S.workshops = await run(sb.from('workshops').select('*').order('name'))),
    stores: async () => (S.stores = await run(sb.from('stores').select('*').order('name'))),
    profiles: async () => (S.profiles = await run(sb.from('profiles').select('*').order('full_name'))),
    dropdowns: async () => (S.dropdowns = await run(sb.from('dropdown_options').select('*').order('sort_order').order('value'))),
    settings: async () => { S.settingRows = await run(sb.from('settings').select('*')); S.settings = Object.fromEntries(S.settingRows.map((r) => [r.key, r.value])); },
    products: async () => (S.products = await fetchAll(() => sb.from('products').select('*').order('item_code'))),
    vehicles: async () => (S.vehicles = await fetchAll(() => sb.from('vehicles').select('*').order('reg_no'))),
    employees: async () => (S.employees = await fetchAll(() => sb.from('employees').select('*').order('name'))),
  };
  await Promise.all(names.map((n) => map[n]()));
}

/* ------------------------------------------------------------------ lookups */
const idx = (arr) => new Map(arr.map((x) => [x.id, x]));
export const wsById = (id) => S.workshops.find((x) => x.id === id);
export const storeById = (id) => S.stores.find((x) => x.id === id);
export const productById = (id) => S.products.find((x) => x.id === id);
export const vehicleById = (id) => S.vehicles.find((x) => x.id === id);
export const employeeById = (id) => S.employees.find((x) => x.id === id);
export const wsName = (id) => wsById(id)?.name || '—';
export const storeName = (id) => storeById(id)?.name || '—';
export const userName = (id) => S.profiles.find((x) => x.id === id)?.full_name || '—';
export const myWorkshop = () => wsById(myWorkshopId());
export const myStore = () => storeById(myStoreId());
export const dropdown = (category, activeOnly = true) => S.dropdowns.filter((d) => d.category === category && (!activeOnly || d.active)).map((d) => d.value);
export const productLabel = (p) => (p ? `${p.item_code} · ${p.description}` : '—');
export const vehicleLabel = (v) => (v ? `${v.reg_no}${v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}` : '—');
export { idx };

// Option builders for selectBox
export const productOptions = (activeOnly = true) => S.products.filter((p) => !activeOnly || p.status === 'active')
  .map((p) => ({ value: p.id, label: `${p.item_code} · ${p.description}`, sub: [p.brand, p.spare_type, p.part_no].filter(Boolean).join(' · '), search: `${p.part_no || ''} ${p.model_ref || ''} ${p.category || ''}` }));
export const vehicleOptions = (activeOnly = true) => S.vehicles.filter((v) => !activeOnly || v.active)
  .map((v) => ({ value: v.id, label: v.reg_no, sub: [v.fleet_no, v.vehicle_type, v.make, v.model].filter(Boolean).join(' · '), search: `${v.chassis_no || ''} ${v.engine_no || ''}` }));
export const workshopOptions = (activeOnly = true) => S.workshops.filter((w) => !activeOnly || w.active).map((w) => ({ value: w.id, label: w.name, sub: w.code }));
export const storeOptions = (activeOnly = true) => S.stores.filter((w) => !activeOnly || w.active).map((w) => ({ value: w.id, label: w.name, sub: w.code }));

/* ------------------------------------------------------------------ locks */
const held = new Map(); let beat = null;
export async function lockDoc(type, id) {
  const r = await rpc('lock_acquire', { p_type: type, p_id: id });
  if (r.ok) {
    held.set(`${type}:${id}`, { type, id });
    if (!beat) beat = setInterval(() => held.forEach((l) => rpc('lock_acquire', { p_type: l.type, p_id: l.id }).catch(() => {})), 30000);
  }
  return r;
}
export async function unlockDoc(type, id) {
  held.delete(`${type}:${id}`);
  if (!held.size && beat) { clearInterval(beat); beat = null; }
  try { await rpc('lock_release', { p_type: type, p_id: id }); } catch { /* ignore */ }
}
export async function unlockAll() {
  held.clear(); if (beat) { clearInterval(beat); beat = null; }
  try { await rpc('lock_release_all'); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ pending counts (nav badges / bell) */
export async function pendingCounts() {
  const c = (t, f) => count(f(sb.from(t).select('id', { count: 'exact', head: true })));
  const r = role(); const out = {};
  if (r === 'workshop_manager' || r === 'workshop_supervisor') {
    const [jd, jo, mr, dc, rq, cd, ca] = await Promise.all([
      c('job_cards', (q) => q.eq('status', 'draft')),
      c('job_cards', (q) => q.eq('status', 'completed')),
      c('mrfs', (q) => q.eq('status', 'returned')),
      c('delivery_challans', (q) => q.eq('status', 'issued')),
      c('return_queue', (q) => q.eq('status', 'queued')),
      c('consumable_jcs', (q) => q.eq('status', 'draft')),
      c('consumable_jcs', (q) => q.eq('status', 'completed')),
    ]);
    Object.assign(out, { cjcDrafts: cd, cjcApproval: r === 'workshop_manager' ? ca : 0, jcDrafts: jd, jcApproval: r === 'workshop_manager' ? jo : 0, mrfReturned: mr, receipts: dc, queue: rq });
  } else if (r === 'store_user') {
    const [m, d, rd] = await Promise.all([
      c('mrfs', (q) => q.eq('status', 'sent')),
      c('delivery_challans', (q) => q.eq('status', 'draft')),
      c('return_dcs', (q) => q.eq('status', 'sent')),
    ]);
    Object.assign(out, { mrfInbox: m, dcDrafts: d, rdcInbox: rd });
  }
  return out;
}

/* ------------------------------------------------------------------ auth */
export async function adminFn(payload) {
  const { data, error } = await sb.functions.invoke(CONFIG.ADMIN_FUNCTION, { body: payload });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
