# Forms

## What this adds

Two things a site can't do today: build a form in the editor, and receive what
visitors type into it.

A form is a registered host component whose fields are configured visually. vedit
owns the *shape* of the form — which fields exist, what they're called, what
counts as valid — and evaluates that shape against visitor input as they type.
The host owns the *values*: where a submission goes, what happens to it, and every
piece of personal data in it.

That split is the same one `vars` already draws. `vars` stores the name `{amount}`
and never the number behind it, because the number is the host's and goes stale
the moment it's frozen. A submission is the same kind of thing, one step further:
it is the visitor's, and vedit never stores it at all.

## Why not the other shapes

**A first-class `form` node kind** would feel more native — drag a field onto the
page like a component. It was rejected because it puts a form subsystem inside the
document format, and `DOCUMENT_VERSION` is a promise. Fields as a prop value ride
on `props`, which is already versioned per component and already migrated on read.

**Scanner adoption of existing `<form>` markup** costs almost nothing and is worth
doing later, but it only lets someone restyle a form that already exists. Creating
one is half the request.

**Submissions stored by vedit** would mean a public, unauthenticated write
endpoint. Every write surface in vedit today requires `authorize`, and the API has
no rate limiting or audit trail — the roadmap says so. A form post is the first
place an anonymous visitor would write to the host's backend, and it belongs on
the host's side of that line, where their spam defense and rate limiting already
live.

## The field schema

A new `EditableFieldType` value, `'fields'`, whose stored value is an array of
field descriptors. One new type:

```ts
/** A control on a form, as configured in the editor and stored in the document. */
export interface FormField {
  /** Key this field's value is submitted under. Unique within a form. */
  name: string
  label?: string
  type: FormFieldType
  placeholder?: string
  /** Shown under the control. */
  help?: string
  /** For `select` and `radio`. */
  options?: Array<string | { value: string; label: string }>
  /** Rules evaluated against what the visitor types. */
  rules?: FormRule[]
}

export type FormFieldType =
  | 'text' | 'textarea' | 'email' | 'tel' | 'url'
  | 'number' | 'checkbox' | 'select' | 'radio' | 'date'
```

`FormFieldType` is deliberately not `EditableFieldType`. They answer different
questions — one is "what control does the inspector draw for a prop", the other is
"what control does a visitor fill in" — and collapsing them would couple the
editor's chrome to the host's rendered page.

## Validation

### A closed set of rules

```ts
export type FormRule =
  | { kind: 'required' }
  | { kind: 'minLength'; value: number }
  | { kind: 'maxLength'; value: number }
  | { kind: 'min'; value: number }
  | { kind: 'max'; value: number }
  | { kind: 'email' }
  | { kind: 'url' }
  | { kind: 'tel' }
  | { kind: 'integer' }
  | { kind: 'pattern'; preset: PatternPreset }
  | { kind: 'matches'; field: string }

export type PatternPreset = 'usZip' | 'usPhone' | 'postcodeUk' | 'slug' | 'hexColor'
```

Every rule is a tagged variant vedit evaluates itself. There is no user-authored
regex and nothing compiled from stored text.

This is the security-critical decision in the feature. A validation rule is stored
data that runs against visitor input on every keystroke. An arbitrary stored regex
is a denial-of-service vector — a catastrophically backtracking pattern hangs the
tab of every visitor who types in the field, and it would arrive through exactly
the channel `sanitizeHtml` and `safeUrl` exist to defend: a document is only as
trustworthy as whoever can write to it. The preset list is fixed in code and
audited once.

It is also the line the roadmap draws around `repeat`: no expressions, no filters,
no sorts. A closed rule set keeps forms from becoming the place where a page
builder grows a programming language.

`matches` (for confirm-password / confirm-email) reads a sibling's value, so
evaluation takes the whole form's values, not one field's.

### Timing

A field validates on blur, then on every change once it has been touched. Before
first blur it says nothing — no scolding someone halfway through typing their
email. Submit validates everything and focuses the first invalid field.

This mirrors what browsers themselves moved toward with `:user-valid`, and it is
the behavior people are used to.

### Messages

Each rule has a default message (`"This field is required"`,
`"Enter a valid email address"`). A `messages` map on the form overrides them per
rule kind, so copy stays editable like every other string in vedit.

Rendered errors are plain text, never HTML — no path from a stored message to
markup on the page.

## Receiving data

```ts
export interface UseVeditFormOptions {
  fields: FormField[]
  /** Where to POST. Must be same-origin or an absolute https URL. */
  action?: string
  /** Called instead of `action` when the host wants to handle it in code. */
  onSubmit?: (values: FormValues) => void | Promise<void>
  messages?: Partial<Record<FormRule['kind'], string>>
}

export function useVeditForm(options: UseVeditFormOptions): {
  fields: FormField[]
  values: FormValues
  errors: Record<string, string | undefined>
  status: 'idle' | 'submitting' | 'success' | 'error'
  /** Spread onto `<form>`. */
  formProps: { onSubmit: (event: React.FormEvent) => void; noValidate: true }
  /** Spread onto the control for one field. */
  fieldProps: (name: string) => FieldProps
  reset: () => void
}
```

The host writes their own markup and gets validation, error state and submission
wiring. A form is ordinary React with a hook in it — no wrapper, nothing imported
that owns rendering. The invariant holds: your components stay exactly as you
wrote them.

`action` goes through `safeUrl` and is additionally restricted to same-origin or
`https:` — a stored `action` is attacker-controlled if the document store is, and
an unrestricted one would exfiltrate submissions to any host. This is stricter
than `safeUrl` alone, which permits any non-executable scheme.

Submissions POST JSON: `{ formId, values, submittedAt }`. vedit does not retry,
does not queue, and does not persist. A failed post surfaces as
`status: 'error'`.

`noValidate` is set because vedit renders the messages; native bubbles would
double up. Native `type`, `required`, `min`, `max` and `inputMode` attributes are
*still* emitted by `fieldProps`, so the form degrades to browser validation
without JS and mobile keyboards are right.

### Honeypot, not CAPTCHA

`formProps` includes a hidden decoy field. A submission with it filled resolves as
success and posts nothing. Free, no third party, no accessibility cost — and
explicitly not a claim to be adequate spam defense on its own. Real rate limiting
belongs on the host's endpoint, and the docs will say so.

## The inspector

`case 'fields'` in the existing control `switch` renders a list editor: add a
field, reorder, delete, and expand one to edit its name, label, type, placeholder,
help and rules. Rules are a checklist of the applicable kinds for that field type
(`minLength` on text, `min` on number), each with its value control.

Nothing about the panel layout is new — it reuses `Row`, `Segmented`, `TextField`
and the existing add/remove affordances.

Two editor-side guards, both surfaced as inline warnings rather than thrown:

- **Duplicate `name`** — two fields submitting the same key silently loses one.
- **Missing label** — an unlabeled control is an accessibility failure, and
  `a11y.ts` already checks this class of problem.

## Accessibility

Not a follow-up. `fieldProps` returns wiring that makes a correct form the default:

- `id` / `htmlFor` pairing, generated per instance so two forms on a page don't collide
- `aria-describedby` pointing at help text and, when present, the error
- `aria-invalid` on a field with an error
- the error node as `role="alert"` so it is announced when it appears
- `aria-required`, alongside the native attribute

## Reading untrusted descriptors

Stored fields arrive from the document, so they are parsed rather than trusted, on
the same principle as `migrateDocument`: a malformed array costs the form its
appearance, never the page. An unknown `type` falls back to `text`; an unknown
rule `kind` is dropped; a non-array is treated as empty; a `matches` pointing at a
field that no longer exists is dropped. Each drop warns once in development
through `warnOnce`, matching the 0.5 diagnostics work.

## Files

| File | Change |
|---|---|
| `src/core/types.ts` | `'fields'` in `EditableFieldType`; `FormField`, `FormFieldType`, `FormRule`, `PatternPreset`, `FormValues` |
| `src/runtime/forms.ts` | new — rule evaluation, descriptor parsing, preset patterns |
| `src/runtime/useVeditForm.ts` | new — the hook, submission, a11y wiring |
| `src/editor/panels/Inspector.tsx` | `case 'fields'` list editor |
| `src/editor/a11y.ts` | duplicate-name and missing-label checks |
| `src/index.ts` | export hook + types |
| `INTEGRATING.md` | a forms section, with the endpoint's responsibilities named |
| `API.md` | how an agent configures a form over operations/MCP |
| `CHANGELOG.md` | 0.7 entry |
| `ROADMAP.md` | record that this was taken on deliberately |

## Testing

Unit, against `dist/` like the rest:

- every rule kind, valid and invalid, including boundaries (`minLength` at exactly n)
- `matches` against a sibling, and against a field that no longer exists
- descriptor parsing: unknown type, unknown rule, non-array, duplicate names
- `action` rejection: `javascript:`, `data:`, and a cross-origin `http:` URL
- each `PatternPreset` against known-good and known-bad input

Browser, in `e2e/forms.spec.ts`:

- build a form in the editor, add a required email field, reload, it persists
- a visitor sees no error before blur, one after blur, and it clears on correction
- submit posts once to a stub handler with the right JSON body
- the honeypot path posts nothing and reports success
- keyboard-only: tab through, submit, focus lands on the first invalid field

## What this deliberately does not do

- **No submissions viewer.** vedit never sees a submission; there is nothing to show.
- **No server-side validation.** vedit does not run on the host's endpoint. The
  docs will state plainly that client-side rules are a usability feature and that
  the endpoint must validate again — the rules are visible to anyone with
  devtools.
- **No file uploads.** They need storage, size limits and content scanning, none
  of which vedit owns.
- **No conditional fields.** "Show this when that equals X" is the expression
  language the roadmap warns about.
- **No multi-step forms.** Worth revisiting once one-step forms have real use.

## Note on the roadmap

ROADMAP.md lists data bindings among what it would not add before 1.0, on the
argument that 1.0 is earned with use rather than scope. This feature was
requested with that trade-off named and overridden, so it proceeds; the roadmap
should be updated to say so rather than left contradicting the code.

The cost to the frozen surface is one `EditableFieldType` value, one hook, and
five exported types. The document format does not move: fields ride on `props`,
which is already versioned per component and already migrated on read.
