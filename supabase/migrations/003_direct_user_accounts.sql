-- Slatebook direct username/password accounts
-- Run this once after 001_slatebook.sql and 002_backfill_profiles.sql (if needed).

alter table public.profiles add column if not exists username text;

-- Give existing profiles a stable username before adding the uniqueness rule.
update public.profiles
set username = case
  when lower(trim(split_part(coalesce(email, ''), '@', 1))) ~ '^[a-z0-9][a-z0-9._-]{2,39}$'
    then lower(trim(split_part(email, '@', 1)))
  else 'user_' || substr(id::text, 1, 8)
end
where username is null or trim(username) = '';

-- Email local-parts can collide (for example, alex@one.com and alex@two.com).
-- Keep the first readable username and make later ones unambiguous.
with numbered as (
  select id, username,
    row_number() over (partition by lower(username) order by created_at, id) as duplicate_number
  from public.profiles
  where username is not null
)
update public.profiles p
set username = lower(numbered.username) || '_' || substr(p.id::text, 1, 8)
from numbered
where p.id = numbered.id and numbered.duplicate_number > 1;

create unique index if not exists profiles_username_idx
  on public.profiles(lower(username))
  where username is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1))),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    'user'::public.app_role
  )
  on conflict (id) do update
    set email = excluded.email,
        username = excluded.username;
  return new;
end;
$$;
