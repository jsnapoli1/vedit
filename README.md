# vedit

A Figma-like visual editor you drop into any React site — and a page builder that
composes your own components.

Import one provider, open the editor with `⌘E`, and your pages become artboards on
a zoomable canvas: click straight into them to rewrite copy, swap images, restyle
hover states, re-order sections, change a component's variant, tune type and
spacing per breakpoint. Register your components and a `<VeditSlot>` becomes a
region people can build: place a Hero, configure it, add a pricing table, publish.

Everything is saved as a small JSON document — **overrides** on what your code
renders, and **placements** of components your code owns. Your components stay
exactly as you wrote them.

```bash
npm install github:jsnapoli1/vedit
```

Not on npm — the name is taken — so it installs from the repository, which builds
itself on install.

- **[INTEGRATING.md](./INTEGRATING.md)** — adding it to a site, step by step.
  Written to be followed or handed to a coding agent.
- **[API.md](./API.md)** — editing without the editor: the operations model, the
  open HTTP API, and the MCP server that lets an agent design.
- **[DEVELOPING.md](./DEVELOPING.md)** — working on the library itself:
  architecture, recipes, invariants, testing.
- **[CHANGELOG.md](./CHANGELOG.md)** — what changed, and what it means for a site
  that already uses this.
- **[ROADMAP.md](./ROADMAP.md)** — what stands between here and 1.0.

---

## Quick start

```tsx
import { VeditProvider, EditableText, EditableImage, EditableBox } from 'vedit'

export default function App() {
  return (
    <VeditProvider documentKey="marketing-home">
      <EditableBox id="home.hero" as="section" className="hero">
        <EditableText id="home.hero.title" as="h1">
          Ship the site your designer actually drew.
        </EditableText>
        <EditableText id="home.hero.body">
          No rebuild, no CMS migration, no ticket for a comma.
        </EditableText>
        <EditableImage id="home.hero.art" src="/hero.png" alt="" />
      </EditableBox>
    </VeditProvider>
  )
}
```

Press `⌘E` (or `Ctrl+E`) to open the editor. That's the whole integration — by
default overrides go to `localStorage` so you can try it before wiring a backend.

### Zero-markup mode

You don't have to wrap anything. `VeditProvider` scans the DOM by default
(`auto`, on unless you pass `auto={false}`) and makes headings, paragraphs, links,
buttons, images and layout containers selectable, giving them ids derived from
their position in the page.

Use it to get moving, and wrap the elements that matter in `<Editable>` when you
want ids that survive a refactor. Scanner ids look like `auto:#app>section>h1`;
they change if you restructure the markup around them. An explicit
`<Editable id="home.hero.title">` never does.

---

## Building pages, not just editing them

Register the components a page may be built from. They are ordinary React — the
schema next to them says which props a person may change, and nothing else about
them changes:

```tsx
import { defineComponents, VeditProvider, VeditSlot } from 'vedit'
import { Hero, FeatureRow, Pricing } from './blocks'

export const components = defineComponents({
  Hero: {
    component: Hero,
    group: 'Sections',
    description: 'A headline with an optional image.',
    fields: [
      { name: 'headline', type: 'text' },
      { name: 'align', type: 'select', options: ['left', 'center'] },
    ],
    defaults: { headline: 'A headline worth reading', align: 'left' },
  },
  FeatureRow: { component: FeatureRow, group: 'Sections', fields: [...] },
  Pricing: { component: Pricing, group: 'Sections', fields: [...] },
})

<VeditProvider components={components}>
  <Nav />
  <VeditSlot id="campaign.sections" as="main">
    <p>Nothing here yet.</p>
  </VeditSlot>
  <Footer />
</VeditProvider>
```

Open the editor, pick **Insert**, and the panel offers exactly those components.
Place one and it renders through your code — your CSS, your behaviour, your
accessibility — with its props in the inspector and everything else the editor
does (styling, breakpoints, states, comments) available on top.

- **A whole page** is a slot with nothing around it.
- **A section of an existing page** is a slot in the middle of hand-written JSX.
- **A layout component** (`container: true`) holds whatever is placed inside it,
  as its `children`.

By default the editor wraps a placed component in an element it owns, so nothing
in your component has to know about any of this. Set `wrap: false` when the
component spreads the props it is handed onto its own root and you'd rather not
have the extra element.

A component the registry no longer has — renamed, deleted, not registered on this
page — renders a placeholder saying which name is missing. Content outlives code;
losing someone's page because a component moved is the wrong answer.

Placed components are still pages: with the DOM scanner on, the heading inside a
Hero can be clicked and rewritten like any other element, and the override is
stored against that instance. Configure through props where the component offers
them; reach past them when you need to.

---

## The canvas

Opening the editor loads your pages into same-origin frames and lays them out as
artboards you can zoom and pan, with the panels floating around them rather than
on top of them.

- **Zoom** — `⌘`/`Ctrl` + scroll, trackpad pinch, or the toolbar's `−` `100%` `+`.
  `⇧1` fits everything to the screen.
- **Pan** — scroll, or hold `Space` and drag (or pick the hand tool, `H`).
- **Each page is one artboard**, not a scrolling window, so zooming out shows the
  footer and the hero at the same time.
- **Breakpoints are real.** Every frame has its own viewport, so picking `sm`
  narrows the artboards and *your own media queries fire*. Drag the right edge to
  any width and the toolbar follows along to the breakpoint you've landed in.

### Several pages at once

```tsx
<VeditProvider
  pages={[
    { path: '/', label: 'Home' },
    { path: '/pricing', label: 'Pricing' },
    { path: '/blog', label: 'Blog' },
  ]}
>
```

Each artboard loads its own route and edits its own document. Click into one and
the panels follow it; the toolbar offers **Save all** when more than one has
unsaved work, and closing the editor warns about every artboard, not just the one
you were last in.

The frames are same-origin, so the editor talks to the pages directly — no message
passing, no proxy, no separate preview server. If a page can't be framed (a strict
`X-Frame-Options`, say) the editor notices and falls back to editing it in place,
with the panels floating over the page. `canvas={false}` picks that mode outright.

---

## What you can edit

| Area | Controls |
| --- | --- |
| **Content** | Text (inline on the page, or in the panel), rich text via `⌘B`/`⌘I`/`⌘U`, link destination and target |
| **Component props** | Whatever your components declare — variants, sizes, booleans, numbers, colors (see below) |
| **Layout** | Display, flex direction / justify / align / wrap / gap, grid columns, width, height, min/max width, padding and margin per side |
| **Typography** | Font stack, size, weight, leading, tracking, alignment, transform, decoration, color |
| **Appearance** | Solid fill or a gradient with editable stops, corner radius, border, opacity, shadow presets, rotation, scale, transitions |
| **Interaction states** | The same controls again for `hover`, `focus` and `active` |
| **Images** | Source, upload, asset library, alt text, object-fit, drag-to-set focal point, aspect-ratio crop |
| **Position** | In flow or free; drag to re-order among siblings, drag freely when detached, resize with handles |
| **Structure** | Hide/show anything, add text/images/boxes inside containers, duplicate, re-parent and delete what you added |
| **Together** | Live cursors, peer selections, comment threads pinned to elements |
| **Escape hatch** | A raw CSS box per element, for anything the panels don't cover |

Every one of those can be scoped to a breakpoint: pick `sm`/`md`/`lg`/`xl` in the
toolbar and your next change only applies from that width up. Overrides are
emitted as a real stylesheet — with real media queries and real `:hover` rules —
so the result behaves the same for a visitor as it does in the editor.

### Interaction states

Pick **Hover**, **Focus** or **Active** at the top of the inspector and everything
below writes into that state. The editor also forces the state on in the page
while you're in it, so you can style a hover without keeping the pointer still —
it emits `:hover` and a `[data-vedit-force="hover"]` twin of every rule.

Reach for a transition under Appearance to make the change ease rather than snap.

### Design tokens

The **Tokens** tab holds the site's shared values — brand colors, spacing steps,
font stacks, shadows. Any color or length field has a chip on the end to link it
to a token, or to promote the value you just typed into one. Change the token and
every element referencing it changes.

Tokens are published as CSS custom properties on `:root`, so your own stylesheets
can use them too:

```css
.promo { border-color: var(--vedit-brand); }
```

### Component props

The one part of the inspector your own code defines. Declare which props are
editable and the editor offers exactly those choices — a variant list, not a
free-text field:

```tsx
import { useEditable, type EditableField } from 'vedit'

const FIELDS: EditableField[] = [
  { name: 'variant', label: 'Style', type: 'select', options: ['solid', 'outline', 'ghost'] },
  { name: 'size', type: 'select', options: ['sm', 'md', 'lg'] },
  { name: 'fullWidth', type: 'boolean' },
  { name: 'icon', type: 'text', help: 'Any emoji, shown before the label.' },
]

function Button({ id, children, ...source }) {
  const { ref, veditProps, props } = useEditable({
    id,
    kind: 'component',
    fields: FIELDS,
    props: { variant: 'solid', size: 'md', ...source },
  })

  return (
    <button ref={ref} {...veditProps} className={`btn btn-${props.variant} btn-${props.size}`}>
      {props.icon} {children}
    </button>
  )
}
```

`props` is your values with the editor's overrides layered on top; render with it.
Field types: `text`, `textarea`, `number`, `boolean`, `select`, `color`, `image`,
`link`. `<Editable fields={…}>` works the same way for plain elements.

### Moving things

Dragging does whatever is honest for where the element sits, and the inspector's
**Position** row says which before you start:

| The element | Dragging it |
| --- | --- |
| In flow, inside a flex or grid parent | **Re-orders** it among its siblings, with a drop indicator. Written as `order`, so the layout stays a layout. |
| Switched to **Free** | Moves it by `left`/`top`. The editor seeds its current geometry when you detach it, so nothing jumps. |
| In flow, inside a block parent | **Nudges** it with a `transform` offset — a visual tweak that leaves the layout untouched, because CSS has no way to re-order block children. The inspector says so, and offers to make the parent a flex column, which does allow re-ordering. |

### Several elements at once

Shift-click to add to the selection. The inspector shows the last element you
clicked and writes to all of them; fields where the selection disagrees read
**Mixed**. Content and component props stay single-element — those rarely mean the
same thing across a group.

### Working together

Pass a `realtime` transport and the editor becomes multiplayer: you see who else
is here, where their pointer is, what they have selected, and their changes as
they make them.

```tsx
import { VeditProvider, broadcastChannelRealtime } from 'vedit'

<VeditProvider
  realtime={broadcastChannelRealtime()}   // across tabs, no backend needed
  user={{ id: user.id, name: user.name }} // yours; otherwise everyone is an anonymous animal
>
```

- **Presence** — a cursor with a name, an outline in their colour around whatever
  they have selected, and an avatar row in the toolbar. Someone on another page
  shows in the avatars with their route, not as a cursor on yours.
- **Live changes** merge per node, last write wins. Two people restyling different
  elements both keep their work; two people restyling the same one resolve to
  whoever finished last. That's the honest guarantee without a CRDT underneath,
  and it covers the way teams actually divide a page up.
- **Undo stays yours.** A change arriving from someone else is merged into your
  history as well as your document, so stepping back undoes your last action —
  never theirs.
- **Save conflicts are visible.** If someone saves after you loaded, the editor
  says so before you replace their version, and offers to load theirs.

For people on different machines, swap the transport:

```tsx
import { sseRealtime } from 'vedit'

realtime={sseRealtime({ endpoint: '/api/vedit/realtime' })}
```

```ts
// app/api/vedit/realtime/route.ts
import { createRealtimeHandler } from 'vedit/server'

const relay = createRealtimeHandler({ authorize: (request) => isEditor(request) })
export { relay as GET, relay as POST }
```

Server-sent events down, `POST` up — no WebSocket server, so it runs wherever
your overrides endpoint already does. Rooms live in that process's memory, which
is plenty for a team and exactly where you'd swap the fan-out for Redis, a
Durable Object or your own bus. `VeditRealtime` is two methods, so anything that
moves JSON — a WebSocket, Ably, Liveblocks, PartyKit — can back it instead.

### Comments

Press `C` and click anywhere to leave a note. A note dropped on an element stores
its position as a fraction of that element's box, so it stays on the thing it is
about when the element moves, resizes, or reflows at another breakpoint.

Threads take replies, resolve and reopen, and appear both as pins on the page and
as a list in the **Notes** tab. They travel over the same transport as presence,
so they show up for everyone immediately; add `listComments` / `saveComment` /
`deleteComment` to your adapter to keep them beyond the session.

Comments live outside the document, so they never publish with your content.

### Checks

The **Checks** tab audits the page as it stands, re-running shortly after every
change so a mistake surfaces while the decision is still fresh:

- contrast ratios against the real composited background, at WCAG AA thresholds
- images with no alt attribute
- links and buttons with no accessible name
- heading levels that skip, and pages with no `h1`
- vague link text and text below about 12px

Click an issue to select the element that caused it.

---

## Keyboard

| | |
| --- | --- |
| `⌘E` | Open / close the editor |
| `V` `H` `C` `T` `I` `R` | Select, pan, comment, add text, add image, add box |
| `⌘`/`Ctrl` + scroll, `⇧1` | Zoom, fit to screen |
| `Space` + drag | Pan the canvas |
| `Enter` / double-click | Edit text in place |
| `Esc` | Cancel inline edit, then select the parent, then clear the selection |
| `⌫` | Hide the selected element (delete, if you added it) |
| Arrows / `⇧`+arrows | Nudge by 1px / 10px |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘S` | Save |
| `\` | Hide the panels |
| `Tab` | Move through the chrome — the toolbar, then the panels |
| Arrows in a panel | Move through the layers tree or the panel tabs |

Opening the editor puts focus on the toolbar and closing it gives focus back, so
the whole thing can be driven without a mouse. Modified shortcuts work wherever
focus is; the single-letter ones belong to a focused field while it has focus.

---

## Saving somewhere real

`VeditProvider` takes an **adapter**. Three ship with the library, and the
interface is two required methods if you want your own.

```tsx
import { VeditProvider, httpAdapter } from 'vedit'

<VeditProvider
  pages={pages}
  adapter={httpAdapter({
    endpoint: 'https://cms.example.com/api/vedit',
    uploadEndpoint: 'https://cms.example.com/api/vedit/upload',
    assetsEndpoint: 'https://cms.example.com/api/vedit/assets',
    headers: () => ({ authorization: `Bearer ${getToken()}` }),
    staged: true,
  })}
  enabled={user.canEditSite}
  autosaveMs={2000}
>
```

The matching server is one function, built on the Fetch API so it runs on
Next.js route handlers, Remix, Hono, Workers, Deno or Bun:

```ts
// app/api/vedit/route.ts
import { createVeditHandler, fileStore } from 'vedit/server'

const handle = createVeditHandler({
  store: fileStore('./content'),             // or your own read/write pair
  authorize: (request) => isEditor(request),  // required in production
})

export { handle as GET, handle as PUT, handle as POST }
```

`fileStore` writes JSON files; swap in your own store backed by Postgres, S3, KV
or whatever you already run. One service can serve every site you own — the
document key is yours to shape (`"acme:/pricing"`, `"blog:home"`, …).

### Drafts, publishing and history

With `staged: true` (and a server that supports it — `createVeditHandler` does)
the editor keeps a draft apart from what visitors see:

- **Save draft** stores your work without changing the live site.
- **Publish** makes the current draft the version visitors get.
- The **History** tab lists every save, marks the live one, and restores any of
  them into the editor for review before you publish again.

Without staging, Save writes straight to the one document and the publish button
never appears.

### Custom adapter

```ts
const adapter = {
  async load(key, { stage } = {}) { … },        // required
  async save(doc) { … },                        // required
  async publish(doc) { … },                     // enables Publish
  async listVersions(key) { … },                // enables History
  async loadVersion(key, id) { … },
  async uploadImage(file) { … },                // enables Upload
  async listAssets() { … },                     // enables the image library
  async listComments(key) { … },                // keeps comments beyond the session
  async saveComment(comment) { … },
  async deleteComment(id) { … },
}
```

Everything past `save` is optional; the editor hides what an adapter can't do.
Without `uploadImage`, picking a local image inlines it as a data URL — handy for
a quick look, not something to save into production content.

---

## Server rendering

Pass the saved document in, and the first paint already has the edits — no flash
of the original design:

```tsx
const doc = await store.read('marketing-home')

<VeditProvider documentKey="marketing-home" initialDocument={doc}>
```

For non-React server frameworks, `veditStyleTag(doc)` from `vedit/server` returns
the `<style>` tag to drop in your `<head>`.

## Who gets the editor

The editor is off for visitors. It becomes available when any of these is true:

- `enabled` is passed explicitly (wire it to your own auth — use this in production)
- the URL carries `?vedit=1`
- the site is running on `localhost` or a development build

The editor UI is loaded with a dynamic import the first time someone opens it, so
visitors download the runtime (~16KB) and nothing else. (That split needs ESM;
a CJS consumer gets the whole thing, editor included.)

---

## API

**Components**

- `<VeditProvider>` — `documentKey`, `adapter`, `enabled`, `defaultEditing`, `auto`, `autoSelector`, `breakpoints`, `initialDocument`, `canvas`, `pages`, `realtime`, `user`, `realtimeRoom`, `autosaveMs`, `onSave`
- `<Editable id as kind label container fields>` — the general case; renders any tag or component
- `<EditableText>` `<EditableImage>` `<EditableBox>` `<EditableLink>` — presets
- `<VeditSlot id as label>` — a region whose contents live in the document
- `defineComponents({...})` / `defineComponent({...})` — the components a page may be built from
- `componentManifest(registry)` — the same list without the components, for the API and MCP

**Hooks**

- `useVeditEditing()` → `[editing, setEditing]`, for your own "Edit page" button
- `useEditable({ id, kind, label, container, fields, props })` → `{ ref, veditProps, props, override }`
- `useVeditSession()` → `{ peers, comments, staleSince, session }` — build your own presence UI
- `useVeditState(selector)`, `useVeditStore()`, `useVeditNodes()` for deeper integration

**Utilities**

- `localStorageAdapter()`, `httpAdapter()`, `memoryAdapter()`
- `broadcastChannelRealtime()`, `sseRealtime()` — and `VeditRealtime` for your own
- `documentToCss(doc)` — the stylesheet for a document
- `applyOperations(doc, ops)`, `describeDocument(doc)` — change and summarise a
  document without the editor
- `migrateDocument(raw)`, `inspectDocument(raw)` — bring a stored document to the
  shape this build expects

**Entry points**

| | |
| --- | --- |
| `vedit` | The supported API — everything above |
| `vedit/server` | `createVeditHandler()`, `createRealtimeHandler()`, `fileStore()`, `veditStyleTag()` |
| `vedit/api` | `createVeditApi()`, `remoteStore()` — the open HTTP API. See [API.md](./API.md) |
| `vedit/mcp` | `createVeditMcpServer()`, `serveStdio()`, `createMcpHandler()`, `notifyEditors()` |
| `vedit/internal` | The library's own workings — the layer matrix, the scanner, the sanitizers, `auditPage`, the transform and gradient parsers. **Not supported**: these can change in a minor release |

**Designing with an agent**

```bash
claude mcp add vedit -- npx -y vedit-mcp --dir ./content
```

16 MCP tools over the same documents the editor writes: read what a page
overrides, restyle it, add a section, check the CSS it would produce, publish it.
Edits land on the draft, so an agent proposes and a person publishes. Full detail
in [API.md](./API.md).

**The document**

```jsonc
{
  "version": 1,
  "key": "marketing-home",
  "updatedAt": "2026-08-23T12:00:00.000Z",
  "tokens": [{ "id": "brand", "name": "Brand", "kind": "color", "value": "#4f46e5" }],
  "nodes": {
    "home.hero.title": {
      "text": "Ship the site your designer actually drew.",
      "style": { "fontSize": "48px", "color": "var(--vedit-brand)" },
      "responsive": { "lg": { "fontSize": "72px" } },
      "states": { "hover": { "style": { "color": "#000" } } }
    },
    "home.hero.cta": { "props": { "variant": "outline", "size": "lg" } }
  },
  "inserted": [
    { "id": "campaign.sections::added-7f2", "parentId": "campaign.sections",
      "kind": "component", "component": "Hero", "index": 0 }
  ]
}
```

Plain JSON: diff it, review it, commit it, or write it straight into your database.

`version` is the document format, not the package version. It is read on every
load and migrated forward, so a document saved by an older build keeps working
and one saved by a newer build is not quietly reshaped.

---

## Choosing ids

Overrides are keyed on `id`, so an id that changes loses the edit. Name them after
the content, not the position:

```tsx
✅ <EditableText id="home.hero.title">
✅ <EditableText id={`product.${product.slug}.tagline`}>
❌ <EditableText id={`item-${index}`}>
```

## When it breaks

Everything this library renders sits behind an error boundary, so a failure
inside the editor unmounts the editor — not the page it was opened on. The
visitor sees a short notice with **Reopen** and **Dismiss**; you get the error
through `onError`:

```tsx
<VeditProvider onError={(error, { part }) => reportToSentry(error, { part })}>
```

## Security

The overrides document is data, and it is rendered into every visitor's page.
Treat it as only as trustworthy as whoever can write to your store:

- **Authorize writes.** `createVeditHandler` accepts an `authorize` callback and
  has no opinion without one. So does `createRealtimeHandler`.
- Style values and token names are stripped of anything that could end a rule or
  leave the `<style>` element; property names that aren't property names are
  dropped.
- `href` and `src` overrides refuse `javascript:`, `vbscript:` and `data:` URLs.
  Inline images are allowed for `src` only, where an SVG's scripts never run.
- Rich text keeps a small formatting whitelist and loses everything else.
- `target="_blank"` gets `rel="noopener noreferrer"` unless you set `rel` yourself.

`safeUrl` and `sanitizeHtml` are exported if you want to apply the same rules to
content of your own.

## Known limits

- **Merging is per node, not per character.** Two people typing into the same
  headline at the same time resolve to whoever stopped last, rather than
  interleaving. Different elements never conflict.
- **The relay is single-process.** `createRealtimeHandler` fans out from memory,
  so several server instances don't see each other's rooms until you swap the
  fan-out for something shared.
- **Re-ordering needs a flex or grid parent.** Block children fall back to a
  nudge (with a one-click offer to convert the parent), because CSS `order`
  doesn't apply to them and the library never rewrites your DOM.
- **Structural editing is limited to what the editor created.** Inside a slot you
  can place, re-order, nest and delete freely; elements that came from your JSX
  can be re-ordered and hidden, but not duplicated, wrapped or unwrapped.
- **Placement is by click, not by drag.** The Insert panel puts a component into
  the selected container, and the inspector moves it up and down. Dragging a
  component from the panel onto the canvas is not there yet.
- **Links are inert while editing**, so you navigate between routes by putting
  them on the canvas as artboards rather than by clicking through.
- **The frames reload the page.** Client state (an open modal, a filled form, a
  scrolled carousel) resets when the editor opens, like any preview tool.
- **No locale variants.** One document per key; translations are your own layer.
- **No font loading.** The font list offers stacks the browser already has —
  loading a webfont is still a change to your code.
- **Scanner ids depend on DOM structure.** Wrap anything you care about long-term
  in `<Editable>`.
- **Inspector fields aren't announced by name.** They can be reached and used
  from a keyboard, but their labels are visual rather than `<label>` elements, so
  a screen reader reads the control without its name.

## Development

```bash
npm install
npm run build        # bundle to dist/
npm test             # build, then run the unit tests
npm run test:e2e     # browser tests, including screenshot baselines
npm run typecheck

cd example && npm install && npm run dev   # demo site at localhost:5173
                                           # ?mode=overlay edits in place instead
```

The example under `example/` is a two-page marketing site that uses explicit
`<Editable>` wrappers, a component with editable props, the DOM scanner, and an
adapter implementing drafts, publishing, version history, comments and an image
library — all on `localStorage`. It resolves `vedit` straight to the source, so
edits to the library show up instantly.

Open it twice with `?as=Sam` and `?as=Alex` to see presence and comments across
two tabs. `node example/realtime-server.mjs` starts the SSE relay, and `?rt=sse`
points the demo at it instead of the cross-tab channel — the same path two people
on two machines would take.

### Tests

- `npm test` — the document model, migration, the operations vocabulary, the CSS
  emitter, the session, the relay, the open API, the MCP server and the escaping
  rules, run against the built bundle rather than the sources.
- `npm run test:e2e` — the editor in a real browser: selection, breakpoints,
  states, component props, re-ordering, publishing, two people collaborating,
  driving the whole thing from a keyboard, and what happens when the editor
  throws.
- The same run holds screenshot baselines for the chrome, plus layout invariants
  (nothing covers the toolbar, no fixed label is clipped, the panels leave room
  for the artboards) that hold on any machine. Regenerate the images with
  `npm run test:e2e:update` when a change to the chrome is intended.

The browser is pinned by the `@playwright/test` version and CI runs the suite in
the matching container, because a pixel comparison is only meaningful when the
browser build and the fonts are the same on both sides.

## License

MIT
