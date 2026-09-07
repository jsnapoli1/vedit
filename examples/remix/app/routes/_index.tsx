import { EditableText } from 'vedit'

export default function Index() {
  return (
    <main>
      <EditableText id="hero-title" as="h1">
        Edited on Remix
      </EditableText>
      <EditableText id="hero-body" as="p">
        This paragraph is server-rendered, then hydrated.
      </EditableText>
    </main>
  )
}
