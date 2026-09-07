/**
 * Also a Server Component. The editable presets are client components from the
 * bundle, rendered here as children of a server page — the RSC boundary the
 * roadmap called a sharp edge.
 */
import { EditableText } from 'vedit'

export default function Page() {
  return (
    <main>
      <EditableText id="hero-title" as="h1">
        Edited on the App Router
      </EditableText>
      <EditableText id="hero-body" as="p">
        This paragraph is server-rendered, then hydrated.
      </EditableText>
    </main>
  )
}
