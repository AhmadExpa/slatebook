import { describe, expect, it } from 'vitest'
import { formatCardInput, formatExpiryInput, isEditableByUser, isValidCardNumber, normalizeLoginIdentifier, sanitizeDisplayValue, toCsvCell, validateValue } from './utils'
import type { FormField } from './types'

const baseField: FormField = {
  id: 'field-1',
  form_id: 'form-1',
  field_key: 'phone',
  label: 'Phone',
  field_type: 'phone',
  is_required: false,
  visibility: 'masked',
  mask_last_n: 4,
  options: [],
  sort_order: 0,
  is_archived: false,
  created_at: '',
  updated_at: '',
}

describe('privacy display rules', () => {
  it('keeps only the configured suffix for masked fields', () => {
    expect(sanitizeDisplayValue(baseField, '+923001234567', false)).toBe('•••••••••4567')
  })

  it('never reveals admin-only values to regular users', () => {
    expect(sanitizeDisplayValue({ ...baseField, visibility: 'admin_only' }, 'secret', false)).toBe('Hidden from users')
    expect(sanitizeDisplayValue({ ...baseField, visibility: 'admin_only' }, 'secret', true)).toBe('secret')
  })

  it('allows users to edit only visible fields', () => {
    expect(isEditableByUser({ ...baseField, visibility: 'visible' })).toBe(true)
    expect(isEditableByUser(baseField)).toBe(false)
  })
})

describe('card validation', () => {
  it('accepts valid Luhn card numbers and rejects invalid ones', () => {
    expect(isValidCardNumber('4111 1111 1111 1111')).toBe(true)
    expect(isValidCardNumber('4111 1111 1111 1112')).toBe(false)
    expect(validateValue({ ...baseField, field_type: 'card', label: 'Card number' }, '4111111111111111')).toBeNull()
  })

  it('validates CVV format without treating it as a required field', () => {
    expect(validateValue({ ...baseField, field_type: 'cvv', label: 'CVV' }, '123')).toBeNull()
    expect(validateValue({ ...baseField, field_type: 'cvv', label: 'CVV' }, '12')).toContain('3 or 4 digits')
  })
})

describe('username login', () => {
  it('maps usernames to the internal Auth email alias', () => {
    expect(normalizeLoginIdentifier(' Jordan.Lee ')).toBe('jordan.lee@users.slatebook.local')
    expect(normalizeLoginIdentifier('Admin@company.com')).toBe('admin@company.com')
  })
})

describe('input formatting', () => {
  it('groups card digits as they are entered', () => {
    expect(formatCardInput('4111111111111111')).toBe('4111-1111-1111-1111')
    expect(formatCardInput('4111-1111 1111')).toBe('4111-1111-1111')
  })

  it('normalizes three or four expiry digits to MM/YY', () => {
    expect(formatExpiryInput('927')).toBe('09/27')
    expect(formatExpiryInput('0927')).toBe('09/27')
  })
})

describe('CSV safety', () => {
  it('escapes cells and neutralizes spreadsheet formulas', () => {
    expect(toCsvCell('hello, world')).toBe('"hello, world"')
    expect(toCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(toCsvCell('line 1\nline 2')).toBe('"line 1\nline 2"')
  })
})
