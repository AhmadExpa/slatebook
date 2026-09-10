-- CVV is not collected. Keep legacy schema support for safe cleanup, but do
-- not leave a CVV field active in the fixed Lead intake form.

update public.form_fields
set is_archived = true, is_required = false
where field_key = 'cvv';

update public.customer_record_values
set raw_values = raw_values - 'cvv'
where raw_values ? 'cvv';

do $$
declare
  record_id uuid;
begin
  for record_id in select id from public.customer_records loop
    perform public.refresh_customer_projection(record_id);
  end loop;
end;
$$;
