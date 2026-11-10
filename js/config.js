// ---------------------------------------------------------------
//  WMS configuration
//  Put your Supabase project values here (Project Settings > API).
//  The anon key is PUBLIC by design - security is enforced by the
//  Row Level Security rules in /supabase/03_security.sql.
// ---------------------------------------------------------------
export const CONFIG = {
  SUPABASE_URL: 'https://mltkajgzhlffxudkkyam.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sdGthamd6aGxmZnh1ZGtreWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMDI1OTksImV4cCI6MjEwOTc3ODU5OX0.syHn3wuE4h3m8-phgQeli43N7hpi-KamQ4xOBDJYir0',
  APP_NAME: 'WMS',
  APP_FULL_NAME: 'Workshop Management System',
  // Name of the edge function used by the admin to create / manage logins
  ADMIN_FUNCTION: 'admin-users',
};

export const isConfigured = () =>
  CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') &&
  CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR-SUPABASE');
