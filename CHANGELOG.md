# Changelog

What changed, and what it means for a site that already uses this.

The document format has its own version, separate from the package version. See
[what a version bump means](./DEVELOPING.md#the-document-format) — in short, the
package version can move without the format moving, and the format only moves
when a saved document has to be rewritten to keep working.

---

## Unreleased

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
  `createVeditApi` already required `authorize`; the two now agree.

  `createRealtimeHandler` is unchanged — its `authorize` stays optional. It relays
  messages between peers rather than writing to your store, so an unauthorized
  relay is a different, smaller problem than an unauthorized write.

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
