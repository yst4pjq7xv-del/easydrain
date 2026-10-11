-- Trade-in Slots: make yourself the admin of this tool.
-- Run this AFTER schema.sql.
--
-- 1. Change the email on the marked line to the email you already use to log in to this Supabase project's app.
--    (No login yet? Create one first: Supabase > Authentication > Users > Add user, with Auto Confirm.)
-- 2. Run it. The result must show one row with your email and role "admin".
--    No row means the email was not found. Check the spelling and run it again.
--
-- This gives admin rights in the trade-in tool only. It changes nothing in other tools.

insert into public.tradein_profiles (id, username, full_name, role)
select id, lower(email), split_part(email, '@', 1), 'admin'
  from auth.users
 where lower(email) = lower('YOUR-EMAIL-HERE')   -- <-- change this email
on conflict (id) do update set role = 'admin';

select username, role from public.tradein_profiles where role = 'admin';
