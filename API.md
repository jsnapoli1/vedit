# Editing without the editor

Everything the editor does to a document, something else can do too: a script, a
CI job, an agent. Three ways in, all speaking the same vocabulary.

| | Import | Use it when |
| --- | --- | --- |
| **Operations** | `vedit` | You already have the document in hand |
| **Open API** | `vedit/api` | Something over the network should change the site |
| **MCP** | `vedit/mcp`, or `npx vedit-mcp` | You want an AI agent to design |
| **Content** | `vedit/content-server` | The site keeps its records in vedit, and something should read or change them |

The thing being changed is always the same JSON document: overrides on what your
code renders, and placements of components your code owns. Your components are
never rewritten. A site that has opted into `vedit/content` has a second thing —
its records — with a vocabulary of its own, in [section 4](#4-the-content-api).

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
| `insert-node` | `parentId`, `kind`, `component?`, `shape?`, `id?`, `index?`, `override?` — `kind: 'component'` requires `component`, the registered name; `kind: 'shape'` requires `shape` |
| `set-shape` | `id`, `shape` — the geometry of an inserted shape |
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

### Forms

A form's shape is a prop, so `set-props` configures it — no separate operation:

```ts
applyOperations(current, [
  {
    op: 'set-props',
    id: 'home.contact',
    props: {
      fields: [
        { name: 'email', label: 'Email', type: 'email',
          rules: [{ kind: 'required' }, { kind: 'email' }] },
        { name: 'message', label: 'Message', type: 'textarea',
          rules: [{ kind: 'maxLength', value: 500 }] },
      ],
    },
  },
])
```

Descriptors are parsed when the form renders, not trusted: an unknown field type
falls back to `text`, an unrecognised rule is dropped, and a duplicate name keeps
the first. A malformed entry costs that field, never the page — so an agent
writing a form it half-understands degrades rather than breaks.

Rule kinds are `required`, `minLength`, `maxLength`, `min`, `max`, `email`,
`url`, `tel`, `integer`, `pattern` (with a `preset` of `usZip`, `usPhone`,
`postcodeUk`, `slug` or `hexColor`) and `matches` (with the `field` to equal).
The list is closed; there is no regex to supply.

### Placing a shape

A shape's geometry is coordinates in a 100 × 100 box; how big it is on the page
is its CSS width and height, like any other element:

```ts
import { SHAPE_PRESETS, applyOperations } from 'vedit'

applyOperations(current, [
  { op: 'insert-node', id: 'campaign.sections::mark', parentId: 'campaign.sections',
    kind: 'shape', shape: SHAPE_PRESETS.hexagon },
  { op: 'set-styles', id: 'campaign.sections::mark',
    styles: { width: '96px', height: '96px', fill: 'var(--vedit-brand)' } },
  { op: 'set-styles', id: 'campaign.sections::mark',
    styles: { animation: 'vedit-float 3000ms ease-in-out infinite' } },
])
```

`shape` is one of `{ type: 'rect', rx? }`, `{ type: 'circle' }`,
`{ type: 'line', x1, y1, x2, y2 }`, `{ type: 'polygon', points }` (3–256 pairs)
or `{ type: 'custom', svg, viewBox }` for imported markup. `SHAPE_PRESETS` has
the six the editor offers by name — `rect`, `circle`, `line`, `triangle`, `star`,
`hexagon`. `set-shape` changes the geometry afterwards without touching the style.

Anything malformed is refused rather than stored, and imported markup is
sanitised on the way in and again at render — a document is data wherever it came
from. Animation names are the six presets (`vedit-spin`, `vedit-pulse`,
`vedit-float`, `vedit-fadeIn`, `vedit-draw`, `vedit-wiggle`); `documentToCss`
emits the `@keyframes` for exactly the ones in use, and any other name is left to
your own stylesheet.

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
npx vedit-mcp --dir ./content --content-db ./content.sqlite --schema ./schema.mjs   # records too
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
| `--content-endpoint <url>` | a content server to read and change records through, sent `--token` as a bearer |
| `--content-db <file>` `--schema <module>` | or: a SQLite file, opened with Node's built-in `node:sqlite`, and the module exporting the `{ collections, globals }` it was written with |

Without a content flag the server offers exactly the tools it always did; with
one it adds the nine record tools below, and the agent acts as an admin over
the SQLite file or as whoever the token is over the endpoint.

### The tools

**Reading** — `list_documents`, `describe_document`, `get_document`, `get_node`,
`render_css`, `list_tokens`, `list_components`, `list_versions`.

**Writing** — `set_styles`, `clear_styles`, `set_content`, `place_component`,
`insert_node`, `insert_shape`, `move_node`, `reset_node`, `set_token`,
`apply_operations`, `publish_document`, `restore_version`.

**Records**, with a content source — nine more, over the collections the site
declared rather than over a document:

- `list_sources` — the collections and globals, with what the caller may do to each. The one to start from.
- `describe_source` — one source's fields: names, types, which are required, what a select offers, where a relation points, and its title and order fields.
- `list_records` — the records in a source; `where`, `orderBy`, `limit` as in the HTTP query. Drafts when the caller may publish, otherwise the live copies.
- `get_record` — one record by id; `global` is the id of a global.
- `set_record` — merge field values into one record. *(write)*
- `create_record` — add a record; returns the id the server chose. *(write)*
- `delete_record` — remove one; a draft delete reaches visitors when published. *(write)*
- `reorder_records` — the ids of a source in their new order; needs an `orderField`. *(write)*
- `publish_records` — make the drafts of these records, by source, the live copies. *(write)*

A write lands on the draft when the caller may publish and straight on the live
copy when it may not — the same rule the editor's Save follows, so an agent and
a person editing the same site put their changes in the same place. A refused
batch reports the index of the operation that failed, as `apply_operations`
does.

`insert_shape` takes either `shape` — one of `rect`, `circle`, `line`,
`triangle`, `star`, `hexagon` — or `svg`, the markup of a file. Both, or neither,
is refused. Markup is cleaned of scripts, `<style>` and external references
before it is stored, and cleaned again at render. Everything else about a shape
is ordinary styling: `set_styles` with `fill`, `stroke`, `filter` or `animation`
does the rest.

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
guards the rest of your API. Pass `content` — an `httpContentClient`, or
`contentClientFromStore` over a store in the same process — and the record
tools appear.

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

## 4. The content API

For a site that has let vedit own its records — [INTEGRATING.md
§11](./INTEGRATING.md#11-optional-let-vedit-own-the-content). One handler
serves records, files and sign-in, and finds its own `/v1` segment like the
open API does, so it mounts under any prefix; the paths below assume `/vedit`.

```ts
import { createContentHandler, sqlContentStore, d1Driver } from 'vedit/content-server'
import { r2MediaStore } from 'vedit/media'
import { createAuth, usersCollection } from 'vedit/auth'
import { collections, globals } from './schema'

const store = sqlContentStore(d1Driver(env.DB), { dialect: 'sqlite', collections: { ...collections, _users: usersCollection }, globals })
const auth = createAuth({ store, secret: env.VEDIT_SECRET })
await store.init()

export default { fetch: createContentHandler({ collections, globals, store, media: r2MediaStore(env.MEDIA), auth }) }
```

`auth` or `authorize` is required, on the same terms as every other handler
here; `createUnsafeLocalContentHandler` is the open one. Who the caller is
comes from `auth.session(request)` — the cookie a sign-in set, or a bearer
token. With a bare `authorize`, a request it accepts acts as an admin and any
other as a visitor.

### Records

```
GET  /v1/capabilities                              who the caller is, what they may do
GET  /v1/schema                                    { sources }, each with `can` for this caller
GET  /v1/content/{source}[?stage=draft&…]          { items }
GET  /v1/content/{source}/{id}[?stage=draft]       one record
POST /v1/content/commit                            { changes, stage? } → { idMap, updatedAt }
POST /v1/content/operations                        { operations, stage? } → the same
POST /v1/content/publish                           { records: { [source]: [ids] } } → { ok }
POST /v1/content/{source}/{id}/publish             → { ok }
GET  /v1/content/{source}/{id}/versions            { items: [{ id, savedAt, stage }] }
POST /v1/content/{source}/{id}/versions/{v}/restore   → { ok }
```

**Capabilities** is public and is what the editor asks first:

```json
{ "user": { "id": "k2m9x1p0q7", "email": "sam@example.com", "name": "Sam", "role": "editor" },
  "login": true,
  "can": { "write": true, "publish": true, "upload": true, "data": { "write": true, "delete": true } },
  "sources": ["products", "categories", "site", "_users"],
  "api": 1 }
```

`user` is `null` for a visitor and `login` says whether the server can sign
anyone in. The `can` block is by role — an author writes, uploads and edits
records; an editor also publishes and deletes; an admin also manages `_users` —
and the schema's per-source `can` narrows it further where an access rule does.

**Reading.** A list takes `where[field]=value` (repeat the key for "any of
these"), `orderBy=field` or `orderBy=-field`, `limit`, and `populate=a,b` to
resolve relation fields into the records they point at. Without `stage=draft`
the answer is what visitors see; drafts need an account and read access on the
source. Every record carries `_status` — `published`, `changed` when a draft
differs from the live copy, `draft` when it has never been published — and
`_updatedAt`. A `password` field, and the `passwordHash` behind it, never leave
the server.

**Committing.** `changes` is by source, and each source is any of `create` (a
list of records; an id left out or starting with `new-` is minted by the server
and reported in `idMap`), `update` (ids to patches), `delete` (ids) and `order`
(ids, first to last, written into the source's `orderField`):

```bash
curl -X POST https://example.com/vedit/v1/content/commit \
  -H 'authorization: Bearer …' -H 'content-type: application/json' \
  -d '{"stage":"draft","changes":{"products":{"update":{"p-relay":{"price":26}},"create":[{"id":"new-1","title":"Contactor"}]}}}'
```

```json
{ "idMap": { "new-1": "m1x2y3ab12" }, "updatedAt": "2026-09-15T10:00:00.000Z" }
```

`stage` defaults to `draft`; `published` writes the live copy directly and is
a publish, so it takes the publish right on every source with drafts. Access is
checked for every record of every source, and every record validated against
its fields, before anything is written — a refused `_users` create does not
half-apply the products beside it — and the store writes the whole batch in one
transaction. A source with `drafts: false` is written live whatever `stage`
says. Each commit keeps a version per touched record, trimmed to the source's
`versions`, and runs the source's `afterChange` hook with the record as stored.

`operations` is the same commit written as a batch of `RecordOperation`s, for
a caller that thinks in steps rather than in a diff:

```ts
type RecordOperation =
  | { op: 'set-record'; source; id; data }
  | { op: 'create-record'; source; id?; data }
  | { op: 'delete-record'; source; id }
  | { op: 'reorder-records'; source; order: string[] }
```

They are folded by `applyRecordOperations` from `vedit/content` — a set after a
create merges into the create, a delete of something created in the same batch
drops both — and then committed. They are their own union, never mixed with
the document operations of section 1: a record and a document are different
things, and the editor's `store.applyRecords` is the one that takes them.

**Errors** are JSON with an `error` string. A `400` names what was wrong —
`products: title is required`, `Unknown source "prodcuts"`, `stage must be
"draft" or "published"` — and a malformed operation adds its position:

```json
{ "error": "An operation needs a source", "index": 1 }
```

`403 { "error": "Not allowed" }` is the answer to anything the caller's role or
the source's access rule refuses, including an anonymous write and a visitor
asking for drafts; `404` an unknown source, record or route; `405` a wrong
method, with `allow` set.

**Rich text on the server.** A `richtext` field is sanitised by `validateRecord`
before it is stored. On the server that sanitiser is the regex pass — scripts,
styles, frames, event handlers and `javascript:` URLs removed — whatever
profile the editor used, because without a DOM there is no tree to apply a tag
whitelist to; the stored value is that result. The tag whitelist is applied
again in the browser when the field is edited or rendered, so a record written
by a script is cleaned to the same shape as one typed into the editor before
it reaches a page.

### Media

Mounted beside the records when `media` is given, and the same routes
`createMediaHandler` serves on its own:

```
POST   /v1/media               multipart `file` (+ `alt`) → the asset
GET    /v1/media?kind=&q=      { items }
GET    /v1/media/{id}          the bytes; `?download=1` for an attachment
HEAD   /v1/media/{id}          the same headers, no bytes
DELETE /v1/media/{id}          → 204
```

An asset is `{ id, url, kind, name, mime, size, alt? }`; `kind` is `image`,
`video` or `file` by mime, and is what `?kind=` filters on. An upload needs the
`upload` capability, a delete `data:delete`; anyone may read. A mime outside
`accept` is `400`, a body over `maxBytes` is `413`. A file is served with its
`Content-Type`, `Cache-Control: public, max-age=31536000, immutable` — an id
never changes what it points at — and `Content-Disposition: inline` carrying
the original name, `attachment` with `?download=1`. Ids are base36 and dashes
with one extension; anything else is `404` before a store is asked, so an id
can never name a path.

### Auth

Mounted when `auth` is given:

```
POST /v1/auth/login     { email, password } → { user, token } and Set-Cookie
POST /v1/auth/logout    → 204, clears the cookie
GET  /v1/auth/me        { user }, or 401
```

A wrong email or password is `401 { "error": "Wrong email or password" }`, and
an unknown email costs the same time as a wrong password. The eleventh failure
from one address for one email inside fifteen minutes is `429`. The cookie is
`vedit_session`, `HttpOnly`, `SameSite=Lax`, `Secure` over https; on a non-GET
request it only counts when the browser says the request came from your own
site (`Sec-Fetch-Site`, or `Origin`), so a cross-site post is refused with
`403` rather than acted on. The `token` in the login answer is the same session
as a bearer, for a script or a client on another origin — `curl` and
`vedit-mcp --content-endpoint` use it.

### From code

`httpContentClient({ endpoint })` from `vedit/content` speaks these routes — it
is what the provider takes as `content`, and what the MCP command uses.
`contentClientFromStore(store)` from `vedit/content-server` is the same
interface over a store in the same process, with no network and no login; the
role is whatever the caller says. `localContentClient({ collections, seed })`
from `vedit/content` is that over a memory store, for a test or a first look.

---

## Reading the result

Every surface goes through the same door as the editor, so the same guarantees
hold: values are escaped on the way into the stylesheet, `javascript:` URLs never
survive, a record is validated against its collection before it is stored, and
a document written by a newer build is migrated on load rather than silently
reshaped. See [DEVELOPING.md](./DEVELOPING.md) for how that works.
