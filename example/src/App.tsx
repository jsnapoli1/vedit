import { EditableBox, EditableImage, EditableText, VeditProvider, useVeditEditing } from 'vedit'

/** Inline so the demo works with no network. Swap in a real photo through the editor. */
const PLACEHOLDER_ART =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#22d3ee"/>
       </linearGradient></defs>
       <rect width="800" height="600" fill="url(#g)"/>
       <circle cx="250" cy="200" r="120" fill="#ffffff" opacity=".18"/>
       <circle cx="560" cy="400" r="170" fill="#ffffff" opacity=".14"/>
     </svg>`,
  )

const FEATURES = [
  { id: 'a', title: 'Edit in place', body: 'Click any element on the page and change it where it lives.' },
  { id: 'b', title: 'Responsive by breakpoint', body: 'Tune a headline on mobile without touching the desktop layout.' },
  { id: 'c', title: 'Your storage', body: 'Overrides are plain JSON. Keep them wherever the rest of your data lives.' },
]

export function App() {
  return (
    <VeditProvider documentKey="marketing-home" auto>
      <Site />
    </VeditProvider>
  )
}

function Site() {
  const [editing, setEditing] = useVeditEditing()

  return (
    <>
      <nav className="nav">
        <EditableText id="nav.brand" as="span" className="brand">
          Northwind
        </EditableText>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#docs">Docs</a>
        </div>
        <button type="button" onClick={() => setEditing(!editing)}>
          {editing ? 'Close editor' : 'Edit page'}
        </button>
      </nav>

      <EditableBox id="home.hero" as="section" className="hero">
        <div>
          <EditableText id="home.hero.eyebrow" className="eyebrow">
            Now in public beta
          </EditableText>
          <EditableText id="home.hero.title" as="h1">
            Ship the site your designer actually drew.
          </EditableText>
          <EditableText id="home.hero.body">
            Northwind gives your team a real design surface on top of the code you already
            wrote — no rebuild, no CMS migration, no ticket for a comma.
          </EditableText>
          <EditableText id="home.hero.cta" as="a" kind="button" className="cta" href="#start">
            Start free
          </EditableText>
        </div>
        <EditableImage
          id="home.hero.art"
          className="hero-art"
          src={PLACEHOLDER_ART}
          alt="An abstract illustration"
        />
      </EditableBox>

      <EditableBox id="home.features" as="section" className="features" container>
        {FEATURES.map((feature) => (
          <div className="card" key={feature.id}>
            <EditableText id={`home.features.${feature.id}.title`} as="h3">
              {feature.title}
            </EditableText>
            <EditableText id={`home.features.${feature.id}.body`}>{feature.body}</EditableText>
          </div>
        ))}
      </EditableBox>

      <footer className="footer">
        <p>© Northwind. This paragraph was never wrapped in an Editable — the scanner found it.</p>
      </footer>
    </>
  )
}
