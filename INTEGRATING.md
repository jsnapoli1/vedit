# Adding vedit to a site

A short, complete recipe. It is written to be followed by a person or handed to a
coding agent — the steps are in dependency order and each one is checkable.

## The path

Steps 2–4 are where most sites stop, and stopping there is a finished
integration, not a half-measure. The override model is what makes this droppable
into an existing site in an afternoon: your components stay exactly as you wrote
them, the content stays in your repository, and edits are a layer on top.

Steps 5 and after trade some of that for the ability to build pages rather than
only edit them. That is a bigger commitment — see [what you are actually
deciding](#what-you-are-actually-deciding) — and it is an option, not the
destination.

Each step is worth shipping on its own, and each one is a reasonable place to
stop:

1. **Drop the provider onto a real page** and edit copy with no ids at all. An
   afternoon's work, and it either helps immediately or it doesn't.
2. **Add explicit ids** to the things that matter, so their edits survive the
   markup being refactored around them.
3. **Register components** when people start wanting variants of a section
   rather than new words in it.
4. **Open one region as a slot** — the one that already changes most often, and
   that breaks nothing when it is empty.
5. **Convert a whole page** only once a slot has proven itself on a real region
   with real editors.

Steps 4 and 5 hand ownership of that content to the editor. Get there when the
earlier steps make it obvious you want to, not before.

---

## 1. Install

The package is not on npm (the name `vedit` is taken by someone else), so install
it from the repository:

```bash
npm install github:jsnapoli1/vedit
```

`prepare` builds the bundle on install, so the git URL is a complete install —
nothing else to run. Pin a tag or commit for anything you deploy:

```bash
npm install github:jsnapoli1/vedit#v0.6.0
```

To publish it under your own scope instead, set `"name": "@your-scope/vedit"` in
`package.json` and `npm publish --access public`; the import path changes to match.

**Peer dependencies**: React and React DOM 18 or newer.

---

## 2. The smallest thing that works

Wrap the app once. Nothing else has to change: the DOM scanner makes headings,
text, links, buttons, images and layout containers selectable on their own.

```tsx
import { VeditProvider } from 'vedit'

<VeditProvider>
  <App />
</VeditProvider>
```

Open the site on `localhost` and press `⌘E` (`Ctrl+E`). Edits go to
`localStorage` until an adapter says otherwise.

**Check**: the editor opens, clicking a heading selects it, and typing in the
inspector changes the page.

### Hiding things from the scanner

Animation libraries and the like generate markup that has no business being
editable — `SplitText` wrapping every word in a `<span>`, for instance. Mark the
wrapper and the scanner walks past the whole subtree:

```tsx
<h1 data-vedit-skip>{splitIntoWords(title)}</h1>
```

There is a second attribute, `data-vedit-ui`, which the editor puts on its own
chrome. **Don't reach for it here.** It means "this is the editor's UI", so it
also makes the subtree ignore editor clicks — set it inside your page and that
region stops being selectable at all, including the elements around it. Use
`data-vedit-skip` for your own markup; a development build warns if the two get
confused.

---

## 3. Give the things that matter stable ids

Scanner ids describe where an element sits (`auto:#app>section>h1`), so they move
when the markup does. Anything you want to keep edited across refactors gets an
explicit id:

```tsx
import { EditableText, EditableImage, EditableBox } from 'vedit'

<EditableBox id="home.hero" as="section" className="hero">
  <EditableText id="home.hero.title" as="h1">Ship the site your designer drew.</EditableText>
  <EditableImage id="home.hero.art" src="/hero.png" alt="" />
</EditableBox>
```

Name ids after content, never position: `home.hero.title`, not `section-2-h1`.
For lists, key off a stable field — `product.${product.slug}.tagline`.

Work outside-in: the hero, the nav, the footer, the repeated card component.
There is no need to wrap everything.

### Copy that quotes a live value

Some sentences wrap a number your app computes — a price, a date, a count. Wrap
one as ordinary text and the editor stores the sentence *as rendered*, so the
saved copy still says `$250` after the price moves.

Pass the values as `vars` and write the source text as a template:

```tsx
<Editable id="checkout.pay" vars={{ deposit: money(quote.depositCents) }}>
  {'Pay {deposit} deposit'}
</Editable>
```

The document stores `Pay {deposit} deposit`. The value is substituted on every
render, so someone can reword the sentence in the browser and the number stays
yours. vedit only ever learns the *name* — it never sees or stores what
`{deposit}` is worth.

The inspector lists the names that resolve. A name you did not supply renders
literally rather than blanking, and is called out as a warning: a half-typed
`{amo` should not make text vanish while someone is still typing, and a typo
that ships silently is indistinguishable from deliberate copy. Write `{{` and
`}}` for a literal brace.

Reach for this whenever the alternative is a number frozen into saved copy —
especially where the frozen figure could contradict something authoritative,
like the amount a payment processor is about to charge.

### A card per row of your data

Three plan cards, six products, however many the array holds. `repeat` renders
the children once per item:

```jsx
<Editable id="plans" repeat={plans}>
  <div className="card">
    <EditableText id="plan.name" as="h3">Plan</EditableText>
    <EditableText id="plan.cta">Choose this plan</EditableText>
  </div>
</Editable>
```

The array is yours and stays yours. It is passed in on every render and never
written to the document — the same rule `vars` follows, for the same reason: a
repeat over `products` cannot go stale, and cannot freeze a price into saved
copy. There is no expression language here, and there is not going to be one.

The ids are written once, not once per item. Behind them, each item gets its own:
`plan.name` becomes `plan.name~starter`, keyed by the item's own `id`, `key`,
`slug` or `uuid` — pass `repeatKey` if it lives somewhere else. Keying on the
data rather than the position is what makes an edit survive the list changing:
insert a plan at the front and every existing edit stays on the right card.

**Editing a card edits every card.** That is nearly always what someone means —
"change the button on all six" is the reason to want a repeater at all — so it
is the default. The inspector's *Applies to* switch scopes an edit to one card
instead, and an item edit wins over the template for that card. Where one is
set, the panel says so and offers to put it back, rather than letting a template
edit look like it silently did nothing.

For a card that shows its own name and price, use `vars` inside the repeat:

```jsx
function PlanCard() {
  const plan = useRepeatItem()?.item
  return (
    <EditableText id="plan.name" as="h3" vars={{ name: plan.name }}>
      {'{name}'}
    </EditableText>
  )
}
```

What this deliberately does not do: add, remove or reorder rows. The host owns
the array, so those controls would be lying about what they can change. They
appear only when the rows are records vedit keeps — that is
[step 11](#11-optional-let-vedit-own-the-content), and it is a different
decision.

---

## 4. Let components declare their own props

The only part of the inspector your code defines. Worth doing for any component
with variants, because it turns "restyle this button" into "choose the variant
that already exists".

```tsx
import { useEditable, type EditableField } from 'vedit'

const FIELDS: EditableField[] = [
  { name: 'variant', label: 'Style', type: 'select', options: ['solid', 'outline', 'ghost'] },
  { name: 'size', type: 'select', options: ['sm', 'md', 'lg'] },
  { name: 'fullWidth', type: 'boolean' },
]

export function Button({ id, children, ...source }) {
  const { ref, veditProps, props } = useEditable({
    id,
    kind: 'component',
    fields: FIELDS,
    props: { variant: 'solid', size: 'md', ...source },
  })

  return (
    <button ref={ref} {...veditProps} className={`btn btn-${props.variant} btn-${props.size}`}>
      {children}
    </button>
  )
}
```

Render from `props`, not from the incoming values — that's what applies the
overrides.

---

## 5. Optional: let people build pages, not just edit them

Register the components a page may be composed from, and put a slot where they go.
The components stay ordinary React; the schema says which props a person may
change.

```tsx
import { defineComponents, VeditProvider, VeditSlot } from 'vedit'
import { Hero, FeatureRow, Pricing } from './blocks'

export const components = defineComponents({
  Hero: {
    component: Hero,
    group: 'Sections',
    fields: [{ name: 'headline', type: 'text' }, { name: 'align', type: 'select', options: ['left', 'center'] }],
    defaults: { headline: 'A headline worth reading', align: 'left' },
  },
  FeatureRow: { component: FeatureRow, group: 'Sections', fields: [] },
})

<VeditProvider components={components}>
  <Nav />
  <VeditSlot id="campaign.sections" as="main">
    <p>Nothing here yet.</p>
  </VeditSlot>
  <Footer />
</VeditProvider>
```

**Check**: open the editor, choose **Insert**, place a Hero. It renders through
your component, and its props are in the inspector.

The same panel also offers the primitives that need no component from you — text,
an image, a box, a button, a link — and six shapes, plus an **Import SVG…**
button for artwork someone drew elsewhere. Those need nothing registered and
nothing configured: a shape is an inline `<svg>` the library renders, styled from
the inspector like any other element. An import is cleaned to an allow-list of
drawing elements before it is stored: a `<script>` or a `<style>` in the file is
dropped and the drawing is kept, and a file with nothing drawable left is refused
with a notice rather than placed as an empty box. Nothing about any of it reaches
your components.

### What you are actually deciding

This is the one step in this guide that changes how the site is maintained, so
decide it deliberately rather than because the API is available.

Inside a slot, the content is no longer in your repository. That has consequences
worth saying out loud:

| | Overrides (steps 2–4) | A slot |
|---|---|---|
| Where the content lives | Your JSX, with edits layered on top | The document, entirely |
| Shows up in a pull request | Yes — the markup is code | No |
| Recovering a bad change | `git revert` | The **History** panel, or your backup of the document |
| Who can restructure the page | Whoever can edit the code | Whoever can open the editor |
| If vedit is removed | The page still renders | The region renders empty |

None of that is a reason to avoid slots — it is the point of them. A marketing
team that can add a section without a deploy is the whole idea. But it means a
slot is a decision about ownership, not a refactor, and the region you choose
should be one you are willing to stop reviewing in diffs.

A good first slot is a region that already changes often and breaks nothing when
it is empty: a campaign band, a promo strip, a list of testimonials. A poor first
slot is your navigation.

Back the document up the way you would back up a database, because after this
step that is what it is. `GET /api/vedit/documents/:key` returns it as JSON.

### Converting a region that already has content

A slot renders what the document says, and a new document is empty — so
converting a region that currently renders real JSX blanks it until someone
rebuilds it by hand. Seed the document first, from the rendered page:

```ts
import { seedFromDom, applySeed } from 'vedit'

const seed = seedFromDom({
  root: document.querySelector('#home-body')!,
  slotId: 'home.body',
  components: [
    { component: 'Hero', selector: '[data-block="hero"]',
      props: (el) => ({ headline: el.querySelector('h1')?.textContent ?? '' }) },
    { component: 'Pricing', selector: '[data-block="pricing"]' },
  ],
})

// Anything unmatched is content the slot will not render. Treat it as a failure.
if (seed.unmatched.length) throw new Error(`unmapped: ${JSON.stringify(seed.unmatched)}`)

await save(applySeed(await load('home'), seed))
```

Run it against a real render of the page as it is today, commit the JSON it
returns, and the slot comes up on day one identical to the region it replaced.
Ids are derived from position rather than randomly, so the script is re-runnable
and its output diffs cleanly. `applySeed` refuses to touch a slot that already
has content, so re-running it can't overwrite anyone's work.

Worth knowing:

- A whole page is a slot with nothing around it; a section of an existing page is
  a slot in the middle of your JSX. Adopt one region at a time.
- `container: true` on a component makes it hold whatever is placed inside it, as
  its `children`.
- The editor wraps a placed component in a `<div>` it owns unless you set
  `wrap: false` — do that when the component spreads its props onto its own root
  and the extra element would break a flex or grid layout.
- Name components for what they are, not where they go: the name is stored in
  every document that places one.

### When a component's props change

Field names are stored in every document that places the component, so renaming
one strands the pages that already exist. Bump `version` and say what moved:

```ts
Hero: {
  component: Hero,
  version: 2,
  fields: [{ name: 'title', type: 'text' }],
  migrate: (props, from) => (from < 2 ? { ...props, title: props.headline } : props),
}
```

Old props are brought forward when the page renders, so nothing has to be
migrated ahead of time, and the new shape is written back the next time someone
saves. Opening a page never writes to it.

Keep `migrate` pure and total — it may be handed props from any earlier version,
including ones you have stopped thinking about. Props stored at a version newer
than your code are left alone rather than guessed at, which is what makes a
rollback safe.

---

## 5b. Optional: forms

A form is one of your components with a `fields` prop. The editor configures
which controls it has, what they are called and what counts as valid; your code
renders them and decides where a submission goes.

```tsx
import { useVeditForm } from 'vedit'

export function ContactForm({ fields, action }: { fields?: unknown; action?: string }) {
  const form = useVeditForm({ fields, action, formId: 'contact' })

  return (
    <form {...form.formProps}>
      {form.fields.map((field) => {
        const props = form.fieldProps(field.name)
        const ids = form.describedBy(field.name)
        return (
          <div key={field.name}>
            <label htmlFor={props.id}>{field.label ?? field.name}</label>
            <input type={field.type} placeholder={field.placeholder} {...props} />
            {field.help ? <p id={ids.help}>{field.help}</p> : null}
            {form.errors[field.name] ? (
              <p id={ids.error} role="alert">{form.errors[field.name]}</p>
            ) : null}
          </div>
        )
      })}
      <input {...form.honeypotProps} style={{ position: 'absolute', left: -9999 }} />
      <button type="submit">Send</button>
      {form.status === 'success' ? <p role="status">Thanks.</p> : null}
    </form>
  )
}
```

Register it with a field of type `fields`:

```tsx
ContactForm: {
  component: ContactForm,
  fields: [
    { name: 'fields', label: 'Form fields', type: 'fields' },
    { name: 'action', label: 'Post to', type: 'text' },
  ],
  defaults: {
    action: '/api/contact',
    fields: [
      { name: 'email', label: 'Email', type: 'email',
        rules: [{ kind: 'required' }, { kind: 'email' }] },
    ],
  },
},
```

`fieldProps` returns the wiring that makes a correct form the default: the
`id`/`htmlFor` pair, `aria-describedby` pointing at the help and error text,
`aria-invalid`, and the native `required` and `type` attributes so the form still
degrades to browser validation with no JavaScript.

It also returns `autoComplete`, inferred from the field's type where there is one
obvious token (`email`, `tel`, `url`) and settable per field for the rest —
`name`, `street-address`, `postal-code`. Worth filling in: it is the difference
between someone confirming what their browser already knows and typing their
address out again.

Errors appear when someone leaves a field, and update live afterwards. A submit
with errors focuses the first bad field and posts nothing.

### Where the data goes

`useVeditForm` POSTs JSON to `action`:

```json
{ "formId": "contact", "values": { "email": "someone@example.com" }, "submittedAt": "..." }
```

Or pass `onSubmit` and handle it in code instead. **vedit stores a submission
only into a source you declared.** Without one there is no submissions store
and nothing in the editor to read them in, because the data is the visitor's
and belongs in your backend, next to whatever you already use for email and
retention. With [step 11](#11-optional-let-vedit-own-the-content) your endpoint
can write it into a collection whose access says `create: 'public'`, and it
turns up in the Data panel for whoever may read that source.

`action` must be same-origin or an absolute `https:` URL. An `action` comes out of
the stored document, so an unrestricted one would be a way to redirect every
submission somewhere else.

### What your endpoint still has to do

The rules configured in the editor run in the visitor's browser. They are a
usability feature, not a security boundary — anyone can see them in devtools and
post whatever they like straight to your endpoint.

- **Accept fields you have never heard of.** This is the important one. The point
  of putting the form in the editor is that someone without repo access can add
  "How did you hear about us?" without filing a ticket — so your endpoint has to
  store what arrives rather than reject unknown keys. A strict schema turns a
  person's edit into silence: the field appears on the page, someone fills it in,
  and the answer is dropped with nothing to see. Take the whole `values` object
  and keep it; validate the fields you depend on, and store the rest.
- **Validate again on the server.** Everything the form checks, check there too.
- **Rate limit.** The hidden honeypot field costs nothing and stops the laziest
  bots; it is not spam defense on its own, and a form endpoint is public in a way
  the rest of vedit's API is not.
- **Decide retention.** vedit has no opinion, and no copy of the data.

Validation rules come from a fixed list — required, lengths, min/max, email, URL,
phone, whole number, a named format such as a US ZIP code, and matching another
field. There is deliberately no free-text regex: a rule is stored data that runs
on every keystroke, and a pattern that backtracks catastrophically would hang the
tab of everyone who typed in that field.

---

## 6. Store the edits somewhere real

`localStorage` is for trying it out. For anything shared, point the provider at
your backend and add the matching route.

```tsx
import { VeditProvider, httpAdapter } from 'vedit'

<VeditProvider
  documentKey={pathname}
  adapter={httpAdapter({
    endpoint: '/api/vedit',
    uploadEndpoint: '/api/vedit/upload',
    staged: true,               // adds Save draft / Publish / History
  })}
  enabled={user?.canEditSite}   // the real gate; see step 7
>
```

```ts
// app/api/vedit/route.ts  (Next App Router; the handler is Fetch-standard,
// so Remix, Hono, Workers, Deno and Bun take the same function)
import { createVeditHandler, fileStore } from 'vedit/server'

const handle = createVeditHandler({
  store: fileStore('./content'),                   // swap for your database
  authorize: async (request) => isEditor(request), // required — omitting it throws
})

// Locally, where you want the endpoint open, say so on purpose:
//   import { createUnsafeLocalHandler } from 'vedit/server'
//   const handle = createUnsafeLocalHandler({ store: fileStore('./content') })

export { handle as GET, handle as PUT, handle as POST }
```

A custom store is two methods:

```ts
const store = {
  async read(key, stage = 'published') { return db.overrides.find({ key, stage }) },
  async write(doc, stage = 'published') { await db.overrides.upsert({ key: doc.key, stage, doc }) },
}
```

**Check**: edit, Save draft, reload as a visitor — nothing changed. Publish,
reload — it changed.

---

## 7. Pick document keys

One document per editable page. The default is `window.location.pathname`, which
is usually right. Set `documentKey` explicitly when:

- several routes render the same editable page (use a canonical key),
- one route renders many pages (`product/${slug}`),
- you run several sites off one backend (`acme:/pricing`).

Server-render the document to avoid a flash of the original design:

```tsx
const doc = await store.read(pathname)
<VeditProvider documentKey={pathname} initialDocument={doc}>
```

---

## 8. Decide who can open it

Without `enabled`, the editor is available on `localhost`, in development
builds, and to anyone who adds `?vedit=1`. That last one is fine for a staging
site and wrong for production. In production, pass your own check:

```tsx
enabled={session?.user?.role === 'editor'}
```

`enabled` only controls the editor UI. It does not protect your data — the
`authorize` callback on the handler does that. Set both.

---

## 9. Optional: several pages at once, and collaboration

```tsx
<VeditProvider
  pages={[
    { path: '/', label: 'Home' },
    { path: '/pricing', label: 'Pricing' },
  ]}
  realtime={broadcastChannelRealtime()}   // across tabs, no backend
  user={{ id: user.id, name: user.name }}
>
```

For people on different machines, swap the transport for
`sseRealtime({ endpoint: '/api/vedit/realtime' })` and add:

```ts
// app/api/vedit/realtime/route.ts
import { createRealtimeHandler } from 'vedit/server'
const relay = createRealtimeHandler({ authorize: (request) => isEditor(request) }) // required
// Locally: createUnsafeLocalRealtimeHandler()
export { relay as GET, relay as POST }
```

---

## 10. Optional: let an agent design too

Everything the editor does is also reachable without it — useful for scripted
changes, and for handing a page to an AI agent.

```bash
claude mcp add vedit -- npx -y vedit-mcp --dir ./content
```

Point it at the same documents your adapter writes (`--dir` for files,
`--endpoint` for a deployed site's API). The agent works on the **draft**, so
nothing reaches visitors until someone publishes. Steps 3, 4 and 5 pay off here:
an agent can only change what has an id, it picks a declared variant rather than
inventing one, and with `--components manifest.json` — written at build time with
`componentManifest(registry)` — it can assemble a page out of your components and
no others.

The matching HTTP surface is one more route:

```ts
// app/api/vedit/[...path]/route.ts
import { createVeditApi } from 'vedit/api'
import { fileStore } from 'vedit/server'

const handle = createVeditApi({
  store: fileStore('./content'),
  authorize: (request, { write }) => isEditor(request, { write }),   // required
})
export { handle as GET, handle as PUT, handle as POST, handle as DELETE }
```

Full detail in [API.md](./API.md).

---

## 11. Optional: let vedit own the content

Everything before this step is a layer over content that lives in your
repository. This step is different in kind, the way step 5 was: the products,
the team, the FAQ become records in a store vedit owns, and you are choosing it
over a CMS you would otherwise run beside it. `vedit/content` is that CMS.
Nothing here loads until you pass `content` to the provider, so a site that
stops at step 10 is unchanged.

What you get for it: rows edited on the page they appear on, a file replaced
from the inspector, a nav that is one document for every page, sign-in and roles
without a second system, a Data panel for the tables nobody wants a page for,
and the same records reachable from an agent.

### The schema

Collections and globals are declared in code, and only in code — the editor
never adds a field, which is the line the rest of this library draws. Put them
in a module both the server and the pages import:

```ts
// schema.ts
import { defineCollections, defineGlobals } from 'vedit/content'

export const collections = defineCollections({
  products: {
    label: 'Products',
    titleField: 'title',          // names a record in lists
    orderField: 'position',       // a number field the editor may reorder by
    fields: {
      title: { type: 'text', required: true },
      blurb: 'richtext',          // a bare type is the whole spec
      datasheet: { type: 'file', label: 'Datasheet' },
      category: { type: 'relation', to: 'categories' },
      price: 'number',
      position: 'number',
    },
  },
  categories: {
    label: 'Categories',
    titleField: 'name',
    fields: { name: { type: 'text', required: true } },
  },
  inquiries: {
    fields: { email: { type: 'text', required: true }, message: 'textarea' },
    drafts: false,
    access: { create: 'public', read: 'admin', update: 'admin', delete: 'admin' },
  },
})

export const globals = defineGlobals({
  site: { label: 'Site', fields: { tagline: 'text', contact: 'text' } },
})
```

Field types are `text`, `textarea`, `richtext`, `number`, `boolean`, `date`,
`json`, `select` (with `options`), `image`, `file`, `video`, `relation` (with
`to`, and `many` for a list of ids) and `password`, which is write-only: the
server hashes it and never reads it back. A field carries `label`, `required`,
`help` and `default` when it needs them (`default: 'now'` on a `date` stamps
the moment a record is created), and `hidden: true` keeps a field on the record
but out of the Data panel — an import id, a timestamp, a machine field. A
source can be `hidden` too: it is listed under "Advanced" in Data rather than
beside the content people edit every day. `InferRecord<typeof collections.products>`
is the record type; nothing is generated.

Access is per source, per action — `read`, `create`, `update`, `delete`,
`publish` — and each is a level or a function of the request. The levels are
`public`, `author`, `editor`, `admin`, each including the ones before it; the
defaults are read for everyone, create, update and delete for an author, publish
for an editor. The `inquiries` source above is the shape of a form endpoint:
anyone may add a row, only an admin may see them.

Every collection keeps a draft apart from the live copy, so an edit is invisible
to visitors until published, and keeps the last twenty copies of each record
(`versions` changes the count). `drafts: false` writes straight to what
visitors see, for a source where a draft makes no sense — users, inquiries. A
global is a collection with exactly one record, whose id is `global`.

### The server

One Fetch handler serves records, files and sign-in under one prefix, and mounts
where `createVeditHandler` does:

```ts
// app/vedit/[...path]/route.ts
import { createContentHandler, sqlContentStore, nodeSqliteDriver } from 'vedit/content-server'
import { fsMediaStore } from 'vedit/media'
import { createAuth, usersCollection } from 'vedit/auth'
import { DatabaseSync } from 'node:sqlite'
import { collections, globals } from './schema'

const store = sqlContentStore(nodeSqliteDriver(new DatabaseSync('./content.sqlite')), {
  dialect: 'sqlite',
  collections: { ...collections, _users: usersCollection },   // the store holds users too
  globals,
})
const auth = createAuth({
  store,
  secret: process.env.VEDIT_SECRET!,                          // at least 16 characters
  bootstrap: { email: 'you@example.com', password: process.env.VEDIT_BOOTSTRAP! },
})
await store.init()                                            // creates the tables once

const handle = createContentHandler({
  collections, globals, store,                                // leave _users out here: auth adds it
  media: fsMediaStore('./media'),
  auth,
})
export { handle as GET, handle as HEAD, handle as POST, handle as DELETE }
```

**The store.** `sqlContentStore` creates three tables — `vedit_records`,
`vedit_versions`, `vedit_meta` — and keeps each record as JSON in them, so
adding a field to the schema is a code change and never a migration. It reaches
the database through a driver written against what the driver calls rather
than the library it wraps, so the package needs no database types and you
install only the one you use: `nodeSqliteDriver` for Node's built-in SQLite
(22.13 or newer), `betterSqliteDriver` for `better-sqlite3`, `d1Driver` for a
Cloudflare D1 binding, `postgresDriver` for a `pg` client or pool. Every commit
is one batch — one transaction, or D1's own `batch` — so a save that touches
two sources lands whole or not at all. `where` on `id` is a point read; every
other filter, the ordering and the limit run in process, which is right for
tables of hundreds of rows and would not be for millions. `memoryContentStore`
is the same semantics with no database, for tests, demos and a first look.

A store of your own implements `VeditContentStore` — `init`, `sources`, `list`,
`get`, `commit`, `publish`, `versions`, `restoreVersion` — or, much less work,
a `RowStore` handed to `contentStore`, which adds drafts, publishing and
versions on top of six row operations.

**Media.** `fsMediaStore(dir)` keeps the bytes and a JSON sidecar per file on
disk; `r2MediaStore(bucket)` uses an R2 binding, with the asset in the object's
custom metadata. The handler accepts multipart uploads up to `maxBytes`
(25 MB) of the mime types in `accept` — `DEFAULT_ACCEPT` is images, mp4 and
webm, PDF, zip, the Office formats, plain text and CSV, and nothing a browser
would run — and serves them back with a year-long cache header and a
`Content-Disposition` carrying the original name. Pass `publicUrl` when a CDN
sits in front of the bucket. Uploads need the `upload` capability; anyone may
read.

**Auth.** `createAuth` keeps users in the store as a `_users` collection —
email, name, role, and a `password` field the handler hashes with PBKDF2-SHA256
through `crypto.subtle`, so it runs on Workers as it does on Node. `bootstrap`
creates the first admin on the first request when there are no users; from
then on users are rows in the Data panel, admin-only. `secret` signs the
session token and has to be at least 16 characters; keep it out of the repo.
A sign-in sets an `HttpOnly`, `SameSite=Lax` cookie, `Secure` when the request
came over https, and returns the same token for a script to send as
`Authorization: Bearer …`. A cookie is only honoured on a non-GET request the
browser says came from your own site (`Sec-Fetch-Site`, or `Origin` on older
browsers) — a form another site posts at you is refused with a 403 rather than
acted on. After ten failed sign-ins from one address for one email in fifteen
minutes the next is a 429; that count is kept in memory, so it is per process,
or per isolate on an edge runtime, where it slows an attacker rather than
stopping one.

Roles are a ladder. An author reads drafts, writes, uploads and edits records;
an editor also publishes and deletes; an admin also manages `_users`. The
handler asks the collection's access rule as well, so a source can be narrower
than the role.

Without `auth`, pass `authorize` instead — the same callback the document
handler takes, with a second argument saying what the request is trying to do.
A trusted request acts as an admin and any other as a visitor. Leaving both out
is a `TypeError`; `createUnsafeLocalContentHandler` is the open version, for a
laptop.

Locally, `node example/content-server.mjs` in this repository is the whole thing
in one file, with a memory store and a temp directory, and is what the demo's
`/catalog` pages talk to.

### The client

```tsx
import { VeditProvider, httpAdapter } from 'vedit'
import { httpContentClient } from 'vedit/content'

<VeditProvider
  adapter={httpAdapter({ endpoint: '/vedit', mediaEndpoint: '/vedit/v1/media', staged: true })}
  content={httpContentClient({ endpoint: '/vedit' })}
  enabled="auth"
  sharedKeys={['site']}
>
```

`content` is what turns the rest on. `httpContentClient` talks to the handler
with `credentials: 'same-origin'`, so the session cookie rides along, and keeps
the token a sign-in returns as a bearer for the case where there is no cookie.
`mediaEndpoint` on the adapter points the inspector's Upload and Library at the
same server for files of any kind, in place of `uploadEndpoint` and
`assetsEndpoint`.

`enabled="auth"` hands the question of step 8 to the server: the editor is on
when this person may write or could sign in, and off for everyone else. Someone
who could sign in sees the sign-in form before any page loads, and nothing
else. Keep `enabled` a boolean if you already have a session of your own — the
content client still works, and the two gates are independent.

`sharedKeys` lists the documents every page loads besides its own, for the nav
and the footer below. Each is an ordinary document under that key, saved and
published by the same adapter.

### Rendering records

```tsx
import { Editable, EditableFile, EditableText, useVeditRecords } from 'vedit'

function Catalog() {
  const rows = useVeditRecords('products', { orderBy: 'position' })
  return (
    <Editable id="products" repeat={rows} source="products">
      <div className="card">
        <Editable id="products.title" as="h3" bind="title">Untitled</Editable>
        <Editable id="products.blurb" as="div" bind="blurb" />
        <EditableFile id="products.datasheet" href="#" bind="datasheet">Datasheet</EditableFile>
      </div>
    </Editable>
  )
}

<EditableText id="tagline" bind={{ source: 'site', id: 'global', field: 'tagline' }}>
  Parts that ship the day you order.
</EditableText>
```

`useVeditRecords` returns the rows as this person should see them: a visitor
gets what is published — the `rows` you pass from a server fetch, or one
request for them — and someone editing gets the drafts with their own unsaved
edits laid on top, so a title typed into a card shows in that card and a row
added shows as a card before anything is saved. It never suspends; the first
render is `rows`, `fallback` or nothing. `where`, `orderBy` and `populate`
(relation fields to resolve into the records they point at) are the query.

`repeat` with a `source` says the items are rows of that collection. That is
what lets the children bind by field name, and what makes the inspector show a
**Rows** section on a card — add, duplicate, remove, move up and down — and the
Insert panel offer *Add Products row*. The controls that step 3 said would be
lying are honest here, because the store owns the array.

`bind` says which field a node shows. What is bound is the content: the text,
or the HTML for a `richtext` field, the `src` of an image, the `href` of a link
or file. An edit to it goes to the record rather than to the document, and
styling stays with the document as before — a bold title on one card is still
an override under that card's id. Until the row is known the children render
as written, which is what a visitor sees for a record with no value yet. A
field name resolves against the enclosing repeat; the object form names a
record outright, for a global or a row rendered on its own.

`<EditableFile>` is a link to a download. Unbound, the inspector's **Replace…**
uploads a file and writes its URL into `href`, like an image; bound to a `file`
field, the upload lands in the record as an asset — `{ id, url, kind, name,
mime, size }` — and the page renders its `url`. A bare `<a>` whose `href` ends
in a document extension is picked up as a file by the scanner too.

`scope="site"` on an `<Editable>` puts its overrides in the shared document of
that name rather than the page's, so a nav edited on the home page is already
edited on every other. Children inherit it. The key has to be in `sharedKeys`.

### What the editor shows

With `content` set, the left panel gains a **Data** tab: every source as a
table (title, status, last change), every record as a form built from the
schema, with New and Delete. Edits there go through the same Save and Publish
as the page and are one undo step each. A source the caller may not update
renders read-only; Delete is hidden without the `data:delete` capability.
`_users` is there for an admin, with a password field that stores hashed.

Save commits the record changes first, in one request, then saves the page and
every shared document that changed; the ids the server chose for new rows are
written back into anything that referenced the temporary ones. A commit that
fails keeps the changes, so the next Save sends them once. Publish saves,
publishes each document, then publishes the records committed since the last
one. The Publish button is hidden from a role that may not publish, and Upload
and Replace from one that may not upload — the same rule as an adapter without
`publish`.

**Check**: sign in, edit a bound title, Save — a `curl` of
`/vedit/v1/content/products/<id>?stage=draft` with the cookie shows it, and
without `stage=draft` does not until Publish. Sign out and the page shows the
published copy.

---

## Framework notes

Each of these has a minimal example app under [`examples/`](./examples), built
and exercised in CI: the page is server-rendered, hydrated, the editor is opened
with the keyboard, and an edit is checked to survive a reload. What the tests
drive is the packed tarball, so it is the published bundle that gets verified
rather than the source tree.

**Next.js App Router** — the browser half of the bundle ships `'use client'`, so
you can use `<VeditProvider>` directly in `app/layout.tsx` even though that file
is a Server Component. Children pass through it normally.

**Next.js Pages Router** — wrap in `pages/_app.tsx`.

**Vite / CRA / Remix** — wrap wherever your app root is.

**Astro / islands** — the provider has to wrap the React tree you want to edit,
and the scanner only sees what is inside it. Islands that are separate React
roots each need their own provider, or wrap a single root around them.

**Static export / no server** — `localStorageAdapter()` keeps edits on one
machine; anything shared needs an endpoint.

---

## Things that will bite you

| Symptom | Cause |
| --- | --- |
| Editor opens on a grey canvas that never loads | The page refuses to be framed. `X-Frame-Options: DENY` or a `frame-ancestors` CSP. Allow same-origin framing, or pass `canvas={false}` to edit in place. |
| The editor never opens | `enabled` is false — it defaults to on only for localhost and `NODE_ENV=development`. The console says so in a development build. Add `?vedit=1`, or pass `enabled` yourself. |
| ⌘E does nothing on a deployed staging site | Same cause as above: the hostname isn't local. `?vedit=1` is the quickest check. |
| The editor was working, then stopped after a deploy | The page is holding a stale reference to the editor's chunk, which now 404s. The console says so; a reload fixes it. |
| A whole region of the page became unclickable | Something in your markup carries `data-vedit-ui`. That marks the editor's *own chrome* and makes the subtree inert. To hide generated markup from the scanner while keeping the page editable, use `data-vedit-skip`. |
| An element selects but can never be outlined or dragged | It has no box — `display: contents` is the usual cause. The console names the id. Put the id on the child that actually renders. |
| Edits vanish after a deploy | Ids moved. Scanner ids follow markup; wrap those elements in `<Editable>` with explicit ids. |
| Saved copy quotes a number that is now wrong | The sentence was stored as rendered. Pass the value as `vars` and keep the template — see [copy that quotes a live value](#copy-that-quotes-a-live-value). |
| `{name}` shows up on the live page | That name wasn't in `vars` for this element. The inspector flags it; unknown names render as written rather than blanking. |
| Edits save but visitors don't see them | `staged: true` without pressing Publish, or the visitor is reading `published` while you saved a `draft`. |
| Styles don't apply | Something in your CSS uses `!important`. Overrides use high specificity, not `!important`. |
| A hover style does nothing | It was written at a breakpoint you aren't at. Check which breakpoint is selected in the toolbar. |
| Client state resets when the editor opens | Expected: the canvas loads the page fresh in a frame. `canvas={false}` avoids it. |
| A card has no **Rows** section | The `repeat` has no `source`. Naming the collection is what says the items are its rows. |
| **Add row** adds a record but no card appears | The array came from somewhere other than `useVeditRecords`, so the page never sees the pending row. Render the rows through the hook; it returns exactly what you pass in for a visitor. |
| `createContentHandler` throws about `_users` at startup | `usersCollection` belongs in the *store's* spec, so the store knows the source; the handler adds it to what it serves by itself when `auth` is given. Leave it out of the handler's `collections`. |

---

## Checklist

- [ ] Installed, `<VeditProvider>` wraps the app, `⌘E` opens the editor
- [ ] The elements that matter have explicit `<Editable>` ids
- [ ] Optional: components registered and a `<VeditSlot>` where pages get built
- [ ] Components with variants declare `fields`
- [ ] An adapter points at a real endpoint, with `authorize` on the handler
- [ ] `enabled` is wired to your own auth
- [ ] `initialDocument` is server-rendered, if the framework has a server
- [ ] Edited, published, and confirmed as a signed-out visitor
- [ ] Optional: `vedit/api` mounted with a real `authorize`, or `vedit-mcp`
      pointed at your documents
- [ ] Optional: collections declared in code, `createContentHandler` mounted
      with `auth` or `authorize`, `content` on the provider, and the `secret`
      read from the environment
- [ ] Optional: rows rendered through `useVeditRecords`, bound with `bind`, and
      a Save checked as a draft before Publish
