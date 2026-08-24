# Where this is, and what 1.0 would need

## The short version

Feature-wise, yes — this is past what most 1.0s ship with. That isn't the
question a version number answers.

**1.0 is a promise**: the public API and the saved document format won't change
without a major version. Two things make that promise risky today:

1. The document format has **no migration path**. `version: 1` is written into
   every document and read by nothing.
2. Nobody has used this on a real site. Every test runs against a demo written
   by the same author as the features it exercises, which is circular.

Neither is a lot of work. Both are the difference between "it works" and "you
can build on it".

Suggested path: **0.2 now, real use, then 1.0.**

---

## What's actually solid

Worth being specific, because the gaps below are easier to read against it.

- **The override model has held.** Interaction states, design tokens, component
  props, multi-page and collaboration were all added after the fact, and none
  needed the document shape or the store reworked. That's the real signal that
  the core is the right shape — not that it works, but that it absorbed five
  large features without a rewrite.
- **Overrides are CSS.** Media queries and `:hover` behave for visitors exactly
  as they do in the editor, and server rendering produces the same paint.
- **Security has had a real pass.** Stored values reach every visitor's page;
  CSS injection, `<style>` escape and executable URL schemes are closed and
  regression-tested.
- **The tests check what ships.** 79 unit tests against `dist/`, 34 browser
  tests against the real editor, plus screenshot baselines and layout invariants.
- **Failures are contained.** A throw inside the editor unmounts the editor, not
  the host's site.

---

## Blockers for 1.0

### 1. Document migration — the important one

`version: 1` is written and never read. Data outlives code: the moment someone
saves a document, the format is a contract. Before freezing it there needs to be
a `migrate(doc)` step on load, a test that a v1 document still opens, and a rule
for what a version bump means.

Without this, any 1.x change to the shape silently strands whatever people have
already saved. Cheap now, expensive later — this is the one I would not skip.

### 2. Real-world use

The demo exercises the features because it was written to. A real site brings
things a demo can't: a CSS framework with its own specificity habits, a design
system with 40 components, `styled-components`, a CMS already in place, a page
that takes four seconds to render, someone who doesn't know what an artboard is.

Two or three real integrations — ideally not by the person who wrote it — will
produce a list of small wrong assumptions. That list is what 1.0 should be.

### 3. Installable by name

`vedit` is taken on npm, the package has never been published, and the work is
on a branch. Today: `npm install github:jsnapoli1/vedit#branch`. For 1.0 it
needs a scoped name, a merge to `main`, and a tagged release.

### 4. The editor can't be driven from a keyboard

Panels aren't reachable by tab, there's no focus management, and no focus trap in
the comment popover. A tool that audits *your* contrast and heading order while
being unusable without a mouse is not something to put a 1.0 on.

### 5. The public API is bigger than the supported API

`src/index.ts` exports 35 names. Some are genuinely public (`VeditProvider`,
`Editable`, the adapters). Some are internals that happen to be exported —
`readLayer`, `mergeStyles`, `pruneOverride`, `computeAutoId`, `scanDom`.
Freezing them means supporting them. They should move behind a `vedit/internal`
entry or come out before the promise is made.

### 6. The framework matrix is claimed, not tested

The README names Next (App and Pages), Remix, Astro and Vite. Only Vite is
exercised; SSR is verified with a synthetic `renderToString`. Next's App Router
in particular has enough sharp edges — RSC boundaries, streaming, route groups —
that "should work" isn't good enough to promise. One example app per framework
in CI would settle it.

---

## Worth doing, not blocking

- **No CHANGELOG and no releases.** Needed the moment anyone else depends on it.
- **The CJS bundle is ~250KB** because the dynamic import can't code-split
  there, so a CJS consumer gets the editor whether or not anyone opens it. ESM
  consumers get ~16KB and load the rest on demand. Either document it plainly or
  drop CJS.
- **Screenshot baselines were generated outside the CI container.** The first CI
  run will say whether the fonts agree. If not, regenerate there once.
- **The relay fans out from one process's memory.** Correct for a team, and
  documented, but a hosted product would want the fan-out swapped.
- **Merging is per node, not per character.** Two people in the same headline
  resolve rather than interleave. Fine, and honest, but it's the thing people
  will ask about.

---

## A proposed shape

**0.2** — migration on load; trim the public surface; keyboard navigation;
CHANGELOG; merge to `main` and tag. Publishable, honest about being young.

**0.3–0.9** — real integrations. Fix what they turn up. One example app per
framework in CI. Resist adding features; the gap between here and 1.0 is
confidence, not surface area.

**1.0** — when a second team has shipped a site with it and the API hasn't had
to change to let them.

---

## What I would not add before 1.0

The temptation is more features, because features are the fun part and the list
of things this doesn't do is easy to write. But every one of them widens the API
that 1.0 promises to keep. Character-level merging, a component library
browser, i18n variants, a hosted backend — all defensible, none of them the
reason someone would or wouldn't trust this.

The version number is a promise about stability. Earn it with use, not scope.
