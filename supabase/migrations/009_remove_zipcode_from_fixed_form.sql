-- Zip code is no longer part of the fixed Lead intake form.
-- Archive the field without deleting legacy values from existing records.

update public.form_fields
set is_archived = true, is_required = false
where field_key = 'zipcode';
