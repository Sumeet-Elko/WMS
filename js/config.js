// =====================================================================
//  STEP: paste YOUR two values from Supabase
//  Dashboard > Project Settings > API
//    - "Project URL"            -> SUPABASE_URL
//    - "anon public" key        -> SUPABASE_ANON_KEY   (safe to put here)
//  NEVER paste the "service_role" key anywhere in this project.
// =====================================================================
export const SUPABASE_URL = 'https://mltkajgzhlffxudkkyam.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdGthamd6aGxmZnh1ZGtreWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMDI1OTksImV4cCI6MjEwOTc3ODU5OX0.syHn3wuE4h3m8-phgQeli43N7hpi-KamQ4xOBDJYir0';

// Users do not need real email addresses. Behind the scenes a login ID such as
// "ramesh01" becomes "ramesh01@<ID_DOMAIN>". No email is ever sent. Do NOT change
// this after users are created.
export const ID_DOMAIN = 'sus-erp.app';
export const toLoginEmail = (id) => `${String(id).trim().toLowerCase()}@${ID_DOMAIN}`;
export const validLoginId = (id) => /^[a-z0-9._-]{3,30}$/i.test(String(id).trim());

export const isConfigured = () =>
  !SUPABASE_URL.startsWith('PASTE') && !SUPABASE_ANON_KEY.startsWith('PASTE');
