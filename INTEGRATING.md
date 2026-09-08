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
the array, so those controls would be lying about what they can change.

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

Errors appear when someone leaves a field, and update live afterwards. A submit
with errors focuses the first bad field and posts nothing.

### Where the data goes

`useVeditForm` POSTs JSON to `action`:

```json
{ "formId": "contact", "values": { "email": "someone@example.com" }, "submittedAt": "..." }
```

Or pass `onSubmit` and handle it in code instead. **vedit never stores a
submission** — there is no submissions store and nothing in the editor to read
them in, because the data is the visitor's and belongs in your backend, next to
whatever you already use for email and retention.

`action` must be same-origin or an absolute `https:` URL. An `action` comes out of
the stored document, so an unrestricted one would be a way to redirect every
submission somewhere else.

### What your endpoint still has to do

The rules configured in the editor run in the visitor's browser. They are a
usability feature, not a security boundary — anyone can see them in devtools and
post whatever they like straight to your endpoint.

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
