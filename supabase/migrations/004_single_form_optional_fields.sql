-- Slatebook single-form workspace and optional field rules
-- Run this after 003_direct_user_accounts.sql.

-- CVV is accepted only as a transient value during entry. It is never written
-- to customer_record_values or exposed in a projection/export.
alter table public.form_fields drop constraint if exists form_fields_field_type_check;
alter table public.form_fields add constraint form_fields_field_type_check
  check (field_type in ('text', 'textarea', 'number', 'date', 'expiry', 'email', 'phone', 'card', 'cvv', 'select'));

create or replace function public.enforce_phone_only_required()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_required and new.field_key <> 'phone' then
    raise exception 'Only the Phone field can be compulsory';
  end if;
  if new.field_key = 'phone' then new.is_required = true; end if;
  return new;
end;
$$;

drop trigger if exists enforce_phone_only_required on public.form_fields;
create trigger enforce_phone_only_required before insert or update on public.form_fields for each row execute function public.enforce_phone_only_required();

do $$
declare
  lead_form_id uuid;
begin
  select id into lead_form_id from public.forms where name = 'Lead intake' order by created_at limit 1;
  if lead_form_id is not null then
    update public.forms set status = 'archived' where id <> lead_form_id and status = 'active';
    update public.form_fields set is_required = (field_key = 'phone') where form_id = lead_form_id and is_archived = false;
    if not exists (select 1 from public.form_fields where form_id = lead_form_id and field_key = 'cvv') then
      insert into public.form_fields(form_id, field_key, label, field_type, is_required, visibility, options, sort_order)
      values (lead_form_id, 'cvv', 'CVV (not stored)', 'cvv', false, 'admin_only', '[]'::jsonb, 5);
    end if;
  end if;
end;
$$;

-- Remove any CVV that may have been entered before this safeguard existed.
update public.customer_record_values
set raw_values = raw_values - 'cvv'
where raw_values ? 'cvv';

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
    if field.field_type in ('text', 'textarea', 'email', 'phone', 'date', 'expiry', 'card', 'cvv', 'select') and jsonb_typeof(item) <> 'string' then
      raise exception '% must be text', field.label;
    end if;
    if field.field_type = 'number' and (jsonb_typeof(item) not in ('number', 'string') or item_text !~ '^-?[0-9]+([.][0-9]+)?$') then
      raise exception '% must be a number', field.label;
    end if;
    if field.field_type = 'email' and item_text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception '% must be a valid email', field.label; end if;
    if field.field_type = 'date' and item_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '% must be a valid date', field.label; end if;
    if field.field_type = 'expiry' and item_text !~ '^(0[1-9]|1[0-2])([/-]?)([0-9]{2}|[0-9]{4})$' then raise exception '% must be a valid expiry', field.label; end if;
    if field.field_type = 'card' and not public.is_valid_card_number(item_text) then raise exception '% is not a valid card number', field.label; end if;
    if field.field_type = 'cvv' and item_text !~ '^[0-9]{3,4}$' then raise exception '% must be a 3 or 4 digit CVV', field.label; end if;
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
    if not (p_values ? field.field_key) or field.field_key = 'cvv' or field.visibility = 'admin_only' then continue; end if;
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
  if not exists (select 1 from public.forms where id = p_form_id and name = 'Lead intake' and status = 'active') then raise exception 'This workspace uses the Lead intake form only'; end if;
  select coalesce(display_name, split_part(email, '@', 1)) into agent_name from public.profiles where id = auth.uid();
  if exists (select 1 from public.form_fields where form_id = p_form_id and field_key = 'agent_name' and is_archived = false) then
    values_to_save := values_to_save || jsonb_build_object('agent_name', agent_name);
  end if;
  if exists (select 1 from public.form_fields where form_id = p_form_id and field_key = 'lead_status' and is_archived = false) and not (values_to_save ? 'lead_status') then
    values_to_save := values_to_save || jsonb_build_object('lead_status', 'New');
  end if;
  perform public.validate_form_values(p_form_id, values_to_save, true);
  values_to_save := values_to_save - 'cvv';
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
  if not exists (select 1 from public.forms where id = record_row.form_id and name = 'Lead intake' and status = 'active') then raise exception 'This workspace uses the Lead intake form only'; end if;
  for item_text in select jsonb_object_keys(p_patch) loop
    if item_text = 'agent_name' or not exists (select 1 from public.form_fields where form_id = record_row.form_id and field_key = item_text and is_archived = false and visibility = 'visible') then
      raise exception 'Only visible fields can be edited by users';
    end if;
  end loop;
  merged := record_row.raw_values || p_patch;
  perform public.validate_form_values(record_row.form_id, merged, true, true);
  merged := merged - 'cvv';
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
  values_to_save jsonb := p_values;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into record_row from public.customer_records where id = p_record_id;
  if not found then raise exception 'Record not found'; end if;
  if not exists (select 1 from public.forms where id = record_row.form_id and name = 'Lead intake') then raise exception 'This workspace uses the Lead intake form only'; end if;
  perform public.validate_form_values(record_row.form_id, values_to_save, true, true);
  values_to_save := values_to_save - 'cvv';
  update public.customer_record_values set raw_values = values_to_save where record_id = p_record_id;
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
  where r.form_id = p_form_id and f.name = 'Lead intake' and f.status = 'active'
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
  where f.name = 'Lead intake' and (p_form_id is null or r.form_id = p_form_id)
    and (nullif(trim(coalesce(p_query, '')), '') is null or p.search_document ilike '%' || lower(trim(p_query)) || '%')
  order by r.updated_at desc
  offset greatest(0, (greatest(1, p_page) - 1) * least(greatest(1, p_page_size), 100))
  limit least(greatest(1, p_page_size), 100);
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
  select id into lead_form_id from public.forms where name = 'Lead intake' order by created_at limit 1;
  if lead_form_id is not null then
    update public.forms set status = 'archived' where id <> lead_form_id and status = 'active';
    update public.form_fields set is_required = (field_key = 'phone') where form_id = lead_form_id and is_archived = false;
    insert into public.form_fields(form_id, field_key, label, field_type, is_required, visibility, mask_last_n, options, sort_order)
    values (lead_form_id, 'cvv', 'CVV (not stored)', 'cvv', false, 'admin_only', null, '[]', 5)
    on conflict (form_id, field_key) do nothing;
    return lead_form_id;
  end if;

  update public.forms set status = 'archived' where status = 'active';
  insert into public.forms(name, description, created_by)
  values ('Lead intake', 'Capture a lead while protecting payment and account details.', auth.uid())
  returning id into lead_form_id;

  insert into public.form_fields(form_id, field_key, label, field_type, is_required, visibility, mask_last_n, options, sort_order) values
    (lead_form_id, 'first_name', 'First name', 'text', false, 'visible', null, '[]', 0),
    (lead_form_id, 'last_name', 'Last name', 'text', false, 'visible', null, '[]', 1),
    (lead_form_id, 'address', 'Address', 'textarea', false, 'visible', null, '[]', 2),
    (lead_form_id, 'phone', 'Phone', 'phone', true, 'visible', null, '[]', 3),
    (lead_form_id, 'card_information', 'Card information', 'card', false, 'admin_only', null, '[]', 4),
    (lead_form_id, 'cvv', 'CVV (not stored)', 'cvv', false, 'admin_only', null, '[]', 5),
    (lead_form_id, 'expiry', 'Card expiry', 'expiry', false, 'admin_only', null, '[]', 6),
    (lead_form_id, 'zipcode', 'Zip code', 'text', false, 'admin_only', null, '[]', 7),
    (lead_form_id, 'account_type', 'Last four belongs to', 'select', false, 'visible', null, '["Card", "Checking account", "Both"]', 8),
    (lead_form_id, 'last_four_digits', 'Last four digits', 'text', false, 'masked', 4, '[]', 9),
    (lead_form_id, 'comments', 'Comments', 'textarea', false, 'visible', null, '[]', 10),
    (lead_form_id, 'lead_status', 'Lead status', 'select', false, 'visible', null, '["New", "Contacted", "Qualified", "Converted", "Lost"]', 11),
    (lead_form_id, 'agent_name', 'Agent name', 'text', false, 'visible', null, '[]', 12);
  return lead_form_id;
end;
$$;

drop policy if exists forms_insert on public.forms;
create policy forms_insert on public.forms for insert to authenticated with check (false);
drop policy if exists forms_update on public.forms;

drop policy if exists fields_insert on public.form_fields;
create policy fields_insert on public.form_fields for insert to authenticated
  with check (public.is_admin() and exists (select 1 from public.forms f where f.id = form_id and f.name = 'Lead intake' and f.status = 'active'));
drop policy if exists fields_update on public.form_fields;
create policy fields_update on public.form_fields for update to authenticated
  using (public.is_admin() and exists (select 1 from public.forms f where f.id = form_id and f.name = 'Lead intake' and f.status = 'active'))
  with check (public.is_admin() and exists (select 1 from public.forms f where f.id = form_id and f.name = 'Lead intake' and f.status = 'active'));

