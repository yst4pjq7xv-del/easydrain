import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

// Sales people sign in with a username. Supabase needs an email, so the app
// adds this ending behind the scenes. It must match api/users.js.
export const LOGIN_DOMAIN = 'tradein.local';
export const toEmail = (login) => {
  const v = String(login || '').trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`;
};

// Calls the server endpoint that manages users (admin only).
export async function callUsers(action, payload) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res;
  try {
    res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    return { error: 'network' };
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) return { error: (json && json.error) || 'server_error' };
  return json || { ok: true };
}
