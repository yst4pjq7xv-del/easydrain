# Trade-in Slots

Live count of buyer slots left per city, for a trade-in campaign with a buyer limit.

- **Sales** see the slots left in their city, add a buyer (name and kecamatan), and can cancel their own entry.
- **Manager** sees one or more cities: slots left, buyers per kecamatan, all entries. Can cancel entries. Cannot add.
- **Admin** sets up cities, limits, kecamatan lists and users. Can do everything.

The limit is checked in the database. Two sales people cannot take the last slot at the same time.

Stack: Vite + React, Supabase, Vercel.

## Shared Supabase project

This tool lives inside an existing Supabase project (Display Project), next to other tools. No new Supabase project is needed.

- Everything this tool creates in the database starts with `tradein_`.
- The SQL file does not change any other table, trigger, setting or user in the project.
- Login accounts are shared by all tools in the project. Access is not: a login only works in this tool after the admin adds that person here.

## Setup

Do the steps in this order.

### 1. Supabase (Display Project)

1. Open Display Project > **SQL Editor**. Paste all of `supabase/schema.sql`. Run it.
2. Open `supabase/make-admin.sql`. Change `YOUR-EMAIL-HERE` to the email you log in with. Paste it into the SQL Editor and run it.
   The result must show one row with your email and the role `admin`. No row means the email was not found.

Do not change the Authentication settings. Other tools in the project depend on them.

### 2. GitHub

1. Create a new private repository.
2. Upload every file and folder from this project. Do not upload `node_modules` or `dist`.

### 3. Vercel

1. Import the repository as a new Vercel project. Vercel detects Vite. Keep the default build settings.
2. Add three environment variables. The values are in Display Project > Project Settings > API:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key. Secret. Do not add `VITE_` in front. |

3. Deploy.

### 4. First use

1. Open the Vercel link. Sign in with your email and password.
2. Go to **Pengaturan / Setup**. Add the pilot city, its limit, and the kecamatan list (one per line).
3. Add users. There are two ways:
   - **New person:** type a new username and a password. Give these to the person.
   - **Person who already has a login in Display Project:** type their email. They get access here and keep their own password.
4. Send the Vercel link to the team.

## Check before go-live

Use a test city with limit 2.

1. Sign in as a sales user on two phones. Both show 2 slots left.
2. Add a buyer on phone A. Phone B drops to 1 without a reload.
3. On both phones, fill in a different buyer and tap Add at the same moment. One succeeds. The other gets "Slot habis". The count shows 0, not -1.
4. Cancel one entry. Both phones show 1 again.
5. Sign in as the manager. The manager sees all entries and the kecamatan count, and has no Add form.
6. Open the Display Project app and check that its login still works as before.
7. Close the test city when done.

## How it works

- `supabase/schema.sql` creates four tables (`tradein_profiles`, `tradein_cities`, `tradein_user_cities`, `tradein_buyers`), the access rules, and two functions: `tradein_add_buyer` and `tradein_cancel_buyer`. The app never writes to the buyers table directly.
- `tradein_add_buyer` locks the city row, counts active buyers, and refuses the entry if the city is full, closed, or the same name is already recorded in that kecamatan.
- The screen updates through Supabase Realtime. As a backup it also refreshes every 30 seconds and when the phone returns to the page.
- `api/users.js` runs on Vercel. It creates logins, gives existing logins access, and changes passwords. Only a signed-in trade-in admin can call it.
- New sales logins use a username. Supabase needs an email, so the app adds `@tradein.local` behind the scenes. No email is ever sent.
- "Bagikan ke WhatsApp" opens WhatsApp with a ready status message. The person chooses the chat and sends it. Nothing is sent automatically.

## Shared logins: what to know

- A person with a login from another tool can open this tool and sign in. They see "Belum ada akses" and no data until the admin adds them.
- A login made here also exists for the other tools in the project. Whether it can do anything there depends on that tool's own rules.
- This tool never deletes a login. "Cabut akses" removes access to this tool only.
- This tool changes a password only for logins it made itself (usernames). A login added by email keeps the password from its own tool.
- Deleting a user in Supabase > Authentication removes that person from every tool, and fails if they have recorded buyers.

## Limits of this version

- One buyer limit per city, from 1 to 1000.
- There is one admin. To add another, run `make-admin.sql` again with that person's email.
- No export button yet. Use Supabase > Table Editor > tradein_buyers > Export to CSV.
- On the Supabase Free plan a project is paused after about a week with no activity. Resume it from the Supabase dashboard.

## If something does not work

- **"Aplikasi belum diatur"**: the two `VITE_` variables are missing in Vercel. Add them and redeploy.
- **You signed in but see "Belum ada akses"**: `make-admin.sql` did not find your email. Run it again with the exact email you log in with.
- **Adding a user fails with "Server belum diatur"**: `SUPABASE_SERVICE_ROLE_KEY` is missing in Vercel. Add it and redeploy.
- **Adding a new username fails for another reason**: Supabase may reject the `@tradein.local` ending. Change `LOGIN_DOMAIN` to a domain you own, in both `src/supabase.js` and `api/users.js`, then redeploy.
- **The count does not move on other phones until 30 seconds pass**: Realtime is not on for the tables. Run `supabase/schema.sql` again, or enable Realtime for `tradein_cities` and `tradein_buyers` in Supabase > Database > Publications.

## Adding the next tool to the same Supabase project

Give every table and function of the new tool its own prefix (for example `promo_`), the same way this tool uses `tradein_`. Do not add triggers on `auth.users`.

## Local run

```
npm install
cp .env.example .env    # fill in the values
npm run dev
```

The user management endpoint (`/api/users`) only runs on Vercel, or locally with `vercel dev`.
