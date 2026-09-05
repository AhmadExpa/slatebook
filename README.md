# Slatebook

Slatebook is a Vercel-ready secure customer lead notepad. The browser app is a React/Vite SPA; Supabase provides Auth, Postgres, RLS, and two small Edge Functions for privileged Auth operations.

## Local setup

1. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key. The supplied project values are already in the ignored `.env.local` file in this workspace.
2. Run `supabase/migrations/001_slatebook.sql` in the Supabase SQL editor. If you created Auth users before running it, also run `supabase/migrations/002_backfill_profiles.sql`.
3. Create your first admin in Supabase Dashboard → Authentication → Users → Add user. Use the email as the username and set a password.
4. In the SQL editor, replace the email in `supabase/bootstrap-admin.sql` and run it.
5. Deploy the two functions from the project root:

   ```bash
   supabase functions deploy invite-user
   supabase functions deploy manage-user
   ```

6. Configure Supabase Auth email templates/SMTP for invitations and password reset.
7. Disable public sign-ups in Supabase Auth so only invited accounts can enter the workspace.
8. Sign in locally, open Team access, and invite a regular user. That user signs in with their invited email and password.
9. Start the app with `npm install && npm run dev`.

## Vercel

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as Vercel environment variables and redeploy. `vercel.json` rewrites client-side routes to `index.html`.

The service-role key is used only by Supabase Edge Functions and must never be added to `.env.local`, Vercel frontend variables, or source control.

## Local test users

The application intentionally does not contain hardcoded admin credentials. Create the first admin in Supabase Auth, then use the app’s invitation flow for a regular user. This keeps credentials out of source control and lets Supabase hash the passwords.

The default form includes full card-number storage for testing, but real payment-card data should not be used until the deployment has been designed and assessed for PCI DSS compliance. Prefer test card numbers or replace the card field with a payment-provider token before production use.
