# Where this is, and what 1.0 would need

## What this is for

A drop-in React library that gives non-technical people real authority over a
site built by developers.

Not authority over everything — that is what makes it droppable rather than a
framework you migrate to. The line is roughly: **anything a visitor sees, they
can change; anything that decides what the code does, they cannot.** Copy,
images, spacing, type, colour, interaction states, which components appear on a
page and in what order, and the fields a form asks for. Not routing, not data
fetching, not business logic, not a way to make the page compute something new.

That line is why the document is overrides and placements rather than a source
of truth. Your components stay yours, the code still decides what is possible,
and the editor decides what is said.

**Forms are inside the line, not an exception to it.** "Add a question to the
contact form" is the same kind of act as "change this heading" — a person who
owns the words owning what is asked. A site the marketing team cannot add a
question to is a site they file a ticket for, which is the thing this exists to
avoid. Collecting a value and sending it to an endpoint is close to a
requirement for any real site, so the library has to support it or route around
itself.

What that costs, stated plainly: someone can add a field the backend has never
heard of. That is the intended behaviour, not a gap — the alternative is a
developer gating every new question, which is the workflow this replaces. It
puts one obligation on the host, and `INTEGRATING.md` names it: **accept unknown
fields and store them.** An endpoint that rejects what it does not recognise
turns a person's edit into silence.

---

## The short version

Feature-wise, this is past what most 1.0s ship with. That isn't the question a
version number answers.

**1.0 is a promise**: the public API and the saved document format won't change
without a major version. The mechanics of that promise exist — the format is
migrated on load, and the supported surface is separated from the internals. As
of 0.3 the product was the whole shape it was aiming at: editing an existing page
and building a new one out of the same components. 0.4 through 0.6 spent
themselves on the gap this document used to describe.

**The gap was real use, and real use has started.** 0.5 and 0.6 came out of
integrations rather than out of the demo, and they produced exactly what was
predicted here: a list of small wrong assumptions, none of them architectural.
Diagnostics for failures that looked identical, `data-vedit-skip`, `vars`, a
trash icon that did nothing. That is the loop working.

What remains is narrower than it was: **publish under a name, and get
integrations by people who didn't write it.** The framework matrix is no longer
on that list — as of this change it is exercised in CI rather than asserted.

Suggested path: **0.6 is out, a second team next, then 1.0.**

---

## What's actually solid

Worth being specific, because the gaps below are easier to read against it.

- **The document model has held.** Interaction states, design tokens, component
  props, multi-page, collaboration, a programmatic API, an MCP server,
  authoring, component schema versioning and host-interpolated copy were all
  added after the fact. The format version has never moved past 1. That's the
  real signal that the core is the right shape: not that it works, but that it
  absorbed ten large features without a rewrite.
- **Overrides are CSS.** Media queries and `:hover` behave for visitors exactly
  as they do in the editor, and server rendering produces the same paint.
- **Documents are safe to keep.** The format is versioned, migrated on load, and
  repaired when it arrives malformed. A document from a newer build keeps its own
  version and its unknown fields rather than being quietly reshaped.
- **Component schemas are versioned too.** A renamed prop no longer strands every
  page that stores the old one. Migrations run on read, so opening a page never
  writes to it; a newer-than-code prop shape is left alone rather than guessed
  at, and a migration that throws costs one component rather than the page.
- **One vocabulary for changes.** The editor, the HTTP API, MCP and any script
  all go through the same operations, so an agent can do exactly what a person
  can — and no more.
- **Authoring didn't cost the invariant.** Pages can be built out of registered
  components without the library rewriting, wrapping or owning any of them, and a
  site can adopt it one slot at a time instead of migrating. `seedFromDom` means
  converting a region doesn't blank it on day one.
- **Security has had a real pass.** Stored values reach every visitor's page;
  CSS injection, `<style>` escape and executable URL schemes are closed and
  regression-tested. `authorize` is required on both server constructors — the
  open configuration has to be asked for by name. The new surfaces go through the
  same door.
- **Failures say something.** The 0.5 diagnostics turned four silent failures
  into one development-build warning each. This was the single largest finding
  from real use, and it was a usability problem, not a correctness one.
- **The tests check what ships.** 262 unit tests against `dist/`, 79 browser
  tests against the real editor, including screenshot baselines and layout
  invariants. CI also installs the packed tarball and resolves its types as a
  consumer would, and checks the MCP binary answers on stdio.
- **Repeating stayed on the right side of the line.** `repeat` takes the host's
  array and renders a template over it; the array is never stored, so a repeat
  can't go stale any more than `vars` can. Editing a card edits every card, which
  is what someone means often enough to be the default, and scoping to one is a
  click. No expressions, no filters, no sorts — the thing that turns page
  builders into bad programming languages didn't get in.
- **Forms collect without the library storing anything.** A form's shape is a
  component prop, so the document format never moved to hold one. Someone with
  no access to the code can add a question, remove one, reorder them and say
  what counts as valid; the answers go to the host's endpoint and never into
  vedit. Validation is a closed set of rules rather than a regex someone types,
  which keeps stored data from running as a pattern against every visitor's
  keystrokes.
- **The framework matrix is tested, not claimed.** Next (App and Pages), Remix
  and Astro islands each have an example app under `examples/`, built for
  production against the packed tarball and driven in CI: server-rendered markup,
  a clean hydration, the editor opened from the keyboard, and an edit that
  survives a reload. The App Router case is the one that earns its keep — strip
  the `'use client'` directive and that build fails outright, which is what makes
  it a test rather than a demo.
- **Failures are contained.** A throw inside the editor unmounts the editor, not
  the host's site.

---

## Blockers for 1.0

### 1. Real use by someone else

Two integrations have now driven two releases. The open question is whose they
were. The bar this document set was "ideally not by the person who wrote it," and
an integration by the author finds a different class of problem than one by a
stranger — the author never mistakes `data-vedit-ui` for `data-vedit-skip`,
because the author named both.

What a real site brings that a demo can't: a CSS framework with its own
specificity habits, a design system with 40 components, `styled-components`, a
CMS already in place, a page that takes four seconds to render, someone who
doesn't know what an artboard is.

One or two more integrations, by other people, is what 1.0 should be waiting on.
Expect the findings to keep looking like 0.5's — diagnostics and naming rather
than architecture.

### 2. Installable by name

`vedit` on npm belongs to someone else and sits at 0.0.2. This package has never
been published. Today: `npm install github:jsnapoli1/vedit#v0.6.0`. For 1.0 it
needs a scoped name, and a published, tagged release. The branch part of this is
done — `main` carries tags through v0.6.0.

### 3. Authoring's remaining one

0.5 shipped the two that mattered most here — dragging from the Insert panel onto
the page, and component schema versioning. The repeater has now landed too. One
is left, and it doesn't block a promise about stability so much as shape what the
promise covers:

- **Slot-typed props.** A `<Card header={…}>` still can't take other components
  as a named prop; a component either has children or it doesn't. `EditableField`
  needs a `blocks` type for that. Worth deciding before 1.0 because it adds a
  field type to a schema the version number will freeze.

Forms added a second question of the same kind, and for the same reason — a
field type is schema, and the version number freezes schema:

- **Host-rendered form fields.** `FormFieldType` is a closed list of ten
  controls. A site with its own date picker, address lookup or file upload can
  style the markup around a field but cannot supply the control itself. The fix
  is the same shape as slot-typed props — a `custom` type naming something the
  host registered — which is why the two are worth deciding together rather than
  one at a time. **File uploads are the case that will come up first**, because
  "collect data" often means a résumé or a photo, and they need storage and size
  limits that only the host can own.

---

## Worth doing, not blocking

- **The MCP server is young.** It works, and it is tested against its own
  protocol handling, but it has not been through a long agent session on a real
  site. Expect the tool descriptions to be the part that needs tuning.
- **The CJS bundle is ~310KB** because the dynamic import can't code-split there,
  so a CJS consumer gets the editor whether or not anyone opens it. ESM consumers
  get ~19KB and load the rest on demand. It has grown with every release, which
  is an argument for deciding rather than deferring: either document it plainly
  or drop CJS.
- **The relay fans out from one process's memory.** Correct for a team, and
  documented, but a hosted product would want the fan-out swapped.
- **Merging is per node, not per character.** Two people in the same headline
  resolve rather than interleave. Fine, and honest, but it's the thing people
  will ask about.
- **The API has no rate limiting or audit trail.** `authorize` is required and
  every write lands in version history, which is enough for a team endpoint and
  not enough for a public one.

---

## A proposed shape

**0.2** — *done*: migration on load, the operations model, the open API, MCP,
keyboard navigation, a trimmed public surface, a changelog.

**0.3** — *done*: the component registry, `<VeditSlot>`, placed components, the
Insert panel, and composition over the API and MCP. Pages can be built, not only
edited.

**0.4** — *done*: `authorize` required on both server constructors, so an open
endpoint has to be named as one. The visual baselines moved into the CI
container.

**0.5** — *done*, and the first release driven by an integration rather than by
the demo: component schema versioning, drag-to-place, per-page focus,
`data-vedit-skip`, `seedFromDom`, four silent failures made loud, and the
inspector's fields given spoken names — the half of accessibility that 0.2 left
undone.

**0.6** — *done*: `vars`, so a sentence wrapping a computed number stays live
instead of freezing at whatever it said when someone edited it. And a trash icon
that removes rather than silently doing nothing.

**0.7** — *done*: forms. Fields, validation and submission configured in the
editor, posted to an endpoint the host owns. The first thing here that collects
rather than displays, and the reason "What this is for" now says so out loud.

**0.8–0.9** — publishing under a scoped name. Integrations by other people, and
whatever they turn up. The two schema questions together if they are going to
happen before the surface freezes: slot-typed props, and host-rendered form
fields. Otherwise resist adding features — the gap between here and 1.0 is
confidence, not surface area. *(One example app per framework in CI: done.)*

**1.0** — when a second team has shipped a site with it and the API hasn't had to
change to let them.

---

## What I would not add before 1.0

The temptation is more features, because features are the fun part and the list of
things this doesn't do is easy to write. But every one of them widens the API that
1.0 promises to keep. Character-level merging, i18n variants, a hosted backend,
and **reading** data — expressions, bindings, filters, sorts — are all defensible,
and none of them is the reason someone would or wouldn't trust this.

**Reading data and collecting it are different questions**, and an earlier draft
of this list ran them together as "data bindings." Reading is where a page
builder grows a programming language: an expression that computes something the
code did not, evaluated against stored text. `repeat` and `vars` went as far in
that direction as this should go — the host supplies the values, the document
stores only names. That restraint still stands.

Collecting is the reverse, and it is inside the line this library draws. A
visitor types something and it leaves for an endpoint the host owns; nothing is
computed and nothing is stored here. Forms shipped for that reason rather than
as an exception — see "What this is for" above. What kept the cost small is that
a form's shape is a component prop, so the document format never moved: the
addition to the frozen surface is one `EditableFieldType` value, one hook, and
the types around them.

Two lines held while adding it. Validation is a closed set of rules rather than a
regex someone types, because a rule is stored data that runs against every
visitor's keystroke — that is precisely where an expression language stops being
free. And submissions go to the host's endpoint and are never stored here, which
kept every vedit write surface gated by `authorize` instead of adding a public,
unauthenticated one the API is not ready for.

The version number is a promise about stability. Earn it with use, not scope.
