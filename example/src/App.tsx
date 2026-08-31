import type { ReactNode } from 'react'
import {
  EditableBox,
  EditableImage,
  EditableText,
  VeditProvider,
  VeditSlot,
  useEditable,
  useVeditEditing,
  broadcastChannelRealtime,
  sseRealtime,
  type Comment,
  type EditableField,
  type VeditAdapter,
  type VeditDocument,
} from 'vedit'
import { blocks } from './blocks'

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

/**
 * A component that opts into prop editing. The schema lives here, next to the
 * component, so the editor offers exactly the variants this button supports.
 */
const BUTTON_FIELDS: EditableField[] = [
  { name: 'variant', label: 'Style', type: 'select', options: ['solid', 'outline', 'ghost'] },
  { name: 'size', type: 'select', options: ['sm', 'md', 'lg'] },
  { name: 'fullWidth', label: 'Full width', type: 'boolean' },
  { name: 'icon', type: 'text', help: 'Any emoji, shown before the label.' },
]

interface ButtonProps {
  id: string
  href?: string
  variant?: 'solid' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  icon?: string
  children: ReactNode
}

function Button({ id, href, children, ...source }: ButtonProps) {
  const { ref, veditProps, props } = useEditable<ButtonProps>({
    id,
    kind: 'component',
    label: 'Button',
    fields: BUTTON_FIELDS,
    props: { variant: 'solid', size: 'md', fullWidth: false, ...source },
  })

  return (
    <a
      ref={ref as (element: HTMLAnchorElement | null) => void}
      {...veditProps}
      href={href}
      className={`btn btn-${props.variant} btn-${props.size}${props.fullWidth ? ' btn-block' : ''}`}
    >
      {props.icon ? <span aria-hidden>{props.icon} </span> : null}
      {children}
    </a>
  )
}

const FEATURES = [
  { id: 'a', title: 'Edit in place', body: 'Click any element on the page and change it where it lives.' },
  { id: 'b', title: 'Responsive by breakpoint', body: 'Tune a headline on mobile without touching the desktop layout.' },
  { id: 'c', title: 'Your storage', body: 'Overrides are plain JSON. Keep them wherever the rest of your data lives.' },
]

/** A few images to demonstrate the picker, drawn rather than fetched. */
function swatch(from: string, to: string, label: string) {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
         <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
         </linearGradient></defs>
         <rect width="400" height="300" fill="url(#g)"/>
         <text x="200" y="160" font-family="sans-serif" font-size="28" fill="#ffffff"
               text-anchor="middle" opacity=".85">${label}</text>
       </svg>`,
    )
  )
}

/**
 * Everything the editor can ask an adapter for, backed by localStorage: a draft
 * kept apart from what visitors see, a version for every save, and a small stock
 * library for images. Swap this for `httpAdapter` and your own backend.
 */
const demoAdapter: VeditAdapter = {
  async load(key, options) {
    const stage = options?.stage ?? 'published'
    const raw = localStorage.getItem(`demo:${key}:${stage}`)
    if (raw) return JSON.parse(raw)
    // An untouched draft starts from whatever is live.
    if (stage === 'draft') {
      const live = localStorage.getItem(`demo:${key}:published`)
      return live ? JSON.parse(live) : null
    }
    return null
  },

  async save(doc) {
    localStorage.setItem(`demo:${doc.key}:draft`, JSON.stringify(doc))
    recordVersion(doc, 'draft')
  },

  async publish(doc) {
    localStorage.setItem(`demo:${doc.key}:published`, JSON.stringify(doc))
    recordVersion(doc, 'published')
  },

  async listVersions(key) {
    return readVersions(key).map(({ id, savedAt, published }) => ({ id, savedAt, published }))
  },

  async loadVersion(key, versionId) {
    return readVersions(key).find((version) => version.id === versionId)?.doc ?? null
  },

  async listComments(key) {
    return readComments().filter((comment) => comment.key === key)
  },

  async saveComment(comment) {
    const rest = readComments().filter((entry) => entry.id !== comment.id)
    localStorage.setItem('demo:comments', JSON.stringify([...rest, comment]))
  },

  async deleteComment(commentId) {
    const rest = readComments().filter((entry) => entry.id !== commentId)
    localStorage.setItem('demo:comments', JSON.stringify(rest))
  },

  async listAssets() {
    return [
      { url: PLACEHOLDER_ART, name: 'Abstract' },
      { url: swatch('#f97316', '#facc15', 'Sunrise'), name: 'Sunrise' },
      { url: swatch('#0f172a', '#334155', 'Slate'), name: 'Slate' },
      { url: swatch('#16a34a', '#84cc16', 'Meadow'), name: 'Meadow' },
      { url: swatch('#db2777', '#f472b6', 'Blossom'), name: 'Blossom' },
    ]
  },
}

function readComments(): Comment[] {
  const raw = localStorage.getItem('demo:comments')
  return raw ? (JSON.parse(raw) as Comment[]) : []
}

interface StoredVersion {
  id: string
  savedAt: string
  published: boolean
  doc: VeditDocument
}

function readVersions(key: string): StoredVersion[] {
  const raw = localStorage.getItem(`demo:${key}:versions`)
  return raw ? (JSON.parse(raw) as StoredVersion[]) : []
}

function recordVersion(doc: VeditDocument, stage: 'draft' | 'published') {
  const versions = readVersions(doc.key)
  versions.unshift({
    id: `${stage}-${doc.updatedAt}`,
    savedAt: doc.updatedAt,
    published: stage === 'published',
    doc,
  })
  localStorage.setItem(`demo:${doc.key}:versions`, JSON.stringify(versions.slice(0, 20)))
}

const PAGES = [
  { path: '/', label: 'Home' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/campaign', label: 'Campaign' },
]

export function App() {
  // The demo can run either editing mode: `?mode=overlay` edits the page in
  // place instead of loading it into the canvas.
  const canvas = new URLSearchParams(window.location.search).get('mode') !== 'overlay'
  const path = window.location.pathname

  return (
    <VeditProvider
      auto
      canvas={canvas}
      adapter={demoAdapter}
      pages={PAGES}
      realtime={demoRealtime()}
      user={demoUser()}
      components={blocks}
    >
      {path.startsWith('/pricing') ? <Pricing /> : path.startsWith('/campaign') ? <Campaign /> : <Site />}
    </VeditProvider>
  )
}

/**
 * A page with no page in it. Everything between the nav and the footer comes from
 * the document, composed out of the components in `blocks.tsx` — the same site,
 * the same design system, assembled by whoever is editing rather than by this
 * file.
 */
function Campaign() {
  return (
    <>
      <Nav />
      <VeditSlot id="campaign.sections" as="main" label="Campaign page">
        <section className="block block-banner">
          <h2>Nothing here yet</h2>
          <p className="block-body">Open the editor and place a section to start this page.</p>
        </section>
      </VeditSlot>
      <footer className="footer">
        <p>© Northwind. This page is stored as a document, not as JSX.</p>
      </footer>
    </>
  )
}

/**
 * How editors reach each other. Cross-tab by default, which needs nothing;
 * `?rt=sse` switches to the relay in `realtime-server.mjs`, which is what two
 * people on two machines would use.
 */
function demoRealtime() {
  return new URLSearchParams(window.location.search).get('rt') === 'sse'
    ? sseRealtime({ endpoint: '/realtime' })
    : broadcastChannelRealtime()
}

/**
 * Who is editing. A real app passes its signed-in user; the demo takes a name
 * from the URL (`?as=Sam`) so two tabs can pretend to be two people.
 */
function demoUser() {
  const name = new URLSearchParams(window.location.search).get('as')
  return name ? { id: name.toLowerCase(), name } : undefined
}

const PLANS = [
  { id: 'starter', name: 'Starter', price: '$0', blurb: 'One site, one editor.' },
  { id: 'team', name: 'Team', price: '$29', blurb: 'Every site you own, five editors.' },
  { id: 'agency', name: 'Agency', price: '$99', blurb: 'Unlimited sites and client handoff.' },
]

function Pricing() {
  return (
    <>
      <Nav />
      <EditableBox id="pricing.head" as="section" className="hero" container>
        <div>
          <EditableText id="pricing.eyebrow" className="eyebrow">
            Pricing
          </EditableText>
          <EditableText id="pricing.title" as="h1">
            Pay for the sites, not the seats.
          </EditableText>
        </div>
      </EditableBox>
      {/*
        * Two shapes that used to be silent dead ends, kept here so the tests can
        * see the warnings fire: markup hidden from the scanner, and a wrapper
        * that generates no box.
        */}
      <section className="hero" style={{ paddingTop: 0 }}>
        <h2 data-vedit-skip className="split-heading">
          {'Split into words'.split(' ').map((word) => (
            <span key={word}>{word} </span>
          ))}
        </h2>
        <EditableBox id="pricing.contents" style={{ display: 'contents' }} container>
          <span>This span renders; its wrapper generates no box of its own.</span>
        </EditableBox>
      </section>
      <EditableBox id="pricing.plans" as="section" className="features" container>
        {PLANS.map((plan) => (
          <div className="card" key={plan.id}>
            <EditableText id={`pricing.${plan.id}.name`} as="h2">
              {plan.name}
            </EditableText>
            <EditableText id={`pricing.${plan.id}.price`} as="p" className="price">
              {plan.price}
            </EditableText>
            <EditableText id={`pricing.${plan.id}.blurb`}>{plan.blurb}</EditableText>
            <Button id={`pricing.${plan.id}.cta`} href="#start" variant="outline" size="sm">
              Choose {plan.name}
            </Button>
          </div>
        ))}
      </EditableBox>
      <footer className="footer">
        <p>© Northwind. Prices shown in USD.</p>
      </footer>
    </>
  )
}

function Nav() {
  const [editing, setEditing] = useVeditEditing()
  return (
    <nav className="nav">
      <EditableText id="nav.brand" as="span" className="brand">
        Northwind
      </EditableText>
      <div className="nav-links">
        <a href="/">Home</a>
        <a href="/pricing">Pricing</a>
        <a href="#docs">Docs</a>
      </div>
      <button type="button" onClick={() => setEditing(!editing)}>
        {editing ? 'Close editor' : 'Edit page'}
      </button>
    </nav>
  )
}

function Site() {
  return (
    <>
      <Nav />

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
          <Button id="home.hero.cta" href="#start" icon="✦">
            Start free
          </Button>
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
            <EditableText id={`home.features.${feature.id}.title`} as="h2">
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
