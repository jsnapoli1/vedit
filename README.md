# vedit

A Figma-like visual editor you drop into any React site.

Import one provider, open the editor with `⌘E`, and click straight into the page:
rewrite copy, swap images, drag handles to resize, tune type and spacing per
breakpoint, add new elements. Changes are saved as a small JSON document of
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

Press `⌘E` (or `Ctrl+E`) to open the editor. That's the whole integration —
by default overrides go to `localStorage` so you can try it before wiring a backend.

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
| **Structure** | Hide/show any element, add text, images and boxes inside containers, drag to nudge, resize with handles |

Every one of those can be scoped to a breakpoint: pick `sm`/`md`/`lg`/`xl` in
the toolbar and your next change only applies from that width up. Overrides are
emitted as a real stylesheet with real media queries, so the result behaves the
same for a visitor as it does in the editor.

## Keyboard

| | |
| --- | --- |
| `⌘E` | Open / close the editor |
| `V` `T` `I` `R` | Select, add text, add image, add box |
| `Enter` / double-click | Edit text in place |
| `Esc` | Cancel inline edit, then clear selection |
| `⌫` | Hide the selected element (delete, if you added it) |
| Arrows / `⇧`+arrows | Nudge by 1px / 10px |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘S` | Save |
| `\` | Hide the panels to reach what's underneath |

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

- `<VeditProvider>` — `documentKey`, `adapter`, `enabled`, `defaultEditing`, `auto`, `autoSelector`, `breakpoints`, `initialDocument`, `autosaveMs`, `onSave`
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

- Panels float above the page rather than insetting it, so they can cover content —
  press `\` to hide them. (An iframe canvas that insets the page properly is the
  next big piece of work.)
- Selecting a breakpoint chooses which bucket your edits go into; it doesn't resize
  the page. Resize the window to see a breakpoint live — the toolbar dims the
  breakpoints that aren't currently active.
- Dragging moves an element with a `transform` offset rather than reordering it in
  its parent. Reordering is not implemented yet.
- Scanner ids depend on DOM structure. Wrap anything you care about long-term.

## Development

```bash
npm install
npm run build        # bundle to dist/
npm test             # build, then run the unit tests
npm run typecheck

cd example && npm install && npm run dev   # demo site at localhost:5173
```

The example under `example/` is a small marketing page that uses both explicit
`<Editable>` wrappers and the DOM scanner, and resolves `vedit` straight to the
source so edits to the library show up instantly.

## License

MIT
