export type Role = 'admin' | 'user'
export type FormStatus = 'active' | 'archived'
export type Visibility = 'visible' | 'masked' | 'admin_only'
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'expiry' | 'email' | 'phone' | 'card' | 'select'
export type ValidationStatus = 'valid' | 'invalid'

export interface Profile {
  id: string
  email: string
  display_name: string | null
  role: Role
  is_active: boolean
  created_at: string
}

export interface Form {
  id: string
  name: string
  description: string | null
  status: FormStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface FormField {
  id: string
  form_id: string
  field_key: string
  label: string
  field_type: FieldType
  is_required: boolean
  visibility: Visibility
  mask_last_n: number | null
  options: string[]
  sort_order: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

export type FieldValue = string | number | null
export type FieldValues = Record<string, FieldValue>

export interface SafeRecord {
  record_id: string
  form_id: string
  form_name: string
  safe_values: FieldValues
  validations: Record<string, ValidationStatus>
  created_by: string
  created_at: string
  updated_at: string
  total_count: number
}

export interface RawRecord extends SafeRecord {
  raw_values: FieldValues
}

export interface CreateFormInput {
  name: string
  description: string
}

export interface CreateFieldInput {
  form_id: string
  field_key: string
  label: string
  field_type: FieldType
  is_required: boolean
  visibility: Visibility
  mask_last_n: number | null
  options: string[]
  sort_order: number
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  expiry: 'Expiry (MM/YY)',
  email: 'Email',
  phone: 'Phone',
  card: 'Card number',
  select: 'Dropdown',
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  visible: 'Visible to users',
  masked: 'Masked suffix',
  admin_only: 'Admin only',
}
