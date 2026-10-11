// Server endpoint for user management. Runs on Vercel, not in the browser.
// Only a signed-in trade-in admin can call it. It uses the Supabase service_role key,
// which must stay on the server.
//
// The Supabase project is shared with other tools, so this file only reads and writes
// the tradein_ tables. It creates new logins, or gives an existing login access to this
// tool. It never deletes a login and never changes the password of a login that
// belongs to another tool.
import { createClient } from '@supabase/supabase-js';

const LOGIN_DOMAIN = 'tradein.local';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const fail = (res, status, error) => res.status(status).json({ error });
const ownLogin = (username) => !String(username || '').includes('@');

function checkRoleAndCities(role, cityIds) {
  if (role !== 'sales' && role !== 'manager') return 'bad_role';
  if (!Array.isArray(cityIds) || cityIds.length === 0) return 'need_city';
  if (role === 'sales' && cityIds.length > 1) return 'sales_one_city';
  return null;
}

async function setCities(db, userId, cityIds) {
  const del = await db.from('tradein_user_cities').delete().eq('user_id', userId);
  if (del.error) throw del.error;
  if (cityIds.length) {
    const ins = await db.from('tradein_user_cities').insert(cityIds.map((city_id) => ({ user_id: userId, city_id })));
    if (ins.error) throw ins.error;
  }
}

async function findLogin(db, email) {
  const found = await db.rpc('tradein_find_user', { p_email: email });
  if (found.error) throw found.error;
  return found.data || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');
  if (!url || !serviceKey) return fail(res, 500, 'server_not_configured');

  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'not_signed_in');
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return fail(res, 401, 'not_signed_in');
  const { data: me } = await db.from('tradein_profiles').select('role').eq('id', who.user.id).maybeSingle();
  if (!me || me.role !== 'admin') return fail(res, 403, 'not_admin');

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return fail(res, 400, 'bad_request'); }
  }
  const { action } = body;

  try {
    if (action === 'create') {
      const login = String(body.username || '').trim().toLowerCase();
      const fullName = String(body.full_name || '').trim().slice(0, 80);
      const password = String(body.password || '');
      const cityIds = body.city_ids || [];
      if (!fullName) return fail(res, 400, 'need_name');
      const bad = checkRoleAndCities(body.role, cityIds);
      if (bad) return fail(res, 400, bad);

      let id;
      let linked = false;

      if (login.includes('@')) {
        // An email: this person already has a login in this Supabase project.
        // Give that login access to the trade-in tool. The password is not changed.
        id = await findLogin(db, login);
        if (!id) return fail(res, 400, 'email_not_found');
        linked = true;
      } else {
        // A username: make a new login for this person.
        if (!/^[a-z0-9._-]{3,30}$/.test(login)) return fail(res, 400, 'bad_username');
        if (password.length < 6) return fail(res, 400, 'bad_password');
        const taken = await db.from('tradein_profiles').select('id').eq('username', login).maybeSingle();
        if (taken.data) return fail(res, 400, 'username_taken');
        const created = await db.auth.admin.createUser({
          email: `${login}@${LOGIN_DOMAIN}`,
          password,
          email_confirm: true,
          user_metadata: { username: login, full_name: fullName },
        });
        if (created.error) {
          const msg = String(created.error.message || '');
          return fail(res, 400, /already|registered|exists/i.test(msg) ? 'username_taken' : 'create_failed');
        }
        id = created.data.user.id;
      }

      const exists = await db.from('tradein_profiles').select('id').eq('id', id).maybeSingle();
      if (exists.data) return fail(res, 400, 'already_added');
      const ins = await db.from('tradein_profiles').insert({ id, username: login, full_name: fullName, role: body.role });
      if (ins.error) throw ins.error;
      await setCities(db, id, cityIds);
      return res.status(200).json({ ok: true, id, linked });
    }

    const id = String(body.id || '');
    if (!id) return fail(res, 400, 'bad_request');
    if (id === who.user.id) return fail(res, 400, 'not_yourself');
    const target = await db.from('tradein_profiles').select('role, username').eq('id', id).maybeSingle();
    if (!target.data) return fail(res, 404, 'not_found');
    if (target.data.role === 'admin') return fail(res, 400, 'not_admin_account');

    if (action === 'update') {
      const cityIds = body.city_ids || [];
      const fullName = String(body.full_name || '').trim().slice(0, 80);
      const bad = checkRoleAndCities(body.role, cityIds);
      if (bad) return fail(res, 400, bad);
      if (!fullName) return fail(res, 400, 'need_name');
      const up = await db.from('tradein_profiles').update({ role: body.role, full_name: fullName }).eq('id', id);
      if (up.error) throw up.error;
      await setCities(db, id, cityIds);
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset_password') {
      // Only for logins made by this tool. A login from another tool keeps its password.
      if (!ownLogin(target.data.username)) return fail(res, 400, 'linked_login');
      const password = String(body.password || '');
      if (password.length < 6) return fail(res, 400, 'bad_password');
      const up = await db.auth.admin.updateUserById(id, { password });
      if (up.error) throw up.error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove_access') {
      const up = await db.from('tradein_profiles').update({ role: 'pending' }).eq('id', id);
      if (up.error) throw up.error;
      await setCities(db, id, []);
      return res.status(200).json({ ok: true });
    }

    return fail(res, 400, 'bad_request');
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'server_error');
  }
}
