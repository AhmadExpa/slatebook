-- Run this if Auth users were created before 001_slatebook.sql.
-- It is safe to run more than once.

insert into public.profiles (id, email, display_name, role, is_active)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(coalesce(u.email, ''), '@', 1)),
  'user'::public.app_role,
  false
from auth.users u
on conflict (id) do update set email = excluded.email;

-- Then run supabase/bootstrap-admin.sql to promote the intended administrator.
