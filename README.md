# vedit

A Figma-like visual editor you drop into any React site.

Import one provider, open the editor with `⌘E`, and your page becomes an artboard
on a zoomable canvas: click straight into it to rewrite copy, swap images, drag
handles to resize, re-order sections, tune type and spacing per breakpoint, add
new elements. Changes are saved as a small JSON document of **overrides** — your
components stay exactly as you wrote them.

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

Press `⌘E` (or `Ctrl+E`) to open the editor. That's the whole integration —
by default overrides go to `localStorage` so you can try it before wiring a backend.

## The canvas

Opening the editor loads your page into a same-origin frame and puts it on a
canvas you can zoom and pan, with the panels floating around it rather than on
top of it.

- **Zoom** — `⌘`/`Ctrl` + scroll, trackpad pinch, or the toolbar's `−` `100%` `+`.
  `⇧1` fits the artboard to the screen.
- **Pan** — scroll, or hold `Space` and drag (or pick the hand tool, `H`).
- **The whole page is one artboard**, not a scrolling window, so zooming out shows
  the footer and the hero at the same time.
- **Breakpoints are real.** The frame has its own viewport, so picking `sm` narrows
  the artboard and *your own media queries fire*. Drag the artboard's right edge to
  any width and the toolbar follows along to the breakpoint you've landed in.

The frame is same-origin, so the editor talks to the page directly — no message
passing, no proxy, no separate preview server. If a page can't be framed (a strict
`X-Frame-Options`, say) the editor notices and falls back to editing it in place,
with the panels floating over the page as before. `canvas={false}` picks that mode
outright.

### Zero-markup mode

You don't have to wrap anything. `VeditProvider` scans the DOM by default
(`auto`, on unless you pass `auto={false}`) and makes headings, paragraphs, links,
buttons, images and layout containers selectable, giving them ids derived from
their position in the page.

Use it to get moving, and wrap the elements that matter in `<Editable>` when you
want ids that survive a refactor. Scanner ids look like
`auto:#app>section>h1`; they change if you restructure the markup around them.
An explicit `<Editable id="home.hero.title">` never does.

---

## What you can edit

| Area | Controls |
| --- | --- |
| **Content** | Text (inline on the page, or in the panel), rich text via `⌘B`/`⌘I`/`⌘U`, image source + upload + alt + object-fit, link destination and target |
| **Layout** | Display, flex direction / justify / align / wrap / gap, grid columns, width, height, min/max width, padding and margin per side |
| **Typography** | Font stack, size, weight, line height, letter spacing, alignment, transform, decoration, color |
| **Appearance** | Fill, corner radius, border width / color / style, opacity, shadow presets |
| **Escape hatch** | A raw CSS box per element, for anything the panels don't cover |
| **Position** | In flow or free; drag to re-order among siblings, drag freely when detached, resize with handles |
| **Structure** | Hide/show any element, add text, images and boxes inside containers |

Every one of those can be scoped to a breakpoint: pick `sm`/`md`/`lg`/`xl` in
the toolbar and your next change only applies from that width up. Overrides are
emitted as a real stylesheet with real media queries, so the result behaves the
same for a visitor as it does in the editor.

### Moving things

Dragging does whatever is honest for where the element sits, and the inspector's
**Position** row says which before you start:

| The element | Dragging it |
| --- | --- |
| In flow, inside a flex or grid parent | **Re-orders** it among its siblings, with a drop indicator. Written as `order`, so the layout stays a layout. |
| Switched to **Free** | Moves it by `left`/`top`. The editor seeds its current geometry when you detach it, so nothing jumps. |
| In flow, inside a block parent | **Nudges** it with a `transform` offset — a visual tweak that leaves the surrounding layout untouched, because CSS has no way to re-order block children. The inspector says so, and offers a one-click reset. |

Arrow keys nudge by 1px, `⇧`+arrows by 10px, and move a free element by its real
position.

## Keyboard

| | |
| --- | --- |
| `⌘E` | Open / close the editor |
| `V` `H` `T` `I` `R` | Select, pan, add text, add image, add box |
| `⌘`/`Ctrl` + scroll, `⇧1` | Zoom, fit to screen |
| `Enter` / double-click | Edit text in place |
| `Esc` | Cancel inline edit, then select the parent, then clear the selection |
| `⌫` | Hide the selected element (delete, if you added it) |
| Arrows / `⇧`+arrows | Nudge by 1px / 10px |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘S` | Save |
| `Space` + drag | Pan the canvas |
| `\` | Hide the panels |

---

## Saving somewhere real

`VeditProvider` takes an **adapter**. Three ship with the library, and the
interface is three methods if you want your own.

```tsx
import { VeditProvider, httpAdapter } from 'vedit'

<VeditProvider
  documentKey={`${siteId}:${pathname}`}
  adapter={httpAdapter({
    endpoint: 'https://cms.example.com/api/vedit',
    uploadEndpoint: 'https://cms.example.com/api/vedit/upload',
    headers: () => ({ authorization: `Bearer ${getToken()}` }),
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
  store: fileStore('./content'),            // or your own read/write pair
  authorize: (request) => isEditor(request), // required in production
})

export { handle as GET, handle as PUT }
```

`fileStore` writes JSON files; swap in `{ read, write }` backed by Postgres, S3,
KV or whatever you already run. One service can serve every site you own — the
document key is yours to shape (`"acme:/pricing"`, `"blog:home"`, …).

### Custom adapter

```ts
const adapter = {
  async load(key) { return db.overrides.findUnique({ where: { key } }) },
  async save(doc) { await db.overrides.upsert({ where: { key: doc.key }, ... }) },
  async uploadImage(file) { return uploadToS3(file) },  // optional
}
```

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

For non-React server frameworks, `veditStyleTag(doc)` from `vedit/server`
returns the `<style>` tag to drop in your `<head>`.

## Who gets the editor

The editor is off for visitors. It becomes available when any of these is true:

- `enabled` is passed explicitly (wire it to your own auth — this is the one to use in production)
- the URL carries `?vedit=1`
- the site is running on `localhost` or a development build

The editor UI is loaded with a dynamic import the first time someone opens it, so
visitors download the runtime (a few KB) and nothing else.

---

## API

**Components**

- `<VeditProvider>` — `documentKey`, `adapter`, `enabled`, `defaultEditing`, `auto`, `autoSelector`, `breakpoints`, `initialDocument`, `canvas`, `autosaveMs`, `onSave`
- `<Editable id as kind label container>` — the general case; renders any tag or component
- `<EditableText>` `<EditableImage>` `<EditableBox>` `<EditableLink>` — presets

**Hooks**

- `useVeditEditing()` → `[editing, setEditing]`, for your own "Edit page" button
- `useEditable({ id, kind, label, container })` → `{ ref, veditProps, override }` for custom components
- `useVeditState(selector)`, `useVeditStore()`, `useVeditNodes()` for deeper integration

**Utilities**

- `localStorageAdapter()`, `httpAdapter()`, `memoryAdapter()`
- `documentToCss(doc)` — the stylesheet for a document
- `vedit/server`: `createVeditHandler()`, `fileStore()`, `veditStyleTag()`

**The document**

```jsonc
{
  "version": 1,
  "key": "marketing-home",
  "updatedAt": "2026-08-23T12:00:00.000Z",
  "nodes": {
    "home.hero.title": {
      "text": "Ship the site your designer actually drew.",
      "style": { "fontSize": "48px" },
      "responsive": { "lg": { "fontSize": "72px" } }
    }
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

- **One page at a time.** The canvas holds a single artboard; there's no board of
  every page side by side, and no navigating between routes inside the frame
  (links are inert while editing, by design).
- **Re-ordering needs a flex or grid parent.** Block children fall back to a nudge,
  because CSS `order` doesn't apply to them and the library never rewrites your DOM.
- **No component-level editing.** You can restyle what a component rendered; you
  can't change its props, swap a variant, or bind it to data.
- **No multi-select editing.** You can shift-click several elements, but the
  inspector only edits one at a time.
- **The frame reloads the page.** Client state (an open modal, a filled form,
  a scrolled carousel) resets when the editor opens, like any preview tool.
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

The example under `example/` is a small marketing page that uses both explicit
`<Editable>` wrappers and the DOM scanner, and resolves `vedit` straight to the
source so edits to the library show up instantly.

## License

MIT
