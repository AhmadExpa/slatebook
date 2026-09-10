-- Fixed Lead intake form and safe card projection.
-- CVV is not collected by the active form. Legacy CVV values are purged below.

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
create trigger enforce_phone_only_required
before insert or update on public.form_fields
for each row execute function public.enforce_phone_only_required();

-- The browser cannot create, edit, or archive forms or fields. The migration
-- and the fixed-form bootstrap function are the only writers for this setup.
drop policy if exists forms_insert on public.forms;
create policy forms_insert on public.forms for insert to authenticated with check (false);
drop policy if exists forms_update on public.forms;
drop policy if exists fields_insert on public.form_fields;
drop policy if exists fields_update on public.form_fields;
revoke insert, update on public.forms, public.form_fields from authenticated;

do $$
declare
  lead_form_id uuid;
begin
  select id into lead_form_id
  from public.forms
  where name = 'Lead intake'
  order by created_at
  limit 1;

  if lead_form_id is not null then
    update public.forms set status = 'archived' where id <> lead_form_id and status = 'active';

    update public.form_fields
    set is_required = (field_key = 'phone')
    where form_id = lead_form_id and is_archived = false;

    update public.form_fields set label = 'Card information', field_type = 'card', visibility = 'admin_only', is_required = false
    where form_id = lead_form_id and field_key = 'card_information';
    update public.form_fields set label = 'CVV (not stored)', field_type = 'cvv', visibility = 'admin_only', is_required = false
    where form_id = lead_form_id and field_key = 'cvv';
    update public.form_fields set label = 'Card expiry', field_type = 'expiry', visibility = 'visible', is_required = false
    where form_id = lead_form_id and field_key = 'expiry';
    update public.form_fields set label = 'Zip code', field_type = 'text', visibility = 'visible', is_required = false
    where form_id = lead_form_id and field_key = 'zipcode';
    update public.form_fields set label = 'Card last 4 digits', field_type = 'text', visibility = 'visible', is_required = false, mask_last_n = null
    where form_id = lead_form_id and field_key = 'last_four_digits';
    update public.form_fields set label = 'Checking account last 4 digits', field_type = 'text', visibility = 'visible', is_required = false, mask_last_n = null
    where form_id = lead_form_id and field_key = 'checking_account_last_four';
  end if;
end;
$$;

create or replace function public.normalize_lead_values(p_values jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  result jsonb := coalesce(p_values, '{}'::jsonb);
  card_digits text;
  account_type text;
begin
  if jsonb_typeof(result) <> 'object' then
    return '{}'::jsonb;
  end if;

  -- Never retain the card security code, including on admin updates.
  result := result - 'cvv';
  account_type := nullif(trim(result ->> 'account_type'), '');

  if result ? 'card_information' and nullif(trim(result ->> 'card_information'), '') is not null then
    card_digits := regexp_replace(result ->> 'card_information', '[^0-9]', '', 'g');
    if length(card_digits) >= 4 then
      result := result || jsonb_build_object('last_four_digits', right(card_digits, 4));
    end if;
  else
    result := result - 'last_four_digits';
  end if;

  if account_type = 'Card' then
    result := result - 'checking_account_last_four';
  elsif account_type = 'Checking account' then
    result := result - 'card_information' - 'expiry' - 'last_four_digits';
  end if;

  return result;
end;
$$;

create or replace function public.build_safe_values(p_record_id uuid, p_form_id uuid, p_values jsonb)
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
  card_is_validated boolean := false;
  result jsonb := '{}'::jsonb;
begin
  select exists (
    select 1
    from public.customer_record_validations v
    join public.form_fields f on f.id = v.field_id
    where v.record_id = p_record_id
      and f.form_id = p_form_id
      and f.field_key = 'card_information'
      and v.status = 'valid'
  ) into card_is_validated;

  for field in
    select * from public.form_fields
    where form_id = p_form_id and is_archived = false
  loop
    if not (p_values ? field.field_key) or field.field_key in ('card_information', 'cvv') or field.visibility = 'admin_only' then
      continue;
    end if;
    if field.field_key = 'last_four_digits' and not card_is_validated then
      continue;
    end if;
    if field.visibility = 'visible' then
      result := result || jsonb_build_object(field.field_key, p_values -> field.field_key);
    else
      raw_text := p_values ->> field.field_key;
      suffix := coalesce(field.mask_last_n, 4);
      if raw_text is null or raw_text = '' then
        safe_text := null;
      elsif length(raw_text) <= suffix then
        safe_text := repeat('•', greatest(4, length(raw_text)));
      else
        safe_text := repeat('•', greatest(4, length(raw_text) - suffix)) || right(raw_text, suffix);
      end if;
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
  select r.form_id, v.raw_values into record_row
  from public.customer_records r
  join public.customer_record_values v on v.record_id = r.id
  where r.id = p_record_id;
  if not found then return; end if;

  safe := public.build_safe_values(p_record_id, record_row.form_id, record_row.raw_values);
  select coalesce(jsonb_object_agg(field_id::text, status), '{}'::jsonb) into validations
  from public.customer_record_validations
  where record_id = p_record_id;
  for pair in select * from jsonb_each_text(safe) loop
    search_text := search_text || ' ' || pair.value;
  end loop;

  insert into public.customer_safe_projection(record_id, form_id, safe_values, validations, search_document)
  values (p_record_id, record_row.form_id, safe, validations, lower(search_text))
  on conflict (record_id) do update set
    form_id = excluded.form_id,
    safe_values = excluded.safe_values,
    validations = excluded.validations,
    search_document = excluded.search_document,
    updated_at = timezone('utc', now());
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
  if not exists (select 1 from public.forms where id = p_form_id and name = 'Lead intake' and status = 'active') then
    raise exception 'This workspace uses the Lead intake form only';
  end if;
  select coalesce(username, display_name, split_part(email, '@', 1)) into agent_name
  from public.profiles where id = auth.uid();
  if exists (select 1 from public.form_fields where form_id = p_form_id and field_key = 'agent_name' and is_archived = false) then
    values_to_save := values_to_save || jsonb_build_object('agent_name', agent_name);
  end if;
  if exists (select 1 from public.form_fields where form_id = p_form_id and field_key = 'lead_status' and is_archived = false)
     and not (values_to_save ? 'lead_status') then
    values_to_save := values_to_save || jsonb_build_object('lead_status', 'New');
  end if;
  perform public.validate_form_values(p_form_id, values_to_save, true);
  values_to_save := public.normalize_lead_values(values_to_save);

  insert into public.customer_records(form_id, created_by)
  values (p_form_id, auth.uid()) returning id into record_id;
  insert into public.customer_record_values(record_id, raw_values)
  values (record_id, values_to_save);
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
  select r.*, v.raw_values into record_row
  from public.customer_records r
  join public.customer_record_values v on v.record_id = r.id
  where r.id = p_record_id;
  if not found then raise exception 'Record not found'; end if;
  if record_row.updated_at <> p_expected_updated_at then raise exception 'This record changed while you were editing it. Refresh and try again.'; end if;
  if not exists (select 1 from public.forms where id = record_row.form_id and name = 'Lead intake' and status = 'active') then
    raise exception 'This workspace uses the Lead intake form only';
  end if;
  for item_text in select jsonb_object_keys(p_patch) loop
    if item_text = 'agent_name' or not exists (
      select 1 from public.form_fields
      where form_id = record_row.form_id and field_key = item_text and is_archived = false and visibility = 'visible'
    ) then
      raise exception 'Only visible fields can be edited by users';
    end if;
  end loop;
  merged := record_row.raw_values || p_patch;
  perform public.validate_form_values(record_row.form_id, merged, true, true);
  merged := public.normalize_lead_values(merged);
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
  if not exists (select 1 from public.forms where id = record_row.form_id and name = 'Lead intake') then
    raise exception 'This workspace uses the Lead intake form only';
  end if;
  perform public.validate_form_values(record_row.form_id, values_to_save, true, true);
  values_to_save := public.normalize_lead_values(values_to_save);
  update public.customer_record_values set raw_values = values_to_save where record_id = p_record_id;
  update public.customer_records set updated_at = timezone('utc', now()) where id = p_record_id;
  perform public.refresh_customer_projection(p_record_id);
  return p_record_id;
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

  if lead_form_id is null then
    update public.forms set status = 'archived' where status = 'active';
    insert into public.forms(name, description, created_by)
    values ('Lead intake', 'Capture a lead while protecting payment and account details.', auth.uid())
    returning id into lead_form_id;
  else
    update public.forms set status = 'active' where id = lead_form_id;
    update public.forms set status = 'archived' where id <> lead_form_id and status = 'active';
  end if;

  insert into public.form_fields(form_id, field_key, label, field_type, is_required, visibility, mask_last_n, options, sort_order) values
    (lead_form_id, 'first_name', 'First name', 'text', false, 'visible', null, '[]', 0),
    (lead_form_id, 'last_name', 'Last name', 'text', false, 'visible', null, '[]', 1),
    (lead_form_id, 'address', 'Address', 'textarea', false, 'visible', null, '[]', 2),
    (lead_form_id, 'phone', 'Phone', 'phone', true, 'visible', null, '[]', 3),
    (lead_form_id, 'card_information', 'Card information', 'card', false, 'admin_only', null, '[]', 4),
    (lead_form_id, 'expiry', 'Card expiry', 'expiry', false, 'visible', null, '[]', 6),
    (lead_form_id, 'zipcode', 'Zip code', 'text', false, 'visible', null, '[]', 7),
    (lead_form_id, 'account_type', 'Account type', 'select', false, 'visible', null, '["Card", "Checking account", "Both"]', 8),
    (lead_form_id, 'last_four_digits', 'Card last 4 digits', 'text', false, 'visible', null, '[]', 9),
    (lead_form_id, 'checking_account_last_four', 'Checking account last 4 digits', 'text', false, 'visible', null, '[]', 10),
    (lead_form_id, 'comments', 'Comments', 'textarea', false, 'visible', null, '[]', 11),
    (lead_form_id, 'lead_status', 'Lead status', 'select', false, 'visible', null, '["New", "Contacted", "Qualified", "Converted", "Lost"]', 12),
    (lead_form_id, 'agent_name', 'Agent name', 'text', false, 'visible', null, '[]', 13)
  on conflict (form_id, field_key) do nothing;

  update public.form_fields
  set is_required = (field_key = 'phone')
  where form_id = lead_form_id and is_archived = false;
  update public.form_fields set label = 'Card information', field_type = 'card', visibility = 'admin_only', is_required = false
  where form_id = lead_form_id and field_key = 'card_information';
  update public.form_fields set label = 'CVV (not stored)', field_type = 'cvv', visibility = 'admin_only', is_required = false
  where form_id = lead_form_id and field_key = 'cvv';
  update public.form_fields set label = 'Card expiry', field_type = 'expiry', visibility = 'visible', is_required = false
  where form_id = lead_form_id and field_key = 'expiry';
  update public.form_fields set label = 'Zip code', field_type = 'text', visibility = 'visible', is_required = false
  where form_id = lead_form_id and field_key = 'zipcode';
  update public.form_fields set label = 'Card last 4 digits', field_type = 'text', visibility = 'visible', is_required = false, mask_last_n = null
  where form_id = lead_form_id and field_key = 'last_four_digits';
  update public.form_fields set label = 'Checking account last 4 digits', field_type = 'text', visibility = 'visible', is_required = false, mask_last_n = null
  where form_id = lead_form_id and field_key = 'checking_account_last_four';
  return lead_form_id;
end;
$$;

-- Purge any CVV that may have been written by an earlier version and derive
-- card last-four values for existing records.
update public.customer_record_values
set raw_values = public.normalize_lead_values(raw_values);

do $$
declare
  record_id uuid;
begin
  for record_id in select id from public.customer_records loop
    perform public.refresh_customer_projection(record_id);
  end loop;
end;
$$;

grant execute on function public.normalize_lead_values(jsonb) to authenticated;
grant execute on function public.build_safe_values(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_customer_record(uuid, jsonb) to authenticated;
grant execute on function public.update_customer_safe_fields(uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.update_admin_customer_record(uuid, jsonb) to authenticated;
grant execute on function public.ensure_default_lead_form() to authenticated;
