import type { FieldType, FieldValue, FormField, Visibility } from './types'

export function normalizeLoginIdentifier(identifier: string): string {
  const normalized = identifier.trim().toLowerCase()
  return normalized.includes('@') ? normalized : `${normalized}@users.slatebook.local`
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

export function initials(name: string | null | undefined, email = ''): string {
  const source = name?.trim() || email.split('@')[0] || 'U'
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : source.slice(0, 2)).toUpperCase()
}

export function validateValue(field: FormField, value: FieldValue): string | null {
  if (field.is_required && (value === null || value === undefined || String(value).trim() === '')) {
    return `${field.label} is required.`
  }
  if (value === null || value === undefined || String(value).trim() === '') return null

  if (field.field_type === 'email' && !/^\S+@\S+\.\S+$/.test(String(value))) {
    return `${field.label} needs a valid email address.`
  }
  if (field.field_type === 'number' && !Number.isFinite(Number(value))) {
    return `${field.label} needs to be a number.`
  }
  if (field.field_type === 'date' && Number.isNaN(Date.parse(String(value)))) {
    return `${field.label} needs to be a valid date.`
  }
  if (field.field_type === 'expiry' && !/^(0[1-9]|1[0-2])(?:\/?|-)?(?:\d{2}|\d{4})$/.test(String(value).replace(/\s/g, ''))) {
    return `${field.label} needs to be in MM/YY format.`
  }
  if (field.field_type === 'card' && !isValidCardNumber(String(value))) {
    return `${field.label} is not a valid card number.`
  }
  if (field.field_type === 'select' && !field.options.includes(String(value))) {
    return `${field.label} must use one of the available options.`
  }
  return null
}

export function isValidCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 12 || digits.length > 19) return false
  let sum = 0
  let doubleDigit = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}

export function sanitizeDisplayValue(field: FormField, value: FieldValue, isAdmin: boolean): string {
  if (value === null || value === undefined || value === '') return '—'
  if (isAdmin || field.visibility === 'visible') return String(value)
  if (field.visibility === 'admin_only') return 'Hidden from users'
  const raw = String(value)
  const suffixLength = Math.max(1, field.mask_last_n ?? 4)
  if (raw.length <= suffixLength) return '•'.repeat(Math.max(4, raw.length))
  return `${'•'.repeat(Math.max(4, raw.length - suffixLength))}${raw.slice(-suffixLength)}`
}

export function isEditableByUser(field: FormField): boolean {
  return field.visibility === 'visible' && !field.is_archived
}

export function fieldInputType(fieldType: FieldType): string {
  if (fieldType === 'number') return 'number'
  if (fieldType === 'date') return 'date'
  if (fieldType === 'expiry') return 'text'
  if (fieldType === 'email') return 'email'
  if (fieldType === 'phone') return 'tel'
  if (fieldType === 'card') return 'text'
  return 'text'
}

export function getVisibilityTone(visibility: Visibility): string {
  if (visibility === 'visible') return 'status-success'
  if (visibility === 'masked') return 'status-warning'
  return 'status-danger'
}

export function toCsvCell(value: unknown): string {
  const stringValue = value === null || value === undefined ? '' : String(value)
  const safeValue = /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue
  return /[",\n\r]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue
}
