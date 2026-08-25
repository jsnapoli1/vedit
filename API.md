# Editing without the editor

Everything the editor does to a document, something else can do too: a script, a
CI job, an agent. Three ways in, all speaking the same vocabulary.

| | Import | Use it when |
| --- | --- | --- |
| **Operations** | `vedit` | You already have the document in hand |
| **Open API** | `vedit/api` | Something over the network should change the site |
| **MCP** | `vedit/mcp`, or `npx vedit-mcp` | You want an AI agent to design |

The thing being changed is always the same JSON document: overrides on what your
code renders, and placements of components your code owns. Your components are
never rewritten.

---

## 1. Operations

One vocabulary, deliberately small. Every operation is data — which is what makes
it safe to accept from a network request or a model.

```ts
import { applyOperations } from 'vedit'

const { doc, changed, created } = applyOperations(current, [
  { op: 'set-content', id: 'home.hero.title', content: { text: 'Ship the site your designer drew' } },
  { op: 'set-styles', id: 'home.hero.title', styles: { fontSize: '56px', letterSpacing: '-0.02em' } },
  { op: 'set-styles', id: 'home.hero.title', styles: { fontSize: '34px' }, breakpoint: 'base' },
  { op: 'set-token', token: { id: 'brand', name: 'Brand', kind: 'color', value: '#0d99ff' } },
])
```

| Operation | Fields |
| --- | --- |
| `set-styles` | `id`, `styles`, `state?`, `breakpoint?` — merges; leaves the rest alone |
| `replace-styles` | `id`, `styles`, `state?`, `breakpoint?` — replaces the whole cell |
| `clear-styles` | `id`, `properties`, `state?`, `breakpoint?` — back to the site's own styling |
| `set-content` | `id`, `content` — `text`, `html`, `src`, `alt`, `href`, `target`, `className`, `hidden`. `null` removes one |
| `set-props` | `id`, `props` — values for props a component declared editable |
| `reset-node` | `id` — drop every override |
| `insert-node` | `parentId`, `kind`, `component?`, `id?`, `index?`, `override?` — `kind: 'component'` requires `component`, the registered name |
| `move-node` | `id`, `parentId?`, `index?` |
| `remove-node` | `id` — inserted nodes only |
| `set-token` / `remove-token` | `token` / `id` |

`state` is `default` (the default), `hover`, `focus` or `active`. `breakpoint` is
`base` (the default), `sm`, `md`, `lg` or `xl`. Together they address one cell of
the matrix — the same cell the inspector writes when you pick a state and a width.

**A batch is atomic.** If one operation is malformed the whole batch throws
`OperationError` (with the index of the one that failed) and the document is
untouched. There is no such thing as half of what was intended.

`store.apply(operations)` does the same against a live editor, as one undo step.

---

## 2. The open API

```ts
// app/api/vedit/[...path]/route.ts  — Next App Router; the handler is
// Fetch-standard, so Remix, Hono, Workers, Deno and Bun take the same function.
import { createVeditApi } from 'vedit/api'
import { fileStore } from 'vedit/server'

const handle = createVeditApi({
  store: fileStore('./content'),                     // or your database
  authorize: (request, { write }) => isEditor(request, { write }),
})

export { handle as GET, handle as PUT, handle as POST, handle as DELETE }
```

`authorize` is **required**, not optional. This endpoint can rewrite a live site;
opting out is something to type on purpose (`authorize: () => true`), not
something to forget.

Routes are versioned in the path and mount anywhere — the handler finds its own
`/v1` segment. Document keys are URI-encoded, so a key of `/pricing` is
`documents/%2Fpricing`.

```
GET    /v1                                     what this server supports
GET    /v1/components                          the components a page may be built from
GET    /v1/documents                           list keys (stores that can)
GET    /v1/documents/{key}[?stage=draft]       read a document
PUT    /v1/documents/{key}                     replace a document
GET    /v1/documents/{key}/summary             what is overridden, without the style maps
POST   /v1/documents/{key}/operations          apply a batch
GET    /v1/documents/{key}/css                 the stylesheet visitors would get
GET    /v1/documents/{key}/nodes/{id}          one node's override
PUT    /v1/documents/{key}/nodes/{id}          replace it
DELETE /v1/documents/{key}/nodes/{id}          reset it
GET    /v1/documents/{key}/tokens              design tokens
PUT    /v1/documents/{key}/tokens/{id}         create or update one
DELETE /v1/documents/{key}/tokens/{id}         remove one
POST   /v1/documents/{key}/publish             make the draft live
GET    /v1/documents/{key}/versions            history
GET    /v1/documents/{key}/versions/{id}       read one version
POST   /v1/documents/{key}/versions/{id}/restore
```

```bash
curl -X POST 'https://example.com/api/vedit/v1/documents/%2Fpricing/operations?stage=draft' \
  -H 'authorization: Bearer …' -H 'content-type: application/json' \
  -d '{"operations":[{"op":"set-content","id":"pricing.plan.pro.price","content":{"text":"$29"}}]}'
```

```json
{ "changed": ["pricing.plan.pro.price"], "created": [], "updatedAt": "2026-08-24T19:00:00.000Z" }
```

A refused batch is a `400` naming the operation that failed:

```json
{ "error": { "message": "Unknown operation `delete-everything`", "operation": 1 } }
```

**`stage`** decides which copy you are working on. Write to `?stage=draft` and
nothing visitors see changes until `/publish`. Without it you are editing the
live document directly, which is occasionally what you want and usually not.

**`onChange`** is called after every write. Pass `notifyEditors` (below) and an
open editor sees the change as it happens.

**`remoteStore`** is the other half: a `VeditServerStore` that speaks this API, so
a tool can point at a deployed site instead of a local directory.

```ts
import { remoteStore } from 'vedit/api'
const store = remoteStore({ endpoint: 'https://example.com/api/vedit', headers: { authorization: `Bearer ${token}` } })
```

---

## 3. MCP — designing with an agent

```bash
npx vedit-mcp --dir ./content              # documents on disk
npx vedit-mcp --endpoint https://example.com/api/vedit --token "$VEDIT_TOKEN"
```

Register it once and an agent can work on the site:

```bash
claude mcp add vedit -- npx -y vedit-mcp --dir ./content
```

```jsonc
// or by hand, in a client's config
{ "mcpServers": { "vedit": { "command": "npx", "args": ["-y", "vedit-mcp", "--dir", "./content"] } } }
```

| Flag | |
| --- | --- |
| `--dir <path>` | documents on disk (default `./content`) |
| `--endpoint <url>` `--token <t>` | work through a deployed site's open API instead |
| `--key <key>` | the document to use when a tool call omits one |
| `--components <file>` | component manifest JSON, so an agent can compose pages |
| `--stage draft\|published` | which copy to write (default `draft`) |
| `--read-only` | expose only the tools that read |
| `--realtime <url>` `--room <room>` | notify a relay, so open editors update live |

### The tools

**Reading** — `list_documents`, `describe_document`, `get_document`, `get_node`,
`render_css`, `list_tokens`, `list_components`, `list_versions`.

**Writing** — `set_styles`, `clear_styles`, `set_content`, `place_component`,
`insert_node`, `move_node`, `reset_node`, `set_token`, `apply_operations`,
`publish_document`, `restore_version`.

### Composing a page

`list_components` and `place_component` are what turn an agent from something that
restyles a page into something that builds one. The components are the team's own,
so a page an agent assembles has the site's design, behaviour and accessibility in
it rather than an approximation:

```jsonc
// list_components
{ "items": [
  { "id": "Hero", "group": "Sections", "description": "A headline with an optional image.",
    "fields": [{ "name": "headline", "type": "text" },
               { "name": "align", "type": "select", "options": ["left", "center"] }] }
] }

// place_component
{ "parentId": "campaign.sections", "component": "Hero",
  "props": { "headline": "Spring, in one afternoon", "align": "center" } }
```

A name the site doesn't have is refused with the list of names it does have, so a
model corrects itself instead of writing a placeholder someone finds later.

The server needs the manifest to offer any of this: pass `components` to
`createVeditMcpServer`, or `--components manifest.json` to `vedit-mcp`. Write that
file at build time with `componentManifest(registry)` — the command never has to
import your app.

`describe_document` is the one to start from: node ids and which cells each one
sets (`style`, `md`, `hover:lg`), without the declarations. It is a fraction of
the size of the document and usually all a model needs to decide what to change.
`render_css` closes the loop — it returns exactly what a visitor's browser would
get, so a change can be checked rather than assumed.

### Mounting it yourself

```ts
import { createVeditMcpServer, createMcpHandler, notifyEditors } from 'vedit/mcp'
import { fileStore } from 'vedit/server'

const server = createVeditMcpServer({
  store: fileStore('./content'),
  stage: 'draft',
  components: componentManifest(registry),   // what it may place

  allowKey: (key) => key.startsWith('/marketing'),   // keep an agent in its lane
  onChange: notifyEditors({ endpoint: 'https://example.com/api/vedit/realtime' }),
})

export const POST = createMcpHandler(server)   // authenticate this route yourself
```

`createMcpHandler` does no authorization of its own — put it behind whatever
guards the rest of your API.

### What to expect

- **Edits land on the draft.** An agent proposes; publishing stays a separate,
  deliberate step someone has to ask for.
- **Ids are the contract.** An agent can only change what has an id, so the
  elements you wrapped in `<Editable>` are the ones it can work on precisely.
  Scanner ids work too, and move when the markup does.
- **The registry is the fence.** An agent can place the components you registered
  and no others. Registering fewer is a real way to narrow what it can do.
- **It cannot touch your code.** The worst case is a bad-looking draft, which
  `reset_node` or a version restore undoes.
- **Give it a token.** `set_token` plus `var(--vedit-brand)` in a style is how a
  model keeps a site consistent instead of inventing a fourth blue.

---

## Reading the result

Both surfaces go through the same door as the editor, so the same guarantees
hold: values are escaped on the way into the stylesheet, `javascript:` URLs never
survive, and a document written by a newer build is migrated on load rather than
silently reshaped. See [DEVELOPING.md](./DEVELOPING.md) for how that works.
