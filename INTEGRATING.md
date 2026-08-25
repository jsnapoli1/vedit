# Adding vedit to a site

A short, complete recipe. It is written to be followed by a person or handed to a
coding agent — the steps are in dependency order and each one is checkable.

---

## 1. Install

The package is not on npm (the name `vedit` is taken by someone else), so install
it from the repository:

```bash
npm install github:jsnapoli1/vedit
```

`prepare` builds the bundle on install, so the git URL is a complete install —
nothing else to run. Pin a tag or commit for anything you deploy:

```bash
npm install github:jsnapoli1/vedit#v0.3.0
```

To publish it under your own scope instead, set `"name": "@your-scope/vedit"` in
`package.json` and `npm publish --access public`; the import path changes to match.

**Peer dependencies**: React and React DOM 18 or newer.

---

## 2. The smallest thing that works

Wrap the app once. Nothing else has to change: the DOM scanner makes headings,
text, links, buttons, images and layout containers selectable on their own.

```tsx
import { VeditProvider } from 'vedit'

<VeditProvider>
  <App />
</VeditProvider>
```

Open the site on `localhost` and press `⌘E` (`Ctrl+E`). Edits go to
`localStorage` until an adapter says otherwise.

**Check**: the editor opens, clicking a heading selects it, and typing in the
inspector changes the page.

---

## 3. Give the things that matter stable ids

Scanner ids describe where an element sits (`auto:#app>section>h1`), so they move
when the markup does. Anything you want to keep edited across refactors gets an
explicit id:

```tsx
import { EditableText, EditableImage, EditableBox } from 'vedit'

<EditableBox id="home.hero" as="section" className="hero">
  <EditableText id="home.hero.title" as="h1">Ship the site your designer drew.</EditableText>
  <EditableImage id="home.hero.art" src="/hero.png" alt="" />
</EditableBox>
```

Name ids after content, never position: `home.hero.title`, not `section-2-h1`.
For lists, key off a stable field — `product.${product.slug}.tagline`.

Work outside-in: the hero, the nav, the footer, the repeated card component.
There is no need to wrap everything.

---

## 4. Let components declare their own props

The only part of the inspector your code defines. Worth doing for any component
with variants, because it turns "restyle this button" into "choose the variant
that already exists".

```tsx
import { useEditable, type EditableField } from 'vedit'

const FIELDS: EditableField[] = [
  { name: 'variant', label: 'Style', type: 'select', options: ['solid', 'outline', 'ghost'] },
  { name: 'size', type: 'select', options: ['sm', 'md', 'lg'] },
  { name: 'fullWidth', type: 'boolean' },
]

export function Button({ id, children, ...source }) {
  const { ref, veditProps, props } = useEditable({
    id,
    kind: 'component',
    fields: FIELDS,
    props: { variant: 'solid', size: 'md', ...source },
  })

  return (
    <button ref={ref} {...veditProps} className={`btn btn-${props.variant} btn-${props.size}`}>
      {children}
    </button>
  )
}
```

Render from `props`, not from the incoming values — that's what applies the
overrides.

---

## 5. Optional: let people build pages, not just edit them

Register the components a page may be composed from, and put a slot where they go.
The components stay ordinary React; the schema says which props a person may
change.

```tsx
import { defineComponents, VeditProvider, VeditSlot } from 'vedit'
import { Hero, FeatureRow, Pricing } from './blocks'

export const components = defineComponents({
  Hero: {
    component: Hero,
    group: 'Sections',
    fields: [{ name: 'headline', type: 'text' }, { name: 'align', type: 'select', options: ['left', 'center'] }],
    defaults: { headline: 'A headline worth reading', align: 'left' },
  },
  FeatureRow: { component: FeatureRow, group: 'Sections', fields: [] },
})

<VeditProvider components={components}>
  <Nav />
  <VeditSlot id="campaign.sections" as="main">
    <p>Nothing here yet.</p>
  </VeditSlot>
  <Footer />
</VeditProvider>
```

**Check**: open the editor, choose **Insert**, place a Hero. It renders through
your component, and its props are in the inspector.

Worth knowing:

- A whole page is a slot with nothing around it; a section of an existing page is
  a slot in the middle of your JSX. Adopt one region at a time.
- `container: true` on a component makes it hold whatever is placed inside it, as
  its `children`.
- The editor wraps a placed component in a `<div>` it owns unless you set
  `wrap: false` — do that when the component spreads its props onto its own root
  and the extra element would break a flex or grid layout.
- Name components for what they are, not where they go: the name is stored in
  every document that places one.

---

## 6. Store the edits somewhere real

`localStorage` is for trying it out. For anything shared, point the provider at
your backend and add the matching route.

```tsx
import { VeditProvider, httpAdapter } from 'vedit'

<VeditProvider
  documentKey={pathname}
  adapter={httpAdapter({
    endpoint: '/api/vedit',
    uploadEndpoint: '/api/vedit/upload',
    staged: true,               // adds Save draft / Publish / History
  })}
  enabled={user?.canEditSite}   // the real gate; see step 7
>
```

```ts
// app/api/vedit/route.ts  (Next App Router; the handler is Fetch-standard,
// so Remix, Hono, Workers, Deno and Bun take the same function)
import { createVeditHandler, fileStore } from 'vedit/server'

const handle = createVeditHandler({
  store: fileStore('./content'),                 // swap for your database
  authorize: async (request) => isEditor(request), // REQUIRED in production
})

export { handle as GET, handle as PUT, handle as POST }
```

A custom store is two methods:

```ts
const store = {
  async read(key, stage = 'published') { return db.overrides.find({ key, stage }) },
  async write(doc, stage = 'published') { await db.overrides.upsert({ key: doc.key, stage, doc }) },
}
```

**Check**: edit, Save draft, reload as a visitor — nothing changed. Publish,
reload — it changed.

---

## 7. Pick document keys

One document per editable page. The default is `window.location.pathname`, which
is usually right. Set `documentKey` explicitly when:

- several routes render the same editable page (use a canonical key),
- one route renders many pages (`product/${slug}`),
- you run several sites off one backend (`acme:/pricing`).

Server-render the document to avoid a flash of the original design:

```tsx
const doc = await store.read(pathname)
<VeditProvider documentKey={pathname} initialDocument={doc}>
```

---

## 8. Decide who can open it

Without `enabled`, the editor is available on `localhost`, in development
builds, and to anyone who adds `?vedit=1`. That last one is fine for a staging
site and wrong for production. In production, pass your own check:

```tsx
enabled={session?.user?.role === 'editor'}
```

`enabled` only controls the editor UI. It does not protect your data — the
`authorize` callback on the handler does that. Set both.

---

## 9. Optional: several pages at once, and collaboration

```tsx
<VeditProvider
  pages={[
    { path: '/', label: 'Home' },
    { path: '/pricing', label: 'Pricing' },
  ]}
  realtime={broadcastChannelRealtime()}   // across tabs, no backend
  user={{ id: user.id, name: user.name }}
>
```

For people on different machines, swap the transport for
`sseRealtime({ endpoint: '/api/vedit/realtime' })` and add:

```ts
// app/api/vedit/realtime/route.ts
import { createRealtimeHandler } from 'vedit/server'
const relay = createRealtimeHandler({ authorize: (request) => isEditor(request) })
export { relay as GET, relay as POST }
```

---

## 10. Optional: let an agent design too

Everything the editor does is also reachable without it — useful for scripted
changes, and for handing a page to an AI agent.

```bash
claude mcp add vedit -- npx -y vedit-mcp --dir ./content
```

Point it at the same documents your adapter writes (`--dir` for files,
`--endpoint` for a deployed site's API). The agent works on the **draft**, so
nothing reaches visitors until someone publishes. Steps 3, 4 and 5 pay off here:
an agent can only change what has an id, it picks a declared variant rather than
inventing one, and with `--components manifest.json` — written at build time with
`componentManifest(registry)` — it can assemble a page out of your components and
no others.

The matching HTTP surface is one more route:

```ts
// app/api/vedit/[...path]/route.ts
import { createVeditApi } from 'vedit/api'
import { fileStore } from 'vedit/server'

const handle = createVeditApi({
  store: fileStore('./content'),
  authorize: (request, { write }) => isEditor(request, { write }),   // required
})
export { handle as GET, handle as PUT, handle as POST, handle as DELETE }
```

Full detail in [API.md](./API.md).

---

## Framework notes

**Next.js App Router** — the browser half of the bundle ships `'use client'`, so
you can use `<VeditProvider>` directly in `app/layout.tsx` even though that file
is a Server Component. Children pass through it normally.

**Next.js Pages Router** — wrap in `pages/_app.tsx`.

**Vite / CRA / Remix** — wrap wherever your app root is.

**Astro / islands** — the provider has to wrap the React tree you want to edit,
and the scanner only sees what is inside it. Islands that are separate React
roots each need their own provider, or wrap a single root around them.

**Static export / no server** — `localStorageAdapter()` keeps edits on one
machine; anything shared needs an endpoint.

---

## Things that will bite you

| Symptom | Cause |
| --- | --- |
| Editor opens on a grey canvas that never loads | The page refuses to be framed. `X-Frame-Options: DENY` or a `frame-ancestors` CSP. Allow same-origin framing, or pass `canvas={false}` to edit in place. |
| The editor never opens | `enabled` is false. Check your auth expression, or add `?vedit=1` on a staging build. |
| Edits vanish after a deploy | Ids moved. Scanner ids follow markup; wrap those elements in `<Editable>` with explicit ids. |
| Edits save but visitors don't see them | `staged: true` without pressing Publish, or the visitor is reading `published` while you saved a `draft`. |
| Styles don't apply | Something in your CSS uses `!important`. Overrides use high specificity, not `!important`. |
| A hover style does nothing | It was written at a breakpoint you aren't at. Check which breakpoint is selected in the toolbar. |
| Client state resets when the editor opens | Expected: the canvas loads the page fresh in a frame. `canvas={false}` avoids it. |

---

## Checklist

- [ ] Installed, `<VeditProvider>` wraps the app, `⌘E` opens the editor
- [ ] The elements that matter have explicit `<Editable>` ids
- [ ] Optional: components registered and a `<VeditSlot>` where pages get built
- [ ] Components with variants declare `fields`
- [ ] An adapter points at a real endpoint, with `authorize` on the handler
- [ ] `enabled` is wired to your own auth
- [ ] `initialDocument` is server-rendered, if the framework has a server
- [ ] Edited, published, and confirmed as a signed-out visitor
- [ ] Optional: `vedit/api` mounted with a real `authorize`, or `vedit-mcp`
      pointed at your documents
