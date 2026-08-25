# Working on vedit

For people changing the library itself. If you only want to add it to a site,
read [INTEGRATING.md](./INTEGRATING.md) instead.

```bash
npm install
npm run build          # bundle to dist/
npm test               # build, then the unit tests
npm run test:e2e       # the editor in a real browser
npm run typecheck

cd example && npm install && npm run dev   # the demo site the tests drive
```

The example at `example/` is not a toy: the e2e suite runs against it, so it
doubles as the fixture. It resolves `vedit` to `src/` through a Vite alias, so
library changes show up without rebuilding.

---

## The one idea

**The product is a JSON document.** It says two things: what to override on the
UI your code already renders, and which of your registered components to place
inside the slots you opened. Everything else — the canvas, the panels, the
collaboration, the API — is a way to produce that document or a way to apply it.

```
your components  ─┐
                  ├─►  the page a visitor sees
document.json    ─┘    (a stylesheet + swapped text/props, and components placed in slots)
```

The library never rewrites your components, never touches your DOM structure,
and never persists anything except that document. Any change that would break
one of those is a change to what this library *is* — worth doing deliberately,
not by accident.

---

## Repo map

```
src/
  core/            everything that has no opinion about the editor UI
    types.ts       the document, the adapter, the node model
    layers.ts      the state × breakpoint matrix — the only file that knows its shape
    migrate.ts     bringing a stored document to the shape this build expects
    operations.ts  every change to a document as data — the API and MCP speak this
    registry.ts    the components a page may be built from, and their schema
    store.ts       an observable document with undo/redo and persistence
    context.tsx    VeditProvider: store, config, guards, lazy editor mount
    canvas.ts      the parent ↔ artboard handshake
    session.ts     presence, comments, per-node merge
    realtime.ts    the wire protocol (no transport, no editor)
    ErrorBoundary.tsx
    adapters/      localStorage, http, memory, broadcast, sse

  components/      what a host site imports
    Editable.tsx   the general case, plus rendering placed components
    Slot.tsx       VeditSlot: a region whose contents live in the document
    presets.tsx    EditableText / Image / Box / Link
    useEditable.ts registration + prop merging

  auto/            the DOM scanner for unwrapped elements
  runtime/         pure functions: css, transform, gradient, sanitize

  editor/          the chrome. Lazily imported, never in a visitor's bundle
    mount.tsx      canvas or overlay, with the fallback
    canvas/        the pan/zoom artboards
    target.tsx     "which document am I editing, and where is it on screen"
    interactions.ts every page-level gesture
    Overlay/Presence/CommentsLayer   things drawn over the page
    panels/        toolbar, layers, insert, inspector, tokens, checks, notes, history
    a11y.ts        the contrast and structure checks

  server.ts          vedit/server: document handler, file store, SSR helper
  realtime-server.ts the SSE relay
  api.ts             vedit/api: the open HTTP surface, and a client for it
  mcp.ts             vedit/mcp: the same vocabulary as MCP tools
  index.ts           the supported API
  internal.ts        the rest, exported and explicitly unsupported
```

Rough sizes: `core` 2.3k lines, `editor` 5k, everything else under 900. The
editor is the big half, and it is the half a visitor never downloads.

---

## Three decisions that explain the rest

### 1. Overrides are emitted as CSS, not inline styles

`runtime/css.ts` turns the document into a stylesheet. Inline styles would have
been simpler and are wrong here: they can't express a media query or a `:hover`,
and they make server rendering and client rendering disagree.

Specificity is bought by repeating the attribute selector rather than with
`!important`, so a host site can still override the override if it means to:

```css
[data-vedit-id="x"][data-vedit-id="x"]{ font-size:48px }                      /* base  */
[data-vedit-id="x"][data-vedit-id="x"][data-vedit-id="x"]:hover{ … }          /* state */
@media (min-width:1024px){ [data-vedit-id="x"]×4{ … } }                       /* both  */
```

Every state rule is emitted twice — once as `:hover`, once as
`[data-vedit-force="hover"]` — so the inspector can hold a state on while you
style it.

**Consequence**: a style value is untrusted text going into a `<style>` element.
`declarations()` strips anything that could end a rule or leave the element, and
property names are validated. Don't route around it.

### 2. Overrides live in a state × breakpoint matrix

```ts
NodeOverride = {
  style, responsive: { sm, md, lg, xl },        // the default state
  states: { hover: { style, responsive }, focus: …, active: … },
  text, html, src, href, props, hidden, className,
}
```

`core/layers.ts` is the only module that knows this shape — `readStyles`,
`mergeStyles`, `replaceStyles`, `deleteStyles`, `pruneOverride`. The store and
the inspector talk in terms of "the cell the user is currently editing"
(`store.cell`, from `state.styleState` and `state.breakpoint`).

**If you add another axis** — a print variant, a theme — add it in `layers.ts`
and the rest mostly follows. If you find yourself reaching into
`override.states.hover.responsive.md` anywhere else, that's the smell.

### 3. There is one vocabulary for changing a document

`core/operations.ts` is every possible change as data — `set-styles`,
`set-content`, `insert-node`, `set-token`. The editor drives `VeditStore`
directly, because it also has a selection, an undo stack and a page to point at.
Everything without a browser drives operations: the HTTP API, the MCP server, a
script, a test.

**Consequence**: a new kind of change belongs in `operations.ts` first, and in the
inspector second. Adding it only to the editor means an agent can't do what a
person can, which is the kind of gap that is invisible until someone asks.

### 4. The page being edited is somewhere else

On the canvas, the page runs inside a same-origin iframe. The chrome runs in the
parent. `editor/target.tsx` is the abstraction that makes one set of components
work for both:

```ts
interface EditorTarget {
  getWindow(): Window       // where to attach listeners
  getDocument(): Document   // whose DOM to query
  getViewport(): Viewport   // where its pixels land on screen
}
```

Anything that measures must map through `toScreen(rect, viewport)`. Anything
that listens must attach to `target.getDocument()`, not `document`.

**The gotcha that will get you**: `instanceof` fails across realms. An element
from the frame is not `instanceof Element` in the parent, because they are
different constructors. Duck-type instead — `asElement()` in `interactions.ts`.
This cost an hour the first time; it will cost you an hour the second time.

---

## How things flow

**An edit**: a control calls `store.setStyle(id, {...})` → the store writes the
active cell via `layers.ts` and commits a new document → `OverrideStyles`
re-renders the `<style>` tag → the page repaints. No imperative DOM work, except
for scanner-found nodes whose text has to be written directly (`auto/scanner`).

**A selection**: a capture-phase `pointerdown` on the page document finds the
nearest `[data-vedit-id]` and calls `store.select`. Every page gesture is in
`interactions.ts` and every one runs in the capture phase, so the host site's own
handlers and links stay inert while the editor is open.

**A remote change**: `session.ts` diffs its last-seen document against the new
one, sends the changed nodes, and applies incoming patches with
`store.applyRemote` — which also merges them into the undo stack, so undo walks
back through *your* actions and never someone else's.

---

## Recipes

### Add a style control to the inspector

Most controls are one line, because `useStyleValue` already handles the active
cell, multi-selection fan-out and mixed values:

```tsx
<LengthRow id={id} label="Gap" property="rowGap" min={0} />
<SelectRow id={id} label="Cursor" property="cursor" options={[...]} />
<ColorRow  id={id} label="Stroke" property="borderColor" />
```

Something with its own shape (a gradient, a transform) goes in
`panels/Inspector.tsx` as a small component that reads with `useStyleValue` and
writes with `store.setStyle`. Keep the parse/serialise pair in `runtime/` where
it can be unit-tested without a browser — see `gradient.ts` and `transform.ts`.

### Add a panel

Add it to `TABS` in `panels/LeftPanel.tsx` and render it. Gate it on capability
if it needs one (`store.supportsHistory`, `store.session`) — the pattern is that
the editor hides what an adapter can't do rather than showing a dead control.

### Add an adapter

Two required methods. Everything else is optional and switches on the UI that
uses it:

```ts
{ load, save,                     // required
  publish, listVersions, loadVersion,   // → Publish button, History tab
  uploadImage, listAssets,              // → Upload, image library
  listComments, saveComment, deleteComment }  // → comments persist
```

### Add a realtime transport

`connect(room, onMessage) → { send, close }`. That is the whole interface. See
`adapters/broadcast.ts` — the whole file is 27 lines — for the shape.

### Add a document field

1. `types.ts` — the field on `NodeOverride` or `VeditDocument`
2. `layers.ts` — if it participates in the matrix
3. `pruneOverride` — so an empty value doesn't bloat every document
4. `css.ts` or the component that renders it
5. `operations.ts` — so it can be set without the editor, and `describeDocument`
   mentions it
6. `migrate.ts` — `normalize` decides what happens to a document that has it
   wrong; a *removed* or renamed field needs a migration step
7. `session.ts` `diffDocuments` — if it should travel to other editors
8. A unit test against `dist/`, and a line in the README's document example

### Add something the editor can place

1. `types.ts` — a new `NodeKind`, if it isn't a registered component
2. `operations.ts` — `INSERTED_DEFAULTS` and the `insert-node` validation
3. `migrate.ts` — `normalizeInserted`'s allowed kinds, or a stored node is dropped
   on load and the bug looks like "my page went blank"
4. `components/Editable.tsx` — `InsertedView`, which turns a stored node into UI
5. `panels/Insert.tsx` — so a person can reach it

### Add an MCP tool

`mcp.ts`, in the `all` array: a name, a description a model can act on, a JSON
Schema, and a `run` that goes through `applyOperations`. Mark it `write: true` if
it changes anything — that is what `--read-only` filters on. Then a line in
API.md, because a tool nobody knows about is not a feature.

---

## The document format

`DOCUMENT_VERSION` (in `types.ts`) is the shape this build writes. It moves under
one condition and not the other:

- **Additive** — a new optional field, a new node kind. The version does *not*
  move. Old builds ignore what they don't know; new builds treat a missing field
  as absent. Most changes are this.
- **Breaking** — a field is renamed, removed, or its meaning changes. Bump the
  version and add a step to `MIGRATIONS` in `migrate.ts` that rewrites the old
  shape into the new one. **Never edit an existing step**: documents saved by
  every past build have to walk the same path.

The package version is separate and moves for its own reasons.

`inspectDocument` also repairs: a document that isn't an object, `nodes` that
isn't one, an override that's a string, a token with no value. Data reaches this
library from a database, a file, a hand edit and an agent — treating it as
well-formed because it usually is, is how a design tool takes a site down.

---

## Invariants

These are the things that make the library safe to drop into someone else's
site. Breaking one is a bug even if the tests pass.

- **Never rewrite the host's DOM structure.** Overrides are CSS, attributes and
  React children. Re-ordering source elements uses the `order` property; it does
  not move nodes. Inside a slot the tree is ours, so placed nodes really do move —
  those are the only two behaviours, and the editor says which one applies.
- **Never render a component the registry doesn't have.** A document can name one
  that no longer exists. Draw the placeholder; don't drop the node, and don't
  throw.
- **Never let the editor take the page down.** Everything the library renders
  sits behind `VeditErrorBoundary`. New top-level renders get one too.
- **Never trust the document.** It is data from a store; treat values like user
  input. `declarations()`, `safeUrl()` and `sanitizeHtml()` exist for this.
- **Never ship the editor to visitors.** The chrome is behind a dynamic import
  and an `enabled` check. Don't import from `editor/` in `core/` or
  `components/` — that would pull it into the main chunk. (`core/context.tsx`'s
  `import('../editor/mount')` is the one deliberate edge.)
- **Never put a style in a CSS file.** The chrome's styles are a string in
  `editor/styles.ts`, injected at runtime, so host sites need no CSS import.
- **Never use `!important` for an override.** Specificity is bought with
  repeated attribute selectors, so hosts keep the last word.

---

## Testing

**`npm test`** — 147 unit tests, run against `dist/` rather than `src/`, so they
check what actually ships. Pure logic lives here: the CSS emitter, the layer
matrix, the store, migration, the operations vocabulary, the open API, the MCP
server, diffing, contrast maths, the relay, the escaping rules.

**`npm run test:e2e`** — 50 browser tests over the real editor: selection,
breakpoints, states, component props, re-ordering, publishing, composing a page
out of registered components, two people collaborating, driving it all from a
keyboard, and what happens when the editor throws.

**Visual regression** comes in two forms because they catch different things:

- Screenshot baselines in `e2e/visual.spec.ts-snapshots/`. Sensitive to browser
  build (pinned by the `@playwright/test` version) and to fonts (CI runs in the
  matching container). Regenerate deliberately: `npm run test:e2e:update`.
- Layout invariants in the same file — nothing covers the toolbar, no fixed
  label is clipped, the panels leave room for the artboards. These are geometry,
  not pixels, so they hold anywhere. Both bugs they were written to catch were
  real and already shipped, so prefer adding an invariant over adding a
  screenshot when you can express the rule.

Where to put a new test: if it can be expressed without a browser, it belongs in
`test/`. The browser suite is slow enough that it should hold behaviour you
can't check any other way.

---

## Conventions

- **TypeScript, strict.** No `any` that isn't deliberate and commented.
- **Comments explain why, not what.** If a line needs a comment to say what it
  does, rename something instead. The comments worth writing are the ones about
  a constraint you can't see — a cross-realm `instanceof`, a specificity trick,
  a decision that looks arbitrary until you know what it prevents.
- **No CSS files, no runtime dependencies.** React is the only peer.
- **The browser and server entries stay apart.** `src/index.ts` and
  `src/internal.ts` are browser code and ship `'use client'` (added post-build;
  see `scripts/use-client.mjs`). `src/server.ts`, `src/api.ts` and `src/mcp.ts`
  are server code and deliberately don't.
- **`src/index.ts` is a promise.** Anything exported there is supported. If a
  helper is only exported because something needed it, it belongs in
  `src/internal.ts`.
- **`example/` is a fixture.** If you change it, run the e2e suite — its ids and
  markup are load-bearing.

---

## Releasing

```bash
npm run typecheck && npm test && npm run test:e2e   # everything green
npm version <patch|minor|major>
git push --follow-tags
```

`prepare` builds on install, so a git dependency needs no publish step:

```bash
npm install github:jsnapoli1/vedit#v0.4.0
```

Every release gets a [CHANGELOG.md](./CHANGELOG.md) entry, written for someone
who already depends on this: what changed, and what they have to do about it.

To publish to npm the package needs a scoped name — `vedit` is taken by someone
else. Set `"name": "@your-scope/vedit"` and `npm publish --access public`.

See [ROADMAP.md](./ROADMAP.md) for what stands between here and 1.0.
