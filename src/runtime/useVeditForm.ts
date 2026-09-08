import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FormField, FormValues } from '../core/types'
import {
  parseFormFields,
  safeFormAction,
  validateField,
  validateForm,
  type FormMessages,
} from './forms'

/** The decoy input's name. Bots fill every field they find; people never see it. */
export const HONEYPOT_NAME = '_vedit_hp'

export interface SubmissionBody {
  formId: string
  values: FormValues
  submittedAt: string
}

/** What gets posted. The honeypot is stripped — it is bookkeeping, not an answer. */
export function buildSubmission(formId: string, values: FormValues): SubmissionBody {
  const { [HONEYPOT_NAME]: _decoy, ...rest } = values
  return { formId, values: rest, submittedAt: new Date().toISOString() }
}

/** Whether the decoy was filled, which no person does. */
export function isHoneypotFilled(values: FormValues): boolean {
  return !!values[HONEYPOT_NAME]
}

export interface UseVeditFormOptions {
  /** Descriptors, usually the prop the editor wrote. Parsed, not trusted. */
  fields: unknown
  /** Identifies the form in the posted body. */
  formId?: string
  /** Where to POST. Same-origin or absolute https, or it is refused. */
  action?: string
  /** Handle the submission in code instead of posting. Wins over `action`. */
  onSubmit?: (values: FormValues) => void | Promise<void>
  /** Replace the default copy for a rule kind. */
  messages?: FormMessages
}

export interface FieldProps {
  id: string
  name: string
  value?: string
  checked?: boolean
  required: boolean
  'aria-required': boolean
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
  onChange: (event: { target: { value: string; checked?: boolean } }) => void
  onBlur: () => void
}

export interface VeditForm {
  fields: FormField[]
  values: FormValues
  errors: Record<string, string | undefined>
  status: 'idle' | 'submitting' | 'success' | 'error'
  formProps: { onSubmit: (event: FormEvent) => void; noValidate: true }
  fieldProps: (name: string) => FieldProps
  /** Ids to hang help and error text off, so `aria-describedby` points somewhere. */
  describedBy: (name: string) => { help: string; error: string }
  /** Spread onto a visually hidden input. */
  honeypotProps: {
    name: string
    tabIndex: -1
    autoComplete: 'off'
    'aria-hidden': true
    onChange: (event: { target: { value: string } }) => void
  }
  reset: () => void
}

/**
 * Validation, error state, accessibility wiring and submission for a form whose
 * shape was configured in the editor.
 *
 * The host writes the markup; this only says what is in the form and what is
 * wrong with it. Values never reach vedit's store — a submission belongs to the
 * person who typed it, and it goes to the host's endpoint and nowhere else.
 *
 * The rules here are a usability feature, not a security boundary: they are
 * visible in devtools and trivially bypassed, so the endpoint has to check the
 * same things again.
 */
export function useVeditForm(options: UseVeditFormOptions): VeditForm {
  const { action, onSubmit, messages, formId = 'form' } = options
  const fields = useMemo(() => parseFormFields(options.fields), [options.fields])
  const prefix = useId()

  const [values, setValues] = useState<FormValues>({})
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [status, setStatus] = useState<VeditForm['status']>('idle')
  const touched = useRef<Set<string>>(new Set())

  const describedBy = useCallback(
    (name: string) => ({ help: `${prefix}-${name}-help`, error: `${prefix}-${name}-error` }),
    [prefix],
  )

  const revalidate = useCallback(
    (name: string, next: FormValues) => {
      // Silent until the visitor has left the field once: no scolding someone
      // halfway through typing their email. Live afterwards, so a correction
      // clears the message as they make it.
      if (!touched.current.has(name)) return
      const field = fields.find((entry) => entry.name === name)
      if (!field) return
      setErrors((current) => ({ ...current, [name]: validateField(field, next, messages) }))
    },
    [fields, messages],
  )

  const fieldProps = useCallback(
    (name: string): FieldProps => {
      const field = fields.find((entry) => entry.name === name)
      const value = values[name]
      const error = errors[name]
      const ids = describedBy(name)
      const required = !!field?.rules?.some((rule) => rule.kind === 'required')
      const described = [field?.help ? ids.help : null, error ? ids.error : null]
        .filter(Boolean)
        .join(' ')

      return {
        id: `${prefix}-${name}`,
        name,
        value: field?.type === 'checkbox' ? undefined : typeof value === 'string' ? value : '',
        checked: field?.type === 'checkbox' ? value === true : undefined,
        required,
        'aria-required': required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': described || undefined,
        onChange: (event) => {
          const next: FormValues = {
            ...values,
            [name]: field?.type === 'checkbox' ? !!event.target.checked : event.target.value,
          }
          setValues(next)
          revalidate(name, next)
        },
        onBlur: () => {
          touched.current.add(name)
          if (field) {
            setErrors((current) => ({ ...current, [name]: validateField(field, values, messages) }))
          }
        },
      }
    },
    [fields, values, errors, describedBy, prefix, revalidate, messages],
  )

  const reset = useCallback(() => {
    setValues({})
    setErrors({})
    setStatus('idle')
    touched.current = new Set()
  }, [])

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()

      // Resolves as success and posts nothing: telling a bot it was spotted only
      // teaches whoever wrote it to try again.
      if (isHoneypotFilled(values)) {
        setStatus('success')
        return
      }

      const found = validateForm(fields, values, messages)
      const firstBad = fields.find((field) => found[field.name])
      setErrors(found)

      if (firstBad) {
        for (const field of fields) touched.current.add(field.name)
        const element =
          typeof document !== 'undefined'
            ? document.getElementById(`${prefix}-${firstBad.name}`)
            : null
        element?.focus()
        return
      }

      const body = buildSubmission(formId, values)
      const run = async () => {
        setStatus('submitting')
        try {
          if (onSubmit) {
            await onSubmit(body.values)
          } else {
            const url = safeFormAction(action)
            if (!url) throw new Error('vedit: this form has no usable `action` or `onSubmit`.')
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (!response.ok) {
              throw new Error(`vedit: the form endpoint answered ${response.status}.`)
            }
          }
          setStatus('success')
        } catch {
          setStatus('error')
        }
      }
      void run()
    },
    [action, fields, formId, messages, onSubmit, prefix, values],
  )

  return {
    fields,
    values,
    errors,
    status,
    formProps: { onSubmit: handleSubmit, noValidate: true },
    fieldProps,
    describedBy,
    honeypotProps: {
      name: HONEYPOT_NAME,
      tabIndex: -1,
      autoComplete: 'off',
      'aria-hidden': true,
      onChange: (event) =>
        setValues((current) => ({ ...current, [HONEYPOT_NAME]: event.target.value })),
    },
    reset,
  }
}
