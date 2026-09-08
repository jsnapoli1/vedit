# Framework examples

One minimal app per framework named in [INTEGRATING.md](../INTEGRATING.md), so
the matrix is something CI checks rather than something the README claims.

| Directory | Framework | What it pins down |
| --- | --- | --- |
| [`next-app`](./next-app) | Next.js App Router | `VeditProvider` used from a Server Component layout, with the editable presets rendered by a Server Component page |
| [`next-pages`](./next-pages) | Next.js Pages Router | the provider in `pages/_app.tsx` |
| [`remix`](./remix) | Remix (Vite) | the provider at the app root, with a real streaming server entry |
| [`astro`](./astro) | Astro islands | one React root that carries its own provider, hydrated with `client:load` |

Vite is already covered by [`../example`](../example), which is the demo the main
e2e suite drives.

## What they check

Each app is built for production and served, then
[`../e2e-frameworks/frameworks.spec.ts`](../e2e-frameworks/frameworks.spec.ts)
asserts four things against it:

1. the page **server-renders** the editable markup — asserted against the raw
   HTTP response, before React boots, so a client-only render can't pass it;
2. it **hydrates** with nothing logged to the console;
3. the editor **opens** on ⌘E;
4. an edit made in the inspector is **still there after a reload**.

They are deliberately small. Their job is to prove the integration points hold on
each framework, not to re-test the editor — that is what the main e2e suite is
for, and duplicating it here would buy four times the CI time for nothing.

## Why the tarball

These install the **packed tarball**, so they exercise the published bundle
rather than the source tree. The App Router app is the one that earns its keep:
remove the `'use client'` directive that `scripts/use-client.mjs` adds after the
build and it fails outright with `Class extends value undefined`. Nothing else in
the test suite catches that.

For the same reason `vedit` is **not** a dependency in any of these
`package.json` files. Their lockfiles pin the framework versions; the library is
installed over the top from a tarball built on the spot.

## Running them

```bash
npm run test:frameworks           # from the repo root
```

See the Testing section of [DEVELOPING.md](../DEVELOPING.md) for the full
sequence, including how to reproduce CI's install.
