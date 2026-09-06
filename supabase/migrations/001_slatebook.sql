-- Slatebook: secure customer lead notepad
-- Run this migration in the Supabase SQL editor before deploying the Vercel app.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.form_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.field_visibility as enum ('visible', 'masked', 'admin_only');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  username text,
  display_name text,
  role public.app_role not null default 'user',
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  status public.form_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z0-9_]{1,64}$'),
  label text not null check (length(trim(label)) between 1 and 120),
  field_type text not null check (field_type in ('text', 'textarea', 'number', 'date', 'expiry', 'email', 'phone', 'card', 'select')),
  is_required boolean not null default false,
  visibility public.field_visibility not null default 'visible',
  mask_last_n integer check (mask_last_n is null or mask_last_n between 1 and 12),
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (form_id, field_key),
  check (visibility <> 'masked' or mask_last_n is not null),
  check (field_type <> 'select' or jsonb_typeof(options) = 'array')
);

create table if not exists public.customer_records (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Raw values are separated from record metadata so a regular user's select
-- permission can never accidentally return sensitive JSON.
create table if not exists public.customer_record_values (
  record_id uuid primary key references public.customer_records(id) on delete cascade,
  raw_values jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

-- This is the only customer-value table regular users can read.
create table if not exists public.customer_safe_projection (
  record_id uuid primary key references public.customer_records(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  safe_values jsonb not null default '{}'::jsonb,
  validations jsonb not null default '{}'::jsonb,
  search_document text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.customer_safe_projection add column if not exists validations jsonb not null default '{}'::jsonb;

create table if not exists public.customer_record_validations (
  record_id uuid not null references public.customer_records(id) on delete cascade,
  field_id uuid not null references public.form_fields(id) on delete cascade,
  status text not null check (status in ('valid', 'invalid')),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (record_id, field_id)
);

create index if not exists forms_status_idx on public.forms(status);
create index if not exists form_fields_form_order_idx on public.form_fields(form_id, sort_order);
create index if not exists records_form_updated_idx on public.customer_records(form_id, updated_at desc);
create index if not exists safe_projection_form_idx on public.customer_safe_projection(form_id, updated_at desc);
create index if not exists record_validations_record_idx on public.customer_record_validations(record_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists forms_set_updated_at on public.forms;
create trigger forms_set_updated_at before update on public.forms for each row execute function public.set_updated_at();
drop trigger if exists fields_set_updated_at on public.form_fields;
create trigger fields_set_updated_at before update on public.form_fields for each row execute function public.set_updated_at();
drop trigger if exists records_set_updated_at on public.customer_records;
create trigger records_set_updated_at before update on public.customer_records for each row execute function public.set_updated_at();
drop trigger if exists raw_values_set_updated_at on public.customer_record_values;
create trigger raw_values_set_updated_at before update on public.customer_record_values for each row execute function public.set_updated_at();

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
    -- Never trust client-controlled Auth metadata for privilege assignment.
    'user'::public.app_role
  )
  on conflict (id) do update set email = excluded.email, username = excluded.username;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Backfill Auth users that existed before this migration was installed.
insert into public.profiles (id, email, username, display_name, role, is_active)
select
  u.id,
  coalesce(u.email, ''),
  lower(coalesce(u.raw_user_meta_data ->> 'username', split_part(coalesce(u.email, ''), '@', 1))),
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(coalesce(u.email, ''), '@', 1)),
  'user'::public.app_role,
  false
from auth.users u
on conflict (id) do update set email = excluded.email, username = excluded.username;

create unique index if not exists profiles_username_idx on public.profiles(lower(username)) where username is not null;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role = 'admin'
  );
$$;

-- A one-time bootstrap for the first administrator. Replace the email exactly.
-- update public.profiles set role = 'admin', is_active = true where email = 'admin@example.com';

alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.customer_records enable row level security;
alter table public.customer_record_values enable row level security;
alter table public.customer_safe_projection enable row level security;
alter table public.customer_record_validations enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists forms_select on public.forms;
create policy forms_select on public.forms for select to authenticated
  using (public.is_active_user() and (status = 'active' or public.is_admin()));
drop policy if exists forms_insert on public.forms;
create policy forms_insert on public.forms for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());
drop policy if exists forms_update on public.forms;
create policy forms_update on public.forms for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists fields_select on public.form_fields;
create policy fields_select on public.form_fields for select to authenticated
  using (
    public.is_active_user()
    and (public.is_admin() or (is_archived = false and exists (select 1 from public.forms f where f.id = form_id and f.status = 'active')))
  );
drop policy if exists fields_insert on public.form_fields;
create policy fields_insert on public.form_fields for insert to authenticated
  with check (public.is_admin());
drop policy if exists fields_update on public.form_fields;
create policy fields_update on public.form_fields for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists records_select on public.customer_records;
create policy records_select on public.customer_records for select to authenticated
  using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.forms f where f.id = form_id and f.status = 'active')));

drop policy if exists raw_values_select on public.customer_record_values;
create policy raw_values_select on public.customer_record_values for select to authenticated
  using (public.is_admin());

drop policy if exists safe_projection_select on public.customer_safe_projection;
create policy safe_projection_select on public.customer_safe_projection for select to authenticated
  using (public.is_active_user() and (public.is_admin() or exists (select 1 from public.forms f where f.id = form_id and f.status = 'active')));

drop policy if exists record_validations_select on public.customer_record_validations;
create policy record_validations_select on public.customer_record_validations for select to authenticated
  using (public.is_active_user() and (public.is_admin() or exists (
    select 1 from public.customer_records r join public.forms f on f.id = r.form_id
    where r.id = record_id and f.status = 'active'
  )));

grant usage on schema public to authenticated;
grant select on public.profiles, public.forms, public.form_fields, public.customer_records, public.customer_record_values, public.customer_safe_projection, public.customer_record_validations to authenticated;
grant insert, update on public.forms, public.form_fields to authenticated;
revoke insert, update, delete on public.customer_records, public.customer_record_values, public.customer_safe_projection from authenticated;

create or replace function public.is_valid_card_number(input text)
returns boolean
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(input, ''), '[^0-9]', '', 'g');
  index_value integer;
  digit integer;
  total integer := 0;
  double_digit boolean := false;
begin
  if length(digits) < 12 or length(digits) > 19 then return false; end if;
  for index_value in reverse length(digits)..1 loop
    digit := substring(digits, index_value, 1)::integer;
    if double_digit then
      digit := digit * 2;
      if digit > 9 then digit := digit - 9; end if;
    end if;
    total := total + digit;
    double_digit := not double_digit;
  end loop;
  return total % 10 = 0;
end;
$$;

create or replace function public.validate_form_values(p_form_id uuid, p_values jsonb, p_require_all boolean default true, p_allow_archived boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field record;
  item jsonb;
  item_text text;
begin
  if jsonb_typeof(p_values) <> 'object' then raise exception 'Values must be a JSON object'; end if;
  if not exists (select 1 from public.forms where id = p_form_id) then raise exception 'Form not found'; end if;

  for field in select * from public.form_fields where form_id = p_form_id and is_archived = false loop
    if p_require_all and field.is_required and (not (p_values ? field.field_key) or nullif(trim(p_values ->> field.field_key), '') is null) then
      raise exception '% is required', field.label;
    end if;
    if not (p_values ? field.field_key) or p_values -> field.field_key = 'null'::jsonb then continue; end if;
    item := p_values -> field.field_key;
    item_text := p_values ->> field.field_key;
    if field.field_type in ('text', 'textarea', 'email', 'phone', 'date', 'expiry', 'card', 'select') and jsonb_typeof(item) <> 'string' then
      raise exception '% must be text', field.label;
    end if;
    if field.field_type = 'number' and (jsonb_typeof(item) not in ('number', 'string') or item_text !~ '^-?[0-9]+([.][0-9]+)?$') then
      raise exception '% must be a number', field.label;
    end if;
    if field.field_type = 'email' and item_text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception '% must be a valid email', field.label; end if;
    if field.field_type = 'date' and item_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '% must be a valid date', field.label; end if;
    if field.field_type = 'expiry' and item_text !~ '^(0[1-9]|1[0-2])([/-]?)([0-9]{2}|[0-9]{4})$' then raise exception '% must be a valid expiry', field.label; end if;
    if field.field_type = 'card' and not public.is_valid_card_number(item_text) then raise exception '% is not a valid card number', field.label; end if;
    if field.field_type = 'select' and not exists (select 1 from jsonb_array_elements_text(field.options) option where option = item_text) then
      raise exception '% must use an available option', field.label;
    end if;
  end loop;

  for item_text in select jsonb_object_keys(p_values) loop
    if not exists (select 1 from public.form_fields where form_id = p_form_id and field_key = item_text and is_archived = false)
       and not (p_allow_archived and exists (select 1 from public.form_fields where form_id = p_form_id and field_key = item_text)) then
      raise exception 'Unknown or archived field: %', item_text;
    end if;
  end loop;
end;
$$;

create or replace function public.build_safe_values(p_form_id uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  field record;
  raw_text text;
  safe_text text;
  suffix integer;
  result jsonb := '{}'::jsonb;
begin
  for field in select * from public.form_fields where form_id = p_form_id and is_archived = false loop
    if not (p_values ? field.field_key) or field.visibility = 'admin_only' then continue; end if;
    if field.visibility = 'visible' then
      result := result || jsonb_build_object(field.field_key, p_values -> field.field_key);
    else
      raw_text := p_values ->> field.field_key;
      suffix := coalesce(field.mask_last_n, 4);
      if raw_text is null or raw_text = '' then safe_text := null; elsif length(raw_text) <= suffix then safe_text := repeat('•', greatest(4, length(raw_text))); else safe_text := repeat('•', greatest(4, length(raw_text) - suffix)) || right(raw_text, suffix); end if;
      result := result || jsonb_build_object(field.field_key, safe_text);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.refresh_customer_projection(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row record;
  safe jsonb;
  validations jsonb;
  search_text text := '';
  pair record;
begin
  select r.form_id, v.raw_values into record_row from public.customer_records r join public.customer_record_values v on v.record_id = r.id where r.id = p_record_id;
  if not found then return; end if;
  safe := public.build_safe_values(record_row.form_id, record_row.raw_values);
  select coalesce(jsonb_object_agg(field_id::text, status), '{}'::jsonb) into validations
  from public.customer_record_validations where record_id = p_record_id;
  for pair in select * from jsonb_each_text(safe) loop search_text := search_text || ' ' || pair.value; end loop;
  insert into public.customer_safe_projection(record_id, form_id, safe_values, validations, search_document)
  values (p_record_id, record_row.form_id, safe, validations, lower(search_text))
  on conflict (record_id) do update set form_id = excluded.form_id, safe_values = excluded.safe_values, validations = excluded.validations, search_document = excluded.search_document, updated_at = timezone('utc', now());
end;
$$;

create or replace function public.create_customer_record(p_form_id uuid, p_values jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  record_id uuid;
  values_to_save jsonb := p_values;
  agent_name text;
begin
  if not public.is_active_user() then raise exception 'Active account required'; end if;
  if not exists (select 1 from public.forms where id = p_form_id and status = 'active') then raise exception 'This form is not active'; end if;
  select coalesce(display_name, split_part(email, '@', 1)) into agent_name from public.profiles where id = auth.uid();
  if exists (select 1 from public.form_fields where form_id = p_form_id and field_key = 'agent_name' and is_archived = false) then
    values_to_save := values_to_save || jsonb_build_object('agent_name', agent_name);
  end if;
  if exists (select 1 from public.form_fields where form_id = p_form_id and field_key = 'lead_status' and is_archived = false) and not (values_to_save ? 'lead_status') then
    values_to_save := values_to_save || jsonb_build_object('lead_status', 'New');
  end if;
  perform public.validate_form_values(p_form_id, values_to_save, true);
  insert into public.customer_records(form_id, created_by) values (p_form_id, auth.uid()) returning id into record_id;
  insert into public.customer_record_values(record_id, raw_values) values (record_id, values_to_save);
  perform public.refresh_customer_projection(record_id);
  return record_id;
end;
$$;

create or replace function public.update_customer_safe_fields(p_record_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row record;
  merged jsonb;
  item_text text;
begin
  if not public.is_active_user() then raise exception 'Active account required'; end if;
  select r.*, v.raw_values into record_row from public.customer_records r join public.customer_record_values v on v.record_id = r.id where r.id = p_record_id;
  if not found then raise exception 'Record not found'; end if;
  if record_row.updated_at <> p_expected_updated_at then raise exception 'This record changed while you were editing it. Refresh and try again.'; end if;
  for item_text in select jsonb_object_keys(p_patch) loop
    if item_text = 'agent_name' or not exists (select 1 from public.form_fields where form_id = record_row.form_id and field_key = item_text and is_archived = false and visibility = 'visible') then
      raise exception 'Only visible fields can be edited by users';
    end if;
  end loop;
  merged := record_row.raw_values || p_patch;
  perform public.validate_form_values(record_row.form_id, merged, true, true);
  update public.customer_record_values set raw_values = merged where record_id = p_record_id;
  update public.customer_records set updated_at = timezone('utc', now()) where id = p_record_id;
  perform public.refresh_customer_projection(p_record_id);
  return p_record_id;
end;
$$;

create or replace function public.update_admin_customer_record(p_record_id uuid, p_values jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row record;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into record_row from public.customer_records where id = p_record_id;
  if not found then raise exception 'Record not found'; end if;
  perform public.validate_form_values(record_row.form_id, p_values, true, true);
  update public.customer_record_values set raw_values = p_values where record_id = p_record_id;
  update public.customer_records set updated_at = timezone('utc', now()) where id = p_record_id;
  perform public.refresh_customer_projection(p_record_id);
  return p_record_id;
end;
$$;

create or replace function public.search_safe_records(p_form_id uuid, p_query text, p_page integer default 1, p_page_size integer default 25)
returns table(record_id uuid, form_id uuid, form_name text, safe_values jsonb, validations jsonb, created_by uuid, created_at timestamptz, updated_at timestamptz, total_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then raise exception 'Active account required'; end if;
  return query
  select r.id, r.form_id, f.name, p.safe_values, p.validations, r.created_by, r.created_at, r.updated_at, count(*) over()
  from public.customer_records r
  join public.forms f on f.id = r.form_id
  join public.customer_safe_projection p on p.record_id = r.id
  where r.form_id = p_form_id and f.status = 'active'
    and (nullif(trim(coalesce(p_query, '')), '') is null or p.search_document ilike '%' || lower(trim(p_query)) || '%')
  order by r.updated_at desc
  offset greatest(0, (greatest(1, p_page) - 1) * least(greatest(1, p_page_size), 100))
  limit least(greatest(1, p_page_size), 100);
end;
$$;

create or replace function public.search_admin_records(p_form_id uuid default null, p_query text default '', p_page integer default 1, p_page_size integer default 50)
returns table(record_id uuid, form_id uuid, form_name text, safe_values jsonb, validations jsonb, raw_values jsonb, created_by uuid, created_at timestamptz, updated_at timestamptz, total_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  return query
  select r.id, r.form_id, f.name, p.safe_values, p.validations, v.raw_values, r.created_by, r.created_at, r.updated_at, count(*) over()
  from public.customer_records r
  join public.forms f on f.id = r.form_id
  join public.customer_record_values v on v.record_id = r.id
  join public.customer_safe_projection p on p.record_id = r.id
  where (p_form_id is null or r.form_id = p_form_id)
    and (nullif(trim(coalesce(p_query, '')), '') is null or p.search_document ilike '%' || lower(trim(p_query)) || '%')
  order by r.updated_at desc
  offset greatest(0, (greatest(1, p_page) - 1) * least(greatest(1, p_page_size), 100))
  limit least(greatest(1, p_page_size), 100);
end;
$$;

create or replace function public.set_record_field_validation(p_record_id uuid, p_field_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  record_form_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select form_id into record_form_id from public.customer_records where id = p_record_id;
  if record_form_id is null then raise exception 'Record not found'; end if;
  if not exists (select 1 from public.form_fields where id = p_field_id and form_id = record_form_id) then raise exception 'Field does not belong to this record'; end if;
  if p_status is null then
    delete from public.customer_record_validations where record_id = p_record_id and field_id = p_field_id;
  elsif p_status in ('valid', 'invalid') then
    insert into public.customer_record_validations(record_id, field_id, status, updated_by)
    values (p_record_id, p_field_id, p_status, auth.uid())
    on conflict (record_id, field_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = timezone('utc', now());
  else
    raise exception 'Validation status must be valid, invalid, or null';
  end if;
  perform public.refresh_customer_projection(p_record_id);
end;
$$;

create or replace function public.ensure_default_lead_form()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_form_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select id into lead_form_id from public.forms where name = 'Lead intake' limit 1;
  if lead_form_id is not null then return lead_form_id; end if;

  insert into public.forms(name, description, created_by)
  values ('Lead intake', 'Capture a lead while protecting payment and account details.', auth.uid())
  returning id into lead_form_id;

  insert into public.form_fields(form_id, field_key, label, field_type, is_required, visibility, mask_last_n, options, sort_order) values
    (lead_form_id, 'first_name', 'First name', 'text', true, 'visible', null, '[]', 0),
    (lead_form_id, 'last_name', 'Last name', 'text', true, 'visible', null, '[]', 1),
    (lead_form_id, 'address', 'Address', 'textarea', false, 'visible', null, '[]', 2),
    (lead_form_id, 'phone', 'Phone', 'phone', false, 'visible', null, '[]', 3),
    (lead_form_id, 'card_information', 'Card information', 'card', true, 'admin_only', null, '[]', 4),
    (lead_form_id, 'expiry', 'Card expiry', 'expiry', true, 'admin_only', null, '[]', 5),
    (lead_form_id, 'zipcode', 'Zip code', 'text', true, 'admin_only', null, '[]', 6),
    (lead_form_id, 'account_type', 'Last four belongs to', 'select', false, 'visible', null, '["Card", "Checking account", "Both"]', 7),
    (lead_form_id, 'last_four_digits', 'Last four digits', 'text', false, 'masked', 4, '[]', 8),
    (lead_form_id, 'comments', 'Comments', 'textarea', false, 'visible', null, '[]', 9),
    (lead_form_id, 'lead_status', 'Lead status', 'select', true, 'visible', null, '["New", "Contacted", "Qualified", "Converted", "Lost"]', 10),
    (lead_form_id, 'agent_name', 'Agent name', 'text', true, 'visible', null, '[]', 11);
  return lead_form_id;
end;
$$;

create or replace function public.refresh_form_projections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  record_id uuid;
begin
  for record_id in select r.id from public.customer_records r where r.form_id = new.form_id loop
    perform public.refresh_customer_projection(record_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists form_fields_refresh_projection on public.form_fields;
create trigger form_fields_refresh_projection after insert or update on public.form_fields for each row execute function public.refresh_form_projections();

create or replace function public.prevent_used_field_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.field_type is distinct from new.field_type and exists (
    select 1 from public.customer_records r join public.customer_record_values v on v.record_id = r.id
    where r.form_id = old.form_id and v.raw_values ? old.field_key
  ) then
    raise exception 'A field with existing values cannot change type. Archive it and add a new field instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_used_field_type_change on public.form_fields;
create trigger prevent_used_field_type_change before update on public.form_fields for each row execute function public.prevent_used_field_type_change();

grant execute on function public.create_customer_record(uuid, jsonb) to authenticated;
grant execute on function public.update_customer_safe_fields(uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.update_admin_customer_record(uuid, jsonb) to authenticated;
grant execute on function public.search_safe_records(uuid, text, integer, integer) to authenticated;
grant execute on function public.search_admin_records(uuid, text, integer, integer) to authenticated;
grant execute on function public.set_record_field_validation(uuid, uuid, text) to authenticated;
grant execute on function public.ensure_default_lead_form() to authenticated;

-- The create-user and manage-user Edge Functions use the service role only on
-- the server side. They must verify public.is_admin() before each operation.
