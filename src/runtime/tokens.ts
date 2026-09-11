/**
 * Splitting a CSS value into top-level tokens, which `split(/[\s,]+/)` cannot do:
 * `cubic-bezier(0.1, 0.2, 0.3, 0.4)` and `rgb(255, 0, 0)` carry separators of
 * their own, and cutting on those turns one token into four that no longer
 * serialise back to valid CSS.
 */

/**
 * The whitespace-separated top-level tokens of a value, with anything inside
 * parens kept whole — `blur(2px) drop-shadow(0 0 6px rgb(255, 0, 0))` is two.
 */
export function splitFunctions(value: string): string[] {
  return splitTopLevel(value, (char) => /\s/.test(char))
}

/**
 * The same, but commas separate as well as whitespace — the `animation`
 * shorthand accepts either between its parts.
 */
export function splitTokens(value: string): string[] {
  return splitTopLevel(value, (char) => char === ',' || /\s/.test(char))
}

function splitTopLevel(value: string, isSeparator: (char: string) => boolean): string[] {
  const found: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth === 0 && isSeparator(char)) {
      if (current.trim()) found.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) found.push(current.trim())
  return found
}
