# Where this is, and what 1.0 would need

## The short version

Feature-wise, this is past what most 1.0s ship with. That isn't the question a
version number answers.

**1.0 is a promise**: the public API and the saved document format won't change
without a major version. As of 0.2 the mechanics of that promise exist — the
format is migrated on load, and the supported surface is separated from the
internals. What's missing is the evidence:

**Nobody has used this on a site the author didn't write.** Every test runs
against a demo written by the same person as the features it exercises, which is
circular. That is now the whole gap.

Suggested path: **0.2 is out, real use next, then 1.0.**

---

## What's actually solid

Worth being specific, because the gaps below are easier to read against it.

- **The override model has held.** Interaction states, design tokens, component
  props, multi-page, collaboration, and then a whole programmatic API and an MCP
  server, were all added after the fact. None needed the document shape or the
  store reworked. That's the real signal that the core is the right shape — not
  that it works, but that it absorbed seven large features without a rewrite.
- **Overrides are CSS.** Media queries and `:hover` behave for visitors exactly
  as they do in the editor, and server rendering produces the same paint.
- **Documents are safe to keep.** The format is versioned, migrated on load, and
  repaired when it arrives malformed. A document from a newer build keeps its own
  version and its unknown fields rather than being quietly reshaped.
- **One vocabulary for changes.** The editor, the HTTP API, MCP and any script
  all go through the same operations, so an agent can do exactly what a person
  can — and no more.
- **Security has had a real pass.** Stored values reach every visitor's page;
  CSS injection, `<style>` escape and executable URL schemes are closed and
  regression-tested. The new surfaces go through the same door.
- **The tests check what ships.** 130 unit tests against `dist/`, 41 browser
  tests against the real editor, plus screenshot baselines and layout invariants.
- **Failures are contained.** A throw inside the editor unmounts the editor, not
  the host's site.

---

## Blockers for 1.0

### 1. Real-world use — the only one that matters now

The demo exercises the features because it was written to. A real site brings
things a demo can't: a CSS framework with its own specificity habits, a design
system with 40 components, `styled-components`, a CMS already in place, a page
that takes four seconds to render, someone who doesn't know what an artboard is.

Two or three real integrations — ideally not by the person who wrote it — will
produce a list of small wrong assumptions. That list is what 1.0 should be.

### 2. Installable by name

`vedit` is taken on npm, the package has never been published, and the work is on
a branch. Today: `npm install github:jsnapoli1/vedit#v0.2.0`. For 1.0 it needs a
scoped name, a merge to `main`, and a tagged release.

### 3. The framework matrix is claimed, not tested

The README names Next (App and Pages), Remix, Astro and Vite. Only Vite is
exercised; SSR is verified with a synthetic `renderToString`. Next's App Router
in particular has enough sharp edges — RSC boundaries, streaming, route groups —
that "should work" isn't good enough to promise. One example app per framework in
CI would settle it.

### 4. Screen readers, as opposed to keyboards

0.2 made the editor keyboard-drivable: focus moves into the chrome, the tree and
tabs are single tab stops with arrow keys, comment threads trap and return focus,
everything has a name and a visible ring. What is still missing is naming the
inspector's own fields — their labels are visual, not `<label>` elements, so a
screen reader announces the control without saying what it is. Cheaper than it
sounds, and worth doing before promising accessibility rather than after.

---

## Worth doing, not blocking

- **The MCP server is young.** It works, and it is tested against its own
  protocol handling, but it has not been through a long agent session on a real
  site. Expect the tool descriptions to be the part that needs tuning.
- **The CJS bundle is ~250KB** because the dynamic import can't code-split there,
  so a CJS consumer gets the editor whether or not anyone opens it. ESM consumers
  get ~16KB and load the rest on demand. Either document it plainly or drop CJS.
- **Screenshot baselines were generated outside the CI container.** The first CI
  run will say whether the fonts agree. If not, regenerate there once.
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
keyboard navigation, a trimmed public surface, a changelog. Publishable, honest
about being young.

**0.3–0.9** — real integrations. Fix what they turn up. One example app per
framework in CI. Resist adding features; the gap between here and 1.0 is
confidence, not surface area.

**1.0** — when a second team has shipped a site with it and the API hasn't had to
change to let them.

---

## What I would not add before 1.0

The temptation is more features, because features are the fun part and the list of
things this doesn't do is easy to write. But every one of them widens the API that
1.0 promises to keep. Character-level merging, a component library browser, i18n
variants, a hosted backend — all defensible, none of them the reason someone would
or wouldn't trust this.

The version number is a promise about stability. Earn it with use, not scope.
