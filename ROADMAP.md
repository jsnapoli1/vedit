# Where this is, and what 1.0 would need

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
- **The tests check what ships.** 186 unit tests against `dist/`, 66 browser
  tests against the real editor, plus screenshot baselines and layout invariants.
  CI also installs the packed tarball and resolves its types as a consumer would,
  and checks the MCP binary answers on stdio.
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

### 3. Authoring's remaining two

0.5 shipped the two that mattered most here — dragging from the Insert panel onto
the page, and component schema versioning. Two are left, and neither blocks a
promise about stability so much as it shapes what the promise covers:

- **Slot-typed props.** A `<Card header={…}>` still can't take other components
  as a named prop; a component either has children or it doesn't. `EditableField`
  needs a `blocks` type for that. Worth deciding before 1.0 because it adds a
  field type to a schema the version number will freeze.
- **Repeating over data.** Static props only, deliberately. A repeater over an
  array is the smallest useful step; expression evaluation is where page builders
  turn into bad programming languages, and I'd stay out of it.

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

**0.7–0.9** — publishing under a scoped name. Integrations by other people, and
whatever they turn up. Slot-typed props if they're going to happen before the
surface freezes. Otherwise resist adding features: the gap between here and 1.0
is confidence, not surface area. *(One example app per framework in CI: done.)*

**1.0** — when a second team has shipped a site with it and the API hasn't had to
change to let them.

---

## What I would not add before 1.0

The temptation is more features, because features are the fun part and the list of
things this doesn't do is easy to write. But every one of them widens the API that
1.0 promises to keep. Character-level merging, i18n variants, a hosted backend,
data bindings and expressions — all defensible, none of them the reason someone
would or wouldn't trust this.

The version number is a promise about stability. Earn it with use, not scope.
