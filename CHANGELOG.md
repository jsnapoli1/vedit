# Changelog

What changed, and what it means for a site that already uses this.

The document format has its own version, separate from the package version. See
[what a version bump means](./DEVELOPING.md#the-document-format) — in short, the
package version can move without the format moving, and the format only moves
when a saved document has to be rewritten to keep working.

---

## Unreleased

Nothing here changes the library. It changes what is known about it.

### Added

- **An example app per framework, exercised in CI.** `INTEGRATING.md` named Next
  (App and Pages), Remix and Astro islands; only Vite was ever tested, and SSR
  only through a synthetic `renderToString`. Each of those now has a minimal app
  under `examples/`, built for production against the packed tarball and driven
  by `npm run test:frameworks`: the markup is server-rendered, hydration is
  silent, the editor opens on ⌘E, and an edit survives a reload.

  The Next App Router case is the one that mattered. Its build fails outright if
  the `'use client'` directive is missing from the shipped bundle — the exact
  breakage the roadmap called a sharp edge, and one nothing else here caught.

  No library code changed to make these pass, which is the useful part of the
  result: the framework matrix was correct, it just wasn't checked.

---

## 0.6.0 — 2026-09-07

The document format is unchanged at version 1. Everything here is additive:
`vars` is a new optional prop, and a document written by 0.5 opens untouched.

Both changes came from the same integration: a "Pay $250 deposit" button that
could not be edited, and a trash icon that appeared to do nothing.

### Added

- **`vars` on `<Editable>`** — interpolate host values into editable copy.

  Some sentences wrap a number your app computes. Wrapped as ordinary text, the
  editor stores the sentence *as rendered*, so saved copy still says `$250`
  after the price moves — and can end up contradicting whatever computed it.

  ```tsx
  <Editable id="checkout.pay" vars={{ deposit: money(quote.depositCents) }}>
    {'Pay {deposit} deposit'}
  </Editable>
  ```

  The document stores `Pay {deposit} deposit`; the value is substituted on every
  render. The wording is editable and saved, the number stays live. vedit learns
  the *name* and never what it is worth.

  The inspector lists the names that resolve. An unknown name renders literally
  rather than blanking — a half-typed `{amo` should not make text disappear
  while someone is still typing — and is flagged, because a typo that ships
  silently is indistinguishable from deliberate copy. `{{` and `}}` escape.

### Changed

- **The inspector's trash removes; a new undo arrow reverts.** They were one
  trash icon that deleted an inserted node but merely reset overrides on
  anything from source code. On an element nobody had edited yet there was
  nothing to reset, so the obvious control for removing something did nothing at
  all, with no error — the failure was indistinguishable from a broken button.

  Removing a source element writes `hidden`: `display:none` for visitors, dimmed
  and outlined in the editor so it can be found and brought back. That is what
  Delete and Backspace already did; the button now agrees with the keyboard.
  The key toggles, the button only hides — use the eye, or revert, to bring
  something back.

  The revert control is disabled when there is nothing to revert, and says so.

  If you relied on the trash icon resetting overrides, that action moved to the
  arrow beside it. Nothing about stored documents changed.

---

## 0.5.0 — 2026-08-31

The document format is unchanged at version 1. Everything here is additive:
`version`/`migrate` on a component are optional, `data-vedit-skip` is new, and a
document written by 0.4 opens untouched.

Prompted by an integration that took eleven rounds — not because anything was
broken, but because every failure looked identical: nothing on screen, nothing
in the console. Most of this release is the library learning to say what went
wrong.

### Added

- **Focus one page on the canvas.** A dropdown in the toolbar shows a single
  artboard instead of all of them. Hidden pages stay loaded and keep their
  unsaved edits, so switching focus costs nothing and loses nothing. Only
  appears when `pages` has more than one entry.

- **`data-vedit-skip`** — hides an element and its subtree from the DOM scanner
  and does nothing else. Reach for this for generated markup, such as a heading
  split into per-word spans by an animation library.

  `data-vedit-ui`, which is easy to find first and sounds like it does this job,
  marks the editor's *own chrome*: it also makes that subtree ignore editor
  clicks, so setting it inside a page silently makes that whole region
  unselectable. A development build now warns when it appears inside page
  content.

- **Component schema versioning.** A definition can now carry a `version` and a
  `migrate`, so renaming or retyping a prop stops stranding every page that
  already stores the old one. Documents have had `migrateDocument` since 0.2;
  without this, a component's own schema was the one part of a saved page that
  could silently rot.

  ```ts
  Hero: {
    component: Hero,
    version: 2,
    fields: [{ name: 'title', type: 'text' }],
    migrate: (props, from) => (from < 2 ? { ...props, title: props.headline } : props),
  }
  ```

  Migrations run on read, so an old page renders correctly straight away, and the
  new shape is written back the next time someone saves for their own reasons —
  opening a page never writes to it, and never makes it look edited. Props stored
  at a *newer* version than the code are left alone rather than guessed at, and a
  migration that throws costs one component's appearance rather than the page.

- **Drag a component from the Insert panel onto the page.** Clicking still places
  into the selected container; dragging aims for itself, showing the same
  insertion line used for re-ordering and dropping between two existing blocks.
  Dropping somewhere nothing accepts an element says so rather than placing it
  somewhere you weren't looking.

- **`seedFromDom` and `applySeed`** — build a document from a rendered region,
  so converting it to a `<VeditSlot>` doesn't blank the page on day one. Ids are
  derived from position rather than randomly, so a seed script is re-runnable
  and its output diffs cleanly; `applySeed` refuses to touch a slot that already
  has content. See [INTEGRATING.md](./INTEGRATING.md#converting-a-region-that-already-has-content).

### Fixed

- **The Position toggle now shows which mode is active.** "In flow" and "Free"
  wrote through the cell for the current breakpoint but read back from the base
  one, so at any breakpoint other than `base` — including the width the canvas
  opens at — clicking "Free" genuinely repositioned the element while the
  control kept showing "In flow".

### Accessibility

- **Every inspector field says what it sets.** The panel's labels were laid out
  rather than associated — a span beside the control, or a one-letter prefix
  inside it — so a screen reader announced "edit text" and left you to work out
  which of nine numeric fields you were in. Each row now names the controls
  inside it, and fields whose visible label is an abbreviation ("W", "T") carry a
  spoken name ("width", "Padding top"). 0.2 made the editor keyboard-drivable;
  this is the half that was missing.

### Diagnostics

Four failures that used to be silent now say something, once, in development
builds only:

- The editor being disabled on a hostname that isn't local, which is why ⌘E can
  do nothing at all on a deployed staging site.
- The editor's chunk failing to load — usually a stale reference after a deploy.
  It also stops pretending to be open, and reports through `onError`.
- `data-vedit-ui` set inside page content, which makes that region unselectable.
- A selected node with no box, `display: contents` being the usual cause. It can
  never be outlined, dragged or resized, which reads as the editor ignoring it.

### Documentation

- [INTEGRATING.md](./INTEGRATING.md) opens with the path through the library,
  and says plainly that stopping after the override steps is a finished
  integration rather than a half-measure.
- Step 5 now says what adopting a slot changes about *maintaining* the site:
  the region leaves your repository, stops appearing in pull requests, and is
  recovered through the History panel rather than `git revert`.

---

## 0.4.1 — 2026-08-31

No change to anything you install — this release only fixes the test suite.

### Fixed

- **The visual regression baselines are generated where CI runs them.** Every CI
  run since the browser suite landed had failed on all ten screenshots, about
  2-4% of pixels against a 1% tolerance. The baselines had been captured on
  macOS, and both the demo site and the editor chrome ask for a system font
  stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`).
  That resolves to SF Pro on a Mac and falls through to DejaVu in the Linux
  container, because none of the named faces are installed there — different
  metrics, different line breaks, a headline wrapping to three lines in the
  baseline and two in CI.

  They are now regenerated inside `mcr.microsoft.com/playwright:v1.56.0-noble`,
  the image the workflow already pins. If you regenerate them yourself, do it in
  that container rather than with a local `npm run test:e2e:update`, or you will
  reintroduce this — see [DEVELOPING.md](./DEVELOPING.md#testing).

---

## 0.4.0 — 2026-08-25

One change, and it is a breaking one: the two server constructors no longer let
you leave the authorization off.

### Breaking

- **`authorize` is required on `createVeditHandler`.** It was optional, which made
  the open configuration the default one: leave the field off and every request
  could write to your store. The type now requires it, and a call without it
  throws a `TypeError` at startup rather than serving — JavaScript callers never
  hear the type.

  If you were relying on the old default, either pass the callback you already
  meant to:

  ```ts
  createVeditHandler({ store, authorize: (request) => isEditor(request) })
  ```

  or, where an open endpoint genuinely is what you want, say so by name:

  ```ts
  import { createUnsafeLocalHandler } from 'vedit/server'
  const handle = createUnsafeLocalHandler({ store })  // every request may write
  ```

  `createUnsafeLocalHandler` is the same handler with the check opted out of, and
  warns on `console` when it finds itself in a `NODE_ENV=production` build.
  `createVeditApi` already required `authorize`; the three now agree.

- **`authorize` is required on `createRealtimeHandler`,** on the same terms and
  for the same reason. An open relay is a smaller problem than an open write, but
  it is still one: anyone who finds it can join a room, read every edit in
  progress, and post messages the editors will act on. The options object is no
  longer optional either, so `createRealtimeHandler()` throws where it used to
  return a working relay.

  ```ts
  createRealtimeHandler({ authorize: (request) => isEditor(request) })

  import { createUnsafeLocalRealtimeHandler } from 'vedit/server'
  const relay = createUnsafeLocalRealtimeHandler()  // anyone may join and post
  ```

  `heartbeatMs` moves to the unsafe variant unchanged:
  `createUnsafeLocalRealtimeHandler({ heartbeatMs: 60_000 })`.

---

## 0.3.0 — 2026-08-25

Pages can now be built, not only edited. Register your components and a
`<VeditSlot>` becomes a region people — or an agent — compose out of them.

### Added

- **A component registry.** `defineComponents({...})` and the `components` prop on
  `VeditProvider`. Components stay ordinary React; the schema beside them says
  which props may be changed. `defineComponent` types one entry against its own
  props; `componentManifest(registry)` is the serialisable half.
- **`<VeditSlot>`.** A region whose contents live in the document. A whole page is
  a slot with nothing around it; a section of an existing page is a slot in the
  middle of your JSX. `children` render while it is empty.
- **Placed components.** `InsertedNode` gained `kind: 'component'` and
  `component`, so a document can hold a tree of your components with their props.
  Nesting is a parent id pointing at another placed node, which is how a layout
  component (`container: true`) holds what is put inside it.
- **An Insert panel**, listing registered components grouped as the registry says,
  plus the primitives. It shows where the new node will land — the selected
  container, the nearest one above it, or the page's slot.
- **Re-ordering.** Move up / move down in the inspector, through the same
  `move-node` operation the API and MCP use.
- **Composition for agents.** `list_components`, `place_component` and `move_node`
  over MCP; `GET /v1/components` and a `components` option on `createVeditApi`;
  `--components manifest.json` on `vedit-mcp`. A component name the site doesn't
  have is refused with the list of names it does.
- A `/campaign` page in the example: a slot and nothing else, with four registered
  blocks to build it from.

### Changed

- `describeDocument` lists every node the document knows about, not only those
  carrying overrides, and reports `parentId`, `index` and `component` for placed
  ones. A component placed with its defaults used to be invisible to it.
- `VeditStore.insert` takes `{ component, index }`, and `moveInserted` takes an
  index. Both now go through `applyOperations`, so the editor and the API agree
  on what placing and moving mean.
- `VeditConfig` gained `components` (the manifest) and the context gained
  `registry` (the components themselves). The canvas bridge carries the manifest,
  so the panels can offer what the framed page knows how to render.
- The canvas opens on the page you opened the editor from, rather than the first
  page in `pages`.
- The left panel's tab strip wraps to two rows. Six tabs in 268px turned every
  label into "Lay…", "Tok…", "Che…"; the layout invariant caught it.
- `VeditContextValue` gained `registry`. Only code that builds the context by
  hand is affected — the provider fills it in.

### Fixed

- A stored node with an unknown kind was dropped on load. `component` is now a
  known kind in `migrate.ts`; without that fix a page of placed components would
  have come back empty.
- Deleting a container left everything placed inside it in the document, rendering
  nowhere and reachable from nothing. `remove-node` and `reset-node` now take the
  whole subtree. This only became possible when nodes could nest, so no released
  document can carry the orphans.

### Notes

- The document format is still version 1. Placement is an additive field on a
  node type that already existed, so 0.2 reads a 0.3 document — it draws a box
  where a component would be, rather than failing.
- Screenshot baselines were regenerated: the left panel has one more tab.

---

## 0.2.0 — 2026-08-24

Documents are safe to keep, the public surface is the supported one, the editor
can be driven from a keyboard, and everything the editor does is now reachable
without one.

### Added

- **Document migration.** `migrateDocument` / `inspectDocument` run on every
  load: the version is walked, a document from a newer build keeps its own
  version and its unknown fields, and a malformed one is repaired rather than
  trusted. Wired into the store, the server handler and both new surfaces.
- **An operations model** (`applyOperations`). Every change to a document as
  data — one vocabulary for the editor, the API, MCP and scripts. Batches are
  atomic. `store.apply(ops)` applies one as a single undo step.
- **An open API** (`vedit/api`). Versioned HTTP routes over documents, nodes,
  tokens, versions and the rendered CSS. `authorize` is required. `remoteStore`
  is the matching client, so tooling can drive a deployed site.
- **An MCP server** (`vedit/mcp`, `npx vedit-mcp`). 16 tools over stdio or HTTP,
  written against the wire protocol so the library keeps no dependencies. Agent
  edits land on the draft; publishing stays a separate step. `notifyEditors`
  posts a patch to the realtime relay so an open editor updates live.
- **Keyboard navigation.** Focus moves into the chrome on open and back on
  close; the layers tree and panel tabs are one tab stop each with arrow-key
  movement; comment threads trap focus and return it; every control has a
  visible focus ring and an accessible name.
- **`vedit/internal`** — the helpers the library uses on itself, exported but
  explicitly unsupported.
- Docs: [API.md](./API.md) for all three programmatic surfaces.

### Changed

- **The main entry is now the supported API.** `readLayer`, `readStyles`,
  `readStyleValue`, `mergeStyles`, `replaceStyles`, `deleteStyles`,
  `pruneOverride`, `scanDom`, `computeAutoId`, `auditPage`, `contrastRatio`,
  `effectiveBackground`, `parseColor`, `luminance`, `sanitizeHtml`, `safeUrl`,
  `parseTransform`, `serializeTransform`, `withTransform`, `parseGradient`,
  `serializeGradient`, `DEFAULT_GRADIENT`, `RealtimeSession`, `diffDocuments`,
  `anonymousPeer`, `colorForPeer` and `initialsOf` moved to `vedit/internal`.
  **Migration**: change the import path. Nothing was renamed or removed.
- `VeditDocument['version']` is `number` rather than the literal `1`, because it
  is now read as well as written.
- `VeditServerStore` gained an optional `list()`. `fileStore` implements it.
- Keys pressed while focus is in the editor's chrome go to the focused control
  instead of the page. Modified shortcuts (`⌘Z`, `⌘S`, `⌘E`) still work anywhere.

### Fixed

- Enter on a focused layer row started an inline edit on the page instead of
  activating the row.
- Typing letters into an inspector field switched tools — `h`, `t`, `i` and `r`
  are all tool shortcuts.

### Known gaps

- Inspector fields carry their labels visually, not as `<label>` elements; a
  screen reader announces the control without its name. Navigation and focus are
  fixed; naming those fields is not.
- Nobody has used this on a site the author didn't write. See
  [ROADMAP.md](./ROADMAP.md).

---

## 0.1.0 — 2026-08-23

First working version: the canvas, the override model, and everything that hangs
off it.

- Click-to-edit for text, images, links, boxes and components, over a page you
  can zoom and pan like a design tool.
- Overrides emitted as CSS — real media queries, real `:hover`, and a server
  render that matches the client.
- A state × breakpoint matrix, design tokens, component props declared by your
  own components, multi-select, inserted elements, an accessibility audit.
- Drafts, publishing and version history when the adapter supports them.
- Presence, cursors, comments and per-node merging for two people at once.
- Adapters for localStorage, HTTP and memory; realtime over BroadcastChannel or
  SSE; a Fetch-standard server handler and relay.
