-- Run after 001_slatebook.sql and after creating the first Auth user.
-- This is the UUID you provided. Confirm it belongs to the intended account.
insert into public.profiles (id, email, display_name, role, is_active)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(coalesce(u.email, ''), '@', 1)),
  'user'::public.app_role,
  false
from auth.users u
where u.id = 'd3181c54-d0ac-42ef-9630-fd58fb5c1205'
on conflict (id) do update set email = excluded.email;

update public.profiles
set role = 'admin', is_active = true
where id = 'd3181c54-d0ac-42ef-9630-fd58fb5c1205';

-- Alternatively, replace the email below and use this form instead:
/*
update public.profiles
set role = 'admin', is_active = true
where email = 'admin@example.com';
*/

-- Optional: activate a manually-created local test user.
-- update public.profiles set is_active = true where email = 'user@example.com';
