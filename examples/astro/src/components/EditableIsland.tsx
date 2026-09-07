/**
 * One React root, with the provider inside it. INTEGRATING.md's Astro note: the
 * scanner only sees what is inside the provider, so an island that is its own
 * root has to carry its own — this file is that shape, rendered from a .astro
 * page with client:load.
 */
import { EditableText, VeditProvider } from 'vedit'

export function EditableIsland() {
  return (
    <VeditProvider documentKey="astro" enabled>
      <main>
        <EditableText id="hero-title" as="h1">
          Edited in an Astro island
        </EditableText>
        <EditableText id="hero-body" as="p">
          This paragraph is server-rendered, then hydrated.
        </EditableText>
      </main>
    </VeditProvider>
  )
}
