# Slatebook

Slatebook is a Vercel-ready secure customer lead notepad. The browser app is a React/Vite SPA; Supabase provides Auth, Postgres, RLS, and two small Edge Functions for privileged Auth operations.

## Local setup

1. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key. The supplied project values are already in the ignored `.env.local` file in this workspace.
2. Run `supabase/migrations/001_slatebook.sql` in the Supabase SQL editor. If this project already has the original Slatebook schema, run `supabase/migrations/003_direct_user_accounts.sql` instead of rerunning 001. If you created Auth users before running 001, also run `002_backfill_profiles.sql`.
3. Create your first administrator in Supabase Dashboard → Authentication → Users → Add user. Use the email and set a password.
4. In the SQL editor, replace the email in `supabase/bootstrap-admin.sql` and run it.
5. Deploy the two functions from the project root:

   ```bash
   supabase functions deploy create-user
   supabase functions deploy manage-user
   ```

6. Disable public sign-ups in Supabase Auth so only accounts created by an administrator can enter the workspace.
7. Sign in locally, open Team access, and choose Create account. Enter a username, password, name, and access level. Managers use the same `admin` permissions as administrators.
8. Give the new person their username and password securely. They can sign in with the username; no invitation email is needed.
9. Start the app with `npm install && npm run dev`.

## Vercel

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as Vercel environment variables and redeploy. `vercel.json` rewrites client-side routes to `index.html`.

The service-role key is used only by Supabase Edge Functions and must never be added to `.env.local`, Vercel frontend variables, or source control. Username accounts use an internal Auth email alias and therefore do not have email password-reset links; an administrator must create a replacement account/password if one is forgotten.

## Local test users

The application intentionally does not contain hardcoded credentials. Create the first administrator in Supabase Auth, then use the admin dashboard to create team-member or manager accounts. Supabase hashes all passwords, and credentials are never stored in the frontend or source control.

Slatebook uses one `Lead intake` form. Its existing basic fields remain available, only Phone is required, and administrators can add optional fields to that form. The CVV field is validated during entry but discarded before the record is saved; it is never included in searches, projections, or CSV exports.

The default form includes full card-number storage for testing, but real payment-card data should not be used until the deployment has been designed and assessed for PCI DSS compliance. Prefer test card numbers or replace the card field with a payment-provider token before production use.
