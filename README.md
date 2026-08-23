# vedit

A Figma-like visual editor you drop into any React site.

Import one provider, open the editor with `⌘E`, and your pages become artboards on
a zoomable canvas: click straight into them to rewrite copy, swap images, restyle
hover states, re-order sections, change a component's variant, tune type and
spacing per breakpoint. Changes are saved as a small JSON document of
**overrides** — your components stay exactly as you wrote them.

```bash
npm install vedit
```

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
visitors download the runtime (a few KB) and nothing else.

---

## API

**Components**

- `<VeditProvider>` — `documentKey`, `adapter`, `enabled`, `defaultEditing`, `auto`, `autoSelector`, `breakpoints`, `initialDocument`, `canvas`, `pages`, `realtime`, `user`, `realtimeRoom`, `autosaveMs`, `onSave`
- `<Editable id as kind label container fields>` — the general case; renders any tag or component
- `<EditableText>` `<EditableImage>` `<EditableBox>` `<EditableLink>` — presets

**Hooks**

- `useVeditEditing()` → `[editing, setEditing]`, for your own "Edit page" button
- `useEditable({ id, kind, label, container, fields, props })` → `{ ref, veditProps, props, override }`
- `useVeditSession()` → `{ peers, comments, staleSince, session }` — build your own presence UI
- `useVeditState(selector)`, `useVeditStore()`, `useVeditNodes()` for deeper integration

**Utilities**

- `localStorageAdapter()`, `httpAdapter()`, `memoryAdapter()`
- `broadcastChannelRealtime()`, `sseRealtime()` — and `VeditRealtime` for your own
- `documentToCss(doc)` — the stylesheet for a document
- `parseTransform` / `withTransform`, `parseGradient` / `serializeGradient`
- `auditPage(nodes)`, `contrastRatio(fg, bg)` — the accessibility checks, usable in your own tests
- `vedit/server`: `createVeditHandler()`, `createRealtimeHandler()`, `fileStore()`, `veditStyleTag()`

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
  "inserted": []
}
```

Plain JSON: diff it, review it, commit it, or write it straight into your database.

---

## Choosing ids

Overrides are keyed on `id`, so an id that changes loses the edit. Name them after
the content, not the position:

```tsx
✅ <EditableText id="home.hero.title">
✅ <EditableText id={`product.${product.slug}.tagline`}>
❌ <EditableText id={`item-${index}`}>
```

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
- **Structural editing is limited to what the editor created.** You can duplicate,
  re-parent and delete inserted elements; you can't duplicate, wrap or unwrap
  elements that came from your code.
- **Links are inert while editing**, so you navigate between routes by putting
  them on the canvas as artboards rather than by clicking through.
- **The frames reload the page.** Client state (an open modal, a filled form, a
  scrolled carousel) resets when the editor opens, like any preview tool.
- **No locale variants.** One document per key; translations are your own layer.
- **No font loading.** The font list offers stacks the browser already has —
  loading a webfont is still a change to your code.
- **Scanner ids depend on DOM structure.** Wrap anything you care about long-term
  in `<Editable>`.

## Development

```bash
npm install
npm run build        # bundle to dist/
npm test             # build, then run the unit tests
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

## License

MIT
