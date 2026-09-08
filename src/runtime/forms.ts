import { warnOnce } from '../core/env'
import type { FormField, FormFieldType, FormRule, FormValues, PatternPreset } from '../core/types'

/** Copy shown when a rule fails, overridable per form. */
export type FormMessages = Partial<Record<FormRule['kind'], string>>

const FIELD_TYPES: FormFieldType[] = [
  'text',
  'textarea',
  'email',
  'tel',
  'url',
  'number',
  'checkbox',
  'select',
  'radio',
  'date',
]

/**
 * The patterns someone can pick from, written once and audited here.
 *
 * Each is anchored and bounded, with no nested quantifier that could blow up:
 * these run against every visitor's keystrokes, and a pattern that backtracks
 * catastrophically hangs their tab. That is the whole reason the inspector
 * offers a list instead of a text box — a regex out of a stored document is
 * data, and data from a document is only as trustworthy as whoever can write it.
 */
const PATTERNS: Record<PatternPreset, RegExp> = {
  usZip: /^\d{5}(-\d{4})?$/,
  usPhone: /^\+?1?[ .-]?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}$/,
  postcodeUk: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  slug: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  hexColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i,
}

/** Deliberately loose. Anything stricter rejects addresses that work. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEL = /^[+\d][\d\s().-]{5,}$/

/**
 * What the browser should offer to autofill, when the field did not say.
 *
 * Only the types that map to one obvious token. Guessing beyond this would put
 * the wrong value in someone's field, which is worse than offering nothing.
 */
const AUTOCOMPLETE_BY_TYPE: Partial<Record<FormFieldType, string>> = {
  email: 'email',
  tel: 'tel',
  url: 'url',
}

/** The autofill hint for a field: what it asked for, else one inferred from its type. */
export function autoCompleteFor(field: FormField): string | undefined {
  return field.autoComplete ?? AUTOCOMPLETE_BY_TYPE[field.type]
}

const DEFAULT_MESSAGES: Record<FormRule['kind'], string> = {
  required: 'This field is required',
  minLength: 'Too short',
  maxLength: 'Too long',
  min: 'Too small',
  max: 'Too large',
  email: 'Enter a valid email address',
  url: 'Enter a valid URL',
  tel: 'Enter a valid phone number',
  integer: 'Enter a whole number',
  pattern: 'Enter a valid value',
  matches: 'These do not match',
}

const asString = (value: FormValues[string] | undefined): string =>
  typeof value === 'string' ? value : ''

const isBlank = (value: FormValues[string] | undefined): boolean =>
  value === undefined || value === '' || value === false

function passes(rule: FormRule, value: FormValues[string] | undefined, values: FormValues): boolean {
  const text = asString(value)
  switch (rule.kind) {
    case 'required':
      return !isBlank(value)
    case 'minLength':
      return text.length >= rule.value
    case 'maxLength':
      return text.length <= rule.value
    case 'min':
      return Number.parseFloat(text) >= rule.value
    case 'max':
      return Number.parseFloat(text) <= rule.value
    case 'integer':
      return Number.isInteger(Number.parseFloat(text))
    case 'email':
      return EMAIL.test(text)
    case 'tel':
      return TEL.test(text)
    case 'url':
      try {
        // Against a base, so a bare `/path` counts as a URL alongside a full one.
        new URL(text, 'https://example.invalid')
        return true
      } catch {
        return false
      }
    case 'pattern':
      return PATTERNS[rule.preset].test(text)
    case 'matches':
      return text === asString(values[rule.field])
    default:
      return true
  }
}

/**
 * The first failing rule's message, or undefined when the field is fine.
 *
 * A blank value only ever fails `required`: someone halfway through typing an
 * optional email should not be told it is not an email yet.
 */
export function validateField(
  field: FormField,
  values: FormValues,
  messages: FormMessages = {},
): string | undefined {
  const value = values[field.name]
  for (const rule of field.rules ?? []) {
    if (rule.kind !== 'required' && isBlank(value)) continue
    if (passes(rule, value, values)) continue
    return messages[rule.kind] ?? DEFAULT_MESSAGES[rule.kind]
  }
  return undefined
}

/** Every field's error, keyed by name. A valid field maps to undefined. */
export function validateForm(
  fields: FormField[],
  values: FormValues,
  messages: FormMessages = {},
): Record<string, string | undefined> {
  const errors: Record<string, string | undefined> = {}
  for (const field of fields) errors[field.name] = validateField(field, values, messages)
  return errors
}

function parseRule(raw: unknown, names: Set<string>): FormRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rule = raw as Record<string, unknown>
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined

  switch (rule.kind) {
    case 'required':
      return { kind: 'required' }
    case 'email':
      return { kind: 'email' }
    case 'url':
      return { kind: 'url' }
    case 'tel':
      return { kind: 'tel' }
    case 'integer':
      return { kind: 'integer' }
    case 'minLength': {
      const value = number(rule.value)
      return value === undefined ? undefined : { kind: 'minLength', value }
    }
    case 'maxLength': {
      const value = number(rule.value)
      return value === undefined ? undefined : { kind: 'maxLength', value }
    }
    case 'min': {
      const value = number(rule.value)
      return value === undefined ? undefined : { kind: 'min', value }
    }
    case 'max': {
      const value = number(rule.value)
      return value === undefined ? undefined : { kind: 'max', value }
    }
    case 'pattern':
      return typeof rule.preset === 'string' && rule.preset in PATTERNS
        ? { kind: 'pattern', preset: rule.preset as PatternPreset }
        : undefined
    case 'matches':
      // Pointing at a field that no longer exists would fail forever, and the
      // person filling the form could never tell why.
      return typeof rule.field === 'string' && names.has(rule.field)
        ? { kind: 'matches', field: rule.field }
        : undefined
    default:
      return undefined
  }
}

/**
 * Read descriptors that came out of a document.
 *
 * Same principle as `migrateDocument`: what is stored is only as trustworthy as
 * whoever can write to it, so this parses rather than casts. A malformed entry
 * costs the form one field, never the page.
 */
export function parseFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      warnOnce('forms:not-array', 'a `fields` prop was not an array, so the form rendered empty.')
    }
    return []
  }

  const raws = value.filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object',
  )
  const names = new Set<string>()
  for (const raw of raws) if (typeof raw.name === 'string' && raw.name) names.add(raw.name)

  const fields: FormField[] = []
  const taken = new Set<string>()

  for (const raw of raws) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) {
      warnOnce('forms:no-name', 'a form field had no `name` and was dropped.')
      continue
    }
    if (taken.has(name)) {
      warnOnce(
        'forms:duplicate',
        `two form fields are both named "${name}"; the later one was dropped, because ` +
          'they would submit under the same key and one answer would be lost.',
      )
      continue
    }
    taken.add(name)

    let type = raw.type as FormFieldType
    if (!FIELD_TYPES.includes(type)) {
      if (raw.type !== undefined) {
        warnOnce(
          'forms:type',
          `a form field had an unknown type "${String(raw.type)}"; it is rendering as text.`,
        )
      }
      type = 'text'
    }

    const rules: FormRule[] = []
    if (Array.isArray(raw.rules)) {
      for (const entry of raw.rules) {
        const rule = parseRule(entry, names)
        if (rule) rules.push(rule)
        else warnOnce('forms:rule', 'a form validation rule was not recognised and was dropped.')
      }
    }

    const options = Array.isArray(raw.options)
      ? (raw.options.filter(
          (option) =>
            typeof option === 'string' ||
            (!!option &&
              typeof option === 'object' &&
              typeof (option as { value?: unknown }).value === 'string'),
        ) as FormField['options'])
      : undefined

    fields.push({
      name,
      type,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      autoComplete: typeof raw.autoComplete === 'string' ? raw.autoComplete : undefined,
      placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
      help: typeof raw.help === 'string' ? raw.help : undefined,
      options,
      rules,
    })
  }

  return fields
}

/**
 * Where a form may post.
 *
 * Stricter than `safeUrl`, which only rules out schemes that execute. An
 * `action` arrives from the document, so an unrestricted one would quietly ship
 * every submission — names, emails, whatever the form asks for — to whichever
 * host an attacker put there. Same origin, or https, and nothing else.
 */
export function safeFormAction(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const base =
    typeof window !== 'undefined' && window.location
      ? window.location.href
      : 'https://vedit.invalid'

  let url: URL
  try {
    url = new URL(trimmed, base)
  } catch {
    return undefined
  }

  if (url.protocol === 'https:') return trimmed
  // A relative path resolves against the page, so it is same-origin by construction.
  if (typeof window !== 'undefined' && url.origin === window.location.origin) return trimmed
  return undefined
}
