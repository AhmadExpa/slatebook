-- Store the login username as Agent name for every new lead.

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

grant execute on function public.create_customer_record(uuid, jsonb) to authenticated;
