# Changelog

What changed, and what it means for a site that already uses this.

The document format has its own version, separate from the package version. See
[what a version bump means](./DEVELOPING.md#the-document-format) — in short, the
package version can move without the format moving, and the format only moves
when a saved document has to be rewritten to keep working.

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
