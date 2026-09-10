-- Regular agents see their own most recently created leads on the portal.
-- Search remains available across the shared safe projection.

create or replace function public.list_recent_user_records(p_form_id uuid, p_limit integer default 5)
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
  where r.form_id = p_form_id
    and r.created_by = auth.uid()
    and f.name = 'Lead intake'
    and f.status = 'active'
  order by r.created_at desc
  limit least(greatest(1, coalesce(p_limit, 5)), 10);
end;
$$;

grant execute on function public.list_recent_user_records(uuid, integer) to authenticated;
