import { getSupabase } from './supabase'
import type { CreateFieldInput, CreateFormInput, FieldValues, Form, FormField, Profile, RawRecord, SafeRecord, Role } from './types'

function unwrap<T>(data: T, error: { message?: string } | null): T {
  if (error) throw new Error(error.message || 'The request could not be completed.')
  return data
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await getSupabase().from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No Slatebook profile was found for the signed-in user ${userId}. Check this UUID in Supabase Authentication → Users, then run the backfill/bootstrap SQL for that exact user.`)
  return data as Profile
}

export async function listForms(includeArchived: boolean): Promise<Form[]> {
  let query = getSupabase().from('forms').select('*').order('created_at', { ascending: false })
  if (!includeArchived) query = query.eq('status', 'active')
  const { data, error } = await query
  return unwrap((data || []) as Form[], error)
}

export async function listFields(formId: string, includeArchived = false): Promise<FormField[]> {
  let query = getSupabase().from('form_fields').select('*').eq('form_id', formId).order('sort_order')
  if (!includeArchived) query = query.eq('is_archived', false)
  const { data, error } = await query
  return unwrap((data || []) as FormField[], error)
}

export async function listUsers(): Promise<Profile[]> {
  const { data, error } = await getSupabase().from('profiles').select('*').order('created_at', { ascending: false })
  return unwrap((data || []) as Profile[], error)
}

export async function createForm(input: CreateFormInput): Promise<Form> {
  const { data: { user } } = await getSupabase().auth.getUser()
  if (!user) throw new Error('You must be signed in to create a form.')
  const { data, error } = await getSupabase().from('forms').insert({ ...input, created_by: user.id }).select('*').single()
  return unwrap(data as Form, error)
}

export async function updateForm(formId: string, input: Partial<CreateFormInput>): Promise<Form> {
  const { data, error } = await getSupabase().from('forms').update(input).eq('id', formId).select('*').single()
  return unwrap(data as Form, error)
}

export async function archiveForm(formId: string): Promise<void> {
  const { error } = await getSupabase().from('forms').update({ status: 'archived' }).eq('id', formId)
  unwrap(null, error)
}

export async function createField(input: CreateFieldInput): Promise<FormField> {
  const { data, error } = await getSupabase().from('form_fields').insert(input).select('*').single()
  return unwrap(data as FormField, error)
}

export async function updateField(fieldId: string, input: Partial<CreateFieldInput>): Promise<FormField> {
  const { data, error } = await getSupabase().from('form_fields').update(input).eq('id', fieldId).select('*').single()
  return unwrap(data as FormField, error)
}

export async function archiveField(fieldId: string): Promise<void> {
  const { error } = await getSupabase().from('form_fields').update({ is_archived: true }).eq('id', fieldId)
  unwrap(null, error)
}

export async function searchSafeRecords(formId: string, query: string, page: number, pageSize = 25): Promise<SafeRecord[]> {
  const { data, error } = await getSupabase().rpc('search_safe_records', {
    p_form_id: formId,
    p_query: query,
    p_page: page,
    p_page_size: pageSize,
  })
  return unwrap((data || []) as SafeRecord[], error)
}

export async function searchAdminRecords(formId: string | null, query: string, page: number, pageSize = 50): Promise<RawRecord[]> {
  const { data, error } = await getSupabase().rpc('search_admin_records', {
    p_form_id: formId,
    p_query: query,
    p_page: page,
    p_page_size: pageSize,
  })
  return unwrap((data || []) as RawRecord[], error)
}

export async function createCustomerRecord(formId: string, values: FieldValues): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_customer_record', {
    p_form_id: formId,
    p_values: values,
  })
  return unwrap(data as string, error)
}

export async function updateSafeFields(recordId: string, values: FieldValues, expectedUpdatedAt: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('update_customer_safe_fields', {
    p_record_id: recordId,
    p_patch: values,
    p_expected_updated_at: expectedUpdatedAt,
  })
  return unwrap(data as string, error)
}

export async function updateAdminRecord(recordId: string, values: FieldValues): Promise<string> {
  const { data, error } = await getSupabase().rpc('update_admin_customer_record', {
    p_record_id: recordId,
    p_values: values,
  })
  return unwrap(data as string, error)
}

export async function setRecordFieldValidation(recordId: string, fieldId: string, status: 'valid' | 'invalid' | null): Promise<void> {
  const { error } = await getSupabase().rpc('set_record_field_validation', {
    p_record_id: recordId,
    p_field_id: fieldId,
    p_status: status,
  })
  unwrap(null, error)
}

export async function ensureDefaultLeadForm(): Promise<void> {
  const { error } = await getSupabase().rpc('ensure_default_lead_form')
  unwrap(null, error)
}

export async function inviteUser(email: string, displayName: string, role: Role): Promise<void> {
  const { error } = await getSupabase().functions.invoke('invite-user', {
    body: { email, display_name: displayName, role },
  })
  unwrap(null, error)
}

export async function manageUser(userId: string, action: 'status' | 'role', value: boolean | Role): Promise<void> {
  const { error } = await getSupabase().functions.invoke('manage-user', {
    body: { user_id: userId, action, value },
  })
  unwrap(null, error)
}
