import { sanitizeHtml } from '../runtime/sanitize'
import { isAsset } from './assets'
import type { SourceField, SourceSchema } from './types'

/**
 * Check a record against its source and say what is wrong, one line per
 * problem, each naming the field. Rich text is sanitised in place while it is
 * here: on the server that is the regex pass whatever the editor did, so a
 * stored record never carries markup the page would refuse to render.
 */
export function validateRecord(schema: Pick<SourceSchema, 'fields'>, data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['Expected a record']
  const record = data as Record<string, unknown>
  const messages: string[] = []

  for (const field of schema.fields) {
    const value = record[field.name]
    if (value === undefined || value === null || value === '') {
      if (field.required) messages.push(`${field.name} is required`)
      continue
    }
    if (field.type === 'richtext' && typeof value === 'string') {
      record[field.name] = sanitizeHtml(value)
      continue
    }
    const problem = typeProblem(field, value)
    if (problem) messages.push(`${field.name} ${problem}`)
  }
  return messages
}

function typeProblem(field: SourceField, value: unknown): string | null {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'password':
      return typeof value === 'string' ? null : 'must be text'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false'
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'must be a date'
    case 'json':
      return null
    case 'select': {
      if (typeof value !== 'string') return 'must be one of the options'
      const options = field.options?.map((option) => (typeof option === 'string' ? option : option.value))
      return !options || options.includes(value) ? null : 'must be one of the options'
    }
    case 'image':
    case 'file':
    case 'video':
      return typeof value === 'string' || isAsset(value) ? null : 'must be an asset or a url'
    case 'relation': {
      if (field.many) {
        return Array.isArray(value) && value.every((id) => typeof id === 'string') ? null : 'must be a list of ids'
      }
      return typeof value === 'string' ? null : 'must be an id'
    }
    default:
      return null
  }
}
