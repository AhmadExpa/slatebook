import type { Form, FormField, RawRecord } from './types'
import { toCsvCell } from './utils'

export function downloadCsv(records: RawRecord[], forms: Form[], fieldsByForm: Map<string, FormField[]>): void {
  if (!records.length) throw new Error('There are no records to export for this selection.')

  const formNameById = new Map(forms.map((form) => [form.id, form.name]))
  const allForms = new Set(records.map((record) => record.form_id)).size > 1
  const columnKeys = new Set<string>()
  const columns: Array<{ key: string; label: string }> = []

  for (const record of records) {
    const fields = fieldsByForm.get(record.form_id) || []
    for (const field of fields) {
      const key = allForms ? `${record.form_id}:${field.field_key}` : field.field_key
      if (!columnKeys.has(key)) {
        columnKeys.add(key)
        columns.push({ key, label: allForms ? `${formNameById.get(record.form_id) || 'Form'} — ${field.label}` : field.label })
      }
    }
  }

  const headers = ['Record ID', ...(allForms ? ['Form'] : []), 'Created at', 'Updated at', 'Created by', ...columns.map((column) => column.label)]
  const rows = records.map((record) => {
    const fields = fieldsByForm.get(record.form_id) || []
    const fieldByKey = new Map(fields.map((field) => [field.field_key, field]))
    const values = columns.map((column) => {
      if (allForms && !column.key.startsWith(`${record.form_id}:`)) return ''
      const rawKey = allForms ? column.key.split(':').slice(1).join(':') : column.key
      return fieldByKey.has(rawKey) ? record.raw_values[rawKey] ?? '' : ''
    })
    return [record.record_id, ...(allForms ? [formNameById.get(record.form_id) || ''] : []), record.created_at, record.updated_at, record.created_by, ...values]
  })

  const csv = [headers, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\r\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `eleven-notepad-export-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
