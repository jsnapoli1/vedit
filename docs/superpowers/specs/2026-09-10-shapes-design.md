# Shapes, effects and motion

## What this adds

Linework without code. Someone opens the Insert panel, picks a rectangle, a
circle, a line, a triangle, a star, a hexagon — or imports an SVG they drew
elsewhere — and drops it on the page. It scales with the existing width/height
fields and the resize handles, takes a fill and a stroke from the inspector, and
can be given a colour effect (hue, saturation, blur, a drop shadow) and an
animation (spin, pulse, float, fade in, draw) from a fixed list.

Three things ship together because the second and third are what make the first
worth having, and both are useful on every other node too:

1. **A `shape` node kind.** An inline `<svg>` the editor placed, with its geometry
   stored in the document.
2. **Effects.** A `filter` and a `mix-blend-mode` control for any node. A shape
   with a hue-rotate on hover, an image desaturated until it's hovered.
3. **Motion.** A closed set of `@keyframes` presets that any node can use, stored
   as an ordinary `animation` declaration.

Everything here rides on the existing document format. `DOCUMENT_VERSION` does
not move.

## Where the line is

The roadmap's line is *anything a visitor sees, they can change; anything that
decides what the code does, they cannot.* A shape is decoration; it is on the
visible side of the line the way an image is. It cannot take an `onClick`,
cannot fetch, cannot be a link (wrap it in a link if you want that — a link is
already a container). An imported SVG is stripped of anything that executes or
reaches out of the page.

## Why not the other shapes

**Shapes as an `<img src="data:image/svg+xml…">`** would reuse the image kind and
cost nothing. It was rejected because an image is opaque to CSS: no fill, no
stroke, no `draw` animation, and a hue-rotate is all you could do to its colour.
The point is to *style* linework in the inspector, and that needs the SVG inline.

**A canvas-drawing tool** — click-drag a shape onto the page with a pen — is the
Figma gesture and it is out of scope. The Insert panel already has drag-to-place,
which gives you where; the inspector gives you how big. A drawing tool is a
follow-up once the model has held.

**Free-form path editing** — dragging polygon vertices on the page — is likewise
a follow-up. Polygons are edited as a list of points in the inspector, which is
enough to make a chevron out of a triangle. Bézier paths are what "import an SVG"
is for.

**User-typed keyframes** were rejected for the reason user-typed regexes were in
forms: they are stored data that runs on every visitor's page, and `@keyframes`
text is a CSS injection surface. The presets are written and audited once, here.

## The node kind

```ts
export type NodeKind = 'text' | 'image' | 'box' | 'button' | 'link' | 'component' | 'shape'
```

An inserted node with `kind: 'shape'` renders as an outermost `<svg>` element
carrying `data-vedit-id`, so selection, outlines, drag-to-move, resize handles,
the layer tree and every style control work on it unchanged. The geometry lives
on the node's override:

```ts
/** What an inserted shape draws. Coordinates are in a 100 × 100 box. */
export type ShapeSpec =
  /** Fills its box. `rx` rounds the corners, in box units. */
  | { type: 'rect'; rx?: number }
  /** An ellipse filling its box. A circle is a square box. */
  | { type: 'circle' }
  /** From one point to another. */
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  /** A closed polygon. At least three points, at most 256. */
  | { type: 'polygon'; points: Array<[number, number]> }
  /**
   * Markup someone imported. `svg` is the *inner* markup of the file's root
   * `<svg>`, sanitised; `viewBox` is the root's, so the artwork keeps its
   * proportions.
   */
  | { type: 'custom'; svg: string; viewBox: string }

export interface NodeOverride extends StyleLayer {
  // …existing fields…
  /** For an inserted `shape`: what it draws. */
  shape?: ShapeSpec
}
```

Why on the override rather than on `InsertedNode`: editing the geometry is an
edit. It lands in undo, travels to other editors through the per-node diff,
duplicates with `duplicateInserted`, and prunes with `pruneOverride` like any
other field. `InsertedNode` says *that* a shape is there and where; the override
says what it looks like, geometry included.

### Rendering

```html
<svg data-vedit-id="…" data-vedit-kind="shape"
     viewBox="0 0 100 100" preserveAspectRatio="none">
  <circle cx="50" cy="50" r="50" pathLength="1" vector-effect="non-scaling-stroke"/>
</svg>
```

- **Presets use `preserveAspectRatio="none"`**, so the element's CSS `width` and
  `height` — the Layout fields, the resize handles, `transform: scale()` — are
  the whole story of how big it is. A circle in a 200 × 100 box is an ellipse,
  which is what someone dragging a corner handle expects.
- **Custom imports use `xMidYMid meet`**, so a logo isn't squashed by a box of
  the wrong proportions.
- **Preset children carry no `fill`, `stroke` or `stroke-width` attributes.**
  Those are inherited SVG properties, so the stylesheet sets them on the root
  `<svg>` through the ordinary state × breakpoint matrix: `fill`, `stroke`,
  `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray` are style
  properties like any other. Hover states, breakpoints and colour tokens work
  without a line of new code.
- **`vector-effect="non-scaling-stroke"`** so a stroke stays the width someone
  chose when the box is stretched.
- **`pathLength="1"`** on every preset child so the `draw` animation
  (`stroke-dashoffset` from 1 to 0) works on any geometry.
- **Custom SVG artwork keeps its own colours.** An imported file's `fill="#c00"`
  is an attribute on a child, which an inherited value from the root does not
  override. The Fill and Stroke rows still apply to any part of the artwork that
  uses `currentColor` or has no fill set — which is how icon sets are drawn —
  and the Effects section (hue, saturation, brightness) recolours the whole
  thing regardless. The inspector says this under the rows when the shape is
  custom.

Rendering goes through `<Editable as="svg" kind="shape">`; the children are the
preset's elements, or `dangerouslySetInnerHTML` with the **re-sanitised** inner
markup for a custom shape. Sanitising on the way in is not enough: the document
is data, and it can arrive from a store, a script or an agent.

### Defaults

`insert-node` with `kind: 'shape'` requires a `shape`. The defaults it writes:

| shape | style |
|---|---|
| rect, circle, polygon | `display:block; width:160px; height:160px; fill:#94a3b8` |
| line | `display:block; width:160px; height:24px; fill:none; stroke:#94a3b8; strokeWidth:2px; strokeLinecap:round` |
| custom | `display:block; width:160px; height:160px` — the artwork's own colours |

Six presets are offered in the Insert panel and by the MCP server, each a
`ShapeSpec` in `SHAPE_PRESETS`: `rect`, `circle`, `line`, `triangle`, `star`,
`hexagon`. Triangle, star and hexagon are polygons.

### Sanitising an import

`sanitizeSvg(markup, { scope }) → { svg, viewBox } | null` in `runtime/sanitize.ts`,
next to `sanitizeHtml` and `safeUrl`, and used both at import and at render.

- **Allow-list, not deny-list.** Tags: the structural and drawing elements
  (`g`, `defs`, `symbol`, `use`, `path`, `rect`, `circle`, `ellipse`, `line`,
  `polyline`, `polygon`, `text`, `tspan`, `title`, `desc`, `linearGradient`,
  `radialGradient`, `stop`, `clipPath`, `mask`, `pattern`, `filter` and the `fe*`
  primitives). Everything else — `script`, `style`, `foreignObject`, `image`,
  `a`, `animate*`, `set`, `iframe`, anything unknown — is removed with its
  subtree. `<style>` in particular: a `<style>` inside an inline SVG applies to
  the *whole page*, which is a CSS injection through the document.
- **Attributes:** anything starting with `on` is dropped. `href` and
  `xlink:href` are kept only when they start with `#`. A `style` attribute is
  dropped if it contains `url(` pointing anywhere but `#`, or `expression(`,
  `@import`, `javascript:`. Everything else (presentation attributes, `d`,
  `points`, `transform`, `class`, `id`) is kept.
- **Ids are scoped.** Ids in inline SVG are page-global, and every Figma export
  calls its gradient `paint0_linear`. Two imports on one page would share one
  gradient. `scope` prefixes every `id` and rewrites every `url(#x)`,
  `href="#x"` and `xlink:href="#x"` to match. The render path scopes with the
  node id; the import path does not (the stored markup stays portable).
- **Size limit:** 64 KB of markup after sanitising, or the import is refused
  with a notice. A document is saved on every edit and diffed for
  collaborators; a 2 MB illustration belongs in an image.
- **Server side** (no `DOMParser`): a conservative regex pass removes the
  dangerous tags and `on*` attributes, as `sanitizeHtml` already does. The
  browser pass is the real one, and it runs before anything reaches the DOM.

`parseShape(value: unknown) → ShapeSpec | null` in `runtime/shape.ts` is the
untrusted parser: finite numbers, points as pairs, 3–256 of them, `rx` clamped
to 0–50, custom markup passed through `sanitizeSvg`. Anything else is `null`,
and `set-shape` / `insert-node` refuse it. A stored shape that fails to parse at
render draws nothing rather than throwing — a broken override never takes the
page down.

## Effects

Two rows for any node, in a new **Effects** inspector section. Both are ordinary
style properties in the matrix; there is no new document field.

**Filter.** `runtime/filter.ts` parses and serialises `filter` into parts the
way `transform.ts` does, so editing one leaves the rest alone:

```ts
export interface FilterParts {
  blur: number        // px, 0 = none
  brightness: number  // 1 = none
  contrast: number    // 1 = none
  saturate: number    // 1 = none
  hueRotate: number   // deg, 0 = none
  grayscale: number   // 0–1, 0 = none
}
```

`parseFilter`, `serializeFilter` (omits identity parts, `undefined` when all are
identity), `withFilter(current, patch)`. Drop shadow stays on the existing
Shadow row: `box-shadow` doesn't follow an SVG's outline, so for a shape node
the Shadow presets write `filter: drop-shadow(…)` instead, through the same
parts module (`dropShadow?: string`).

**Blend.** A `SelectRow` for `mixBlendMode`: normal, multiply, screen, overlay,
darken, lighten, difference, luminosity.

## Motion

**A closed set of presets**, each a `@keyframes` block written here:

| name | what it does | loops |
|---|---|---|
| `spin` | rotates a full turn | yes |
| `pulse` | scales 1 → 1.06 → 1 | yes |
| `float` | drifts up 8px and back | yes |
| `fadeIn` | opacity 0 → 1 | no |
| `draw` | `stroke-dashoffset` 1 → 0 (with `stroke-dasharray:1`) | no |
| `wiggle` | rotates ±3° | yes |

Stored as the ordinary `animation` declaration —
`animation: vedit-spin 2s linear infinite` — which means it lives in the state ×
breakpoint matrix: an animation on hover only, a different one on mobile, undo,
multi-select, all free. `runtime/animation.ts` has the presets, their default
duration/easing/iteration, `parseAnimation` / `serializeAnimation`, and
`keyframesFor(names)`.

`documentToCss` scans every emitted declaration for `animation` /
`animationName` values naming a `vedit-*` preset and prepends the `@keyframes`
blocks for exactly the presets in use — none when nothing animates, so a page
with no motion emits the same CSS it does today. Unknown names are left to the
host's own stylesheet.

**Reduced motion is respected.** When any preset is in use the emitter also
appends one rule:

```css
@media (prefers-reduced-motion:reduce){[data-vedit-id]{animation-duration:.01ms!important;animation-iteration-count:1!important}}
```

The one `!important` in the codebase, and it is on the visitor's side: a
vestibular preference beats a design choice. `fadeIn` and `draw` end in their
final frame, so nothing disappears.

The **Motion** row sits in the Effects section: a preset select (None + the
six), duration in ms, and a Repeat toggle (once / forever). Choosing a preset
writes its defaults; the row edits the parts.

## Operations

```ts
| { op: 'set-shape'; id: string; shape: ShapeSpec }
```

`insert-node` gains `shape?: ShapeSpec` and requires it for `kind: 'shape'`, the
way it requires `component` for a component. `describeDocument` lists `shape`
among a node's overrides when present. `INSERTED_KINDS` and
`normalizeInserted`'s allow-list gain `shape`, so a stored shape survives a
load. `pruneOverride` drops an undefined `shape`.

MCP: one new tool, `insert_shape` — `parentId`, either `shape` (enum of the six
presets) or `svg` (markup, sanitised server-side and again at render), `index`.
`set-shape` is reachable through `apply_operations`, whose description names it.
The HTTP API is a pass-through and needs nothing.

## The editor

- **Insert panel:** a *Shapes* section after *Elements* with the six presets and
  an *Import SVG…* item that opens a file picker (`.svg`, `image/svg+xml`),
  reads it, sanitises, and inserts a custom shape; a refused file shows a notice
  saying why. All seven click-to-place and drag-to-place like the others.
- **Layers:** a shape icon.
- **Inspector, `kind === 'shape'`:** a *Shape* section above Layout with the
  geometry — corner radius for a rect, the four coordinates for a line, a
  points list (one `x,y` per line) for a polygon, a *Replace…* file button for
  a custom shape — then Fill, Stroke, Stroke width, Line cap, Dash. The
  Appearance section's background Fill control is hidden for shapes (it would
  paint the box behind the artwork, which is what Custom CSS is for), and
  Typography is hidden as it is for images.
- **Inspector, every kind:** the *Effects* section after Appearance — Blur,
  Brightness, Contrast, Saturation, Hue, Grayscale as sliders, Blend as a
  select, Motion as described above.
- Nothing is added to the toolbar or the keyboard tool map. The Insert panel is
  the entry point, as it is for components.

## Testing

Unit, against `dist/`:
- `test/shape.test.mjs` — `parseShape` accepts the five types and refuses
  everything else; `insert-node` writes the right defaults per type and refuses
  a missing shape; `set-shape` round-trips and refuses garbage; `describeDocument`
  reports `shape`; a document with a shape survives `migrateDocument`;
  `pruneOverride` handles it; `SHAPE_PRESETS` all parse.
- `test/security.test.mjs` — `sanitizeSvg` strips `script`, `style`,
  `foreignObject`, `image`, `on*`, external `href`, external `url()` in `style`;
  scopes ids and their references; refuses oversize markup; the server-side
  pass strips the same executable things.
- `test/animation.test.mjs` — parse/serialise, `keyframesFor`, and
  `documentToCss` emits exactly the keyframes in use plus the reduced-motion
  rule, and nothing when nothing animates.
- `test/filter.test.mjs` — parse/serialise/with, identity omitted.
- `test/mcp.test.mjs` — `insert_shape` with a preset and with markup.

Browser, `e2e/shapes.spec.ts`:
- placing a circle renders an `<svg>` with a `<circle>` in the slot, sized by
  the defaults;
- changing Fill in the inspector changes the computed fill of the circle;
- W/H fields resize it;
- importing an SVG through the file picker renders it inline, and a `<script>`
  in the file does not reach the page;
- editing a polygon's points redraws it;
- choosing a Motion preset gives the element a computed `animation-name`;
- a Blur effect gives a computed `filter`;
- undo removes the shape.

The Insert panel screenshot baseline changes and is regenerated inside the
Playwright container, per DEVELOPING.md.

## Documentation

README: a *Shapes* subsection under "Building pages" and `shape` in the document
example. API.md: `set-shape`, the extended `insert-node`, `insert_shape`.
DEVELOPING.md: the three new runtime modules in the repo map, the recipe list,
test counts. CHANGELOG: 0.8.0. ROADMAP: shapes in "what's solid"; a drawing tool
and on-page vertex editing under "worth doing".
