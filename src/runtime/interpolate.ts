/**
 * Substituting host values into editable text.
 *
 * A page's copy often wraps a number the host computes: a deposit, a session
 * date, a venue. Storing the rendered sentence would freeze that number into the
 * document, so the site would keep saying `$250` after the price moved. Instead
 * the document stores a template — `Pay {amount} deposit` — and the host hands
 * over the current values by name on every render.
 *
 * The consequence worth stating: vedit never learns what `{amount}` is worth. It
 * stores the name, and the host answers it. Nothing here reaches back into the
 * document for a value.
 */

/** `{name}` where name is a JS-ish identifier. Doubled braces escape. */
const PLACEHOLDER = /\{\{|\}\}|\{([A-Za-z_$][\w$]*)\}/g

/**
 * Replace `{name}` with `vars[name]`.
 *
 * An unknown name is left exactly as written rather than blanked. Someone
 * mid-edit has a half-typed `{amo` on screen, and swallowing it would make the
 * text flicker away as they type; leaving it visible also means a typo shows up
 * as itself instead of as a mysterious gap. `{{` and `}}` emit single braces, so
 * text that genuinely wants a brace can still say so.
 */
export function interpolate(template: string, vars: Record<string, string> | undefined): string {
  if (!template.includes('{')) return template
  if (!vars) return template.replace(/\{\{|\}\}/g, (m) => m[0])
  return template.replace(PLACEHOLDER, (match, name?: string) => {
    if (match === '{{') return '{'
    if (match === '}}') return '}'
    const value = name !== undefined ? vars[name] : undefined
    return value === undefined ? match : value
  })
}

/** The names a template refers to, in order, without duplicates. */
export function placeholdersIn(template: string): string[] {
  const found: string[] = []
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]
    if (name !== undefined && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * Names used in the template that the host did not offer.
 *
 * The inspector shows these as a warning. Rendering leaves them as literal text,
 * so this is the only thing that tells someone they typed `{amonut}` — otherwise
 * the mistake ships looking like deliberate copy.
 */
export function unknownPlaceholders(
  template: string,
  vars: Record<string, string> | undefined,
): string[] {
  return placeholdersIn(template).filter((name) => !vars || !(name in vars))
}
