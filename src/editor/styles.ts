/** The editor chrome ships its own styles so host sites need no CSS import. */
export const EDITOR_CSS = `
.vedit-root {
  --vedit-accent: #0d99ff;
  --vedit-bg: #1e1e1e;
  --vedit-panel: #2c2c2c;
  --vedit-panel-2: #383838;
  --vedit-border: #444;
  --vedit-text: #e8e8e8;
  --vedit-muted: #9b9b9b;
  --vedit-radius: 6px;
  --vedit-left-width: 268px;
  --vedit-right-width: 272px;
  /* Space the floating panels occupy, for anything that has to avoid them. */
  --vedit-gutter-left: calc(var(--vedit-left-width) + 24px);
  --vedit-gutter-right: calc(var(--vedit-right-width) + 24px);
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif;
  font-size: 11px;
  color: var(--vedit-text);
  -webkit-font-smoothing: antialiased;
}
.vedit-root *, .vedit-root *::before, .vedit-root *::after { box-sizing: border-box; }
.vedit-root button { font: inherit; color: inherit; }

/*
 * A visible ring on anything focused by keyboard. The chrome is dark and dense,
 * so the ring is drawn outside the control with an offset rather than as a border
 * that would shift the layout. Nothing here removes an outline without giving one
 * back — an editor that audits other people's contrast can be used without a mouse.
 */
.vedit-root :focus-visible {
  outline: 2px solid var(--vedit-accent);
  outline-offset: 1px;
  border-radius: 4px;
}
.vedit-root .vedit-field:focus-within { outline: 2px solid var(--vedit-accent); outline-offset: 1px; }
.vedit-layer:focus-visible { outline-offset: -2px; }
/* The toolbar itself is only ever focused programmatically, as a place to land. */
.vedit-toolbar:focus, .vedit-toolbar:focus-visible { outline: none; }

/* ---------------------------------------------------------------- surfaces */
.vedit-panel {
  position: fixed;
  pointer-events: auto;
  background: var(--vedit-panel);
  border: 1px solid var(--vedit-border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .38);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/*
 * Centred in the space between the panels rather than on the viewport, so a
 * toolbar that has grown never slides underneath one of them and takes its last
 * buttons out of reach. If it still doesn't fit, it scrolls.
 */
.vedit-toolbar {
  top: 12px;
  left: var(--vedit-gutter-left);
  right: var(--vedit-gutter-right);
  width: max-content;
  max-width: calc(100% - var(--vedit-gutter-left) - var(--vedit-gutter-right) - 24px);
  margin: 0 auto;
  flex-direction: row; align-items: center; justify-content: center;
  /* Wraps rather than scrolling: a control you cannot see is a control you
   * cannot use, and the toolbar grows with the features behind it. */
  flex-wrap: wrap; gap: 4px;
  padding: 5px 6px; border-radius: 12px;
}
.vedit-toolbar > * { flex: none; }
.vedit-toolbar .vedit-divider { height: 18px; align-self: center; }
.vedit-left { top: 12px; left: 12px; bottom: 12px; width: var(--vedit-left-width); }
.vedit-right { top: 12px; right: 12px; bottom: 12px; width: var(--vedit-right-width); }
.vedit-root[data-collapsed="true"] {
  --vedit-gutter-left: 0px;
  --vedit-gutter-right: 0px;
}
.vedit-root[data-collapsed="true"] .vedit-left,
.vedit-root[data-collapsed="true"] .vedit-right { display: none; }

.vedit-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--vedit-border);
  font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--vedit-muted);
  font-size: 10px; flex: none;
}
.vedit-panel-body { overflow: auto; flex: 1; scrollbar-width: thin; }
.vedit-panel-body::-webkit-scrollbar { width: 8px; }
.vedit-panel-body::-webkit-scrollbar-thumb { background: #555; border-radius: 8px; }

/* ---------------------------------------------------------------- buttons */
.vedit-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 26px; padding: 0 9px; border-radius: var(--vedit-radius);
  background: transparent; border: 1px solid transparent; cursor: pointer;
  white-space: nowrap; transition: background .12s ease, border-color .12s ease;
}
.vedit-btn:hover:not(:disabled) { background: var(--vedit-panel-2); }
.vedit-btn[data-active="true"] { background: var(--vedit-accent); color: #fff; }
.vedit-btn:disabled { opacity: .35; cursor: default; }
.vedit-btn-primary { background: var(--vedit-accent); color: #fff; font-weight: 600; }
.vedit-btn-primary:hover:not(:disabled) { background: #0b8ae6; }
.vedit-btn-icon { width: 28px; padding: 0; }
.vedit-divider { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--vedit-border); }
/* Sits in the toolbar's button row, so it wears the same clothes as a button. */
.vedit-page-focus {
  max-width: 132px; color: inherit; font: inherit;
  appearance: none; -webkit-appearance: none;
  border: 1px solid var(--vedit-border); padding-right: 9px;
}
.vedit-page-focus:focus-visible { outline: 2px solid var(--vedit-accent); outline-offset: 1px; }
.vedit-page-focus option { background: var(--vedit-panel); color: var(--vedit-text); }

/* ----------------------------------------------------------------- layers */
.vedit-layer {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 4px 10px; cursor: default; border: 0; background: transparent; text-align: left;
}
.vedit-layer:hover { background: var(--vedit-panel-2); }
.vedit-layer[data-selected="true"] { background: var(--vedit-accent); color: #fff; }
.vedit-layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vedit-layer-kind { color: var(--vedit-muted); flex: none; }
.vedit-layer[data-selected="true"] .vedit-layer-kind { color: rgba(255,255,255,.75); }
.vedit-layer-eye { opacity: 0; flex: none; }
.vedit-layer:hover .vedit-layer-eye, .vedit-layer[data-hidden="true"] .vedit-layer-eye { opacity: .8; }

/* ------------------------------------------------------------------ tabs */
/*
 * Wraps rather than squeezing: with six tabs in a 268px panel, one row turns
 * every label into "Lay…", "Tok…", "Che…". A second row costs 30px and keeps the
 * names readable, which is the whole job of a tab.
 */
.vedit-tabs {
  display: flex; flex: none; flex-wrap: wrap;
  padding: 6px; gap: 2px; border-bottom: 1px solid var(--vedit-border);
}
.vedit-tabs button {
  flex: 1 1 auto; min-width: 62px; height: 24px; padding: 0 6px; border: 0; border-radius: 5px;
  background: transparent; cursor: pointer; color: var(--vedit-muted); font-weight: 600;
  font-size: 11px; letter-spacing: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vedit-tabs button:hover { background: var(--vedit-panel-2); }
.vedit-tabs button[data-active="true"] { background: var(--vedit-panel-2); color: var(--vedit-text); }

/* ---------------------------------------------------------------- tokens */
.vedit-token-chip {
  flex: none; width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
  border: 1px dashed var(--vedit-border); background: transparent; color: var(--vedit-muted);
  font-size: 10px; line-height: 1; padding: 0;
}
.vedit-token-chip:hover { border-color: var(--vedit-accent); color: var(--vedit-text); }
.vedit-token-chip[data-linked="true"] {
  border-style: solid; border-color: var(--vedit-accent); background: var(--vedit-accent); color: #fff;
}
.vedit-token-menu {
  position: absolute; right: 0; top: 24px; z-index: 5; min-width: 168px; max-height: 240px;
  overflow: auto; padding: 4px; background: var(--vedit-panel-2);
  border: 1px solid var(--vedit-border); border-radius: 8px; box-shadow: 0 12px 28px rgba(0,0,0,.45);
}
.vedit-token-menu button {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 7px; border: 0;
  border-radius: 5px; background: transparent; cursor: pointer; text-align: left; color: inherit;
}
.vedit-token-menu button:hover { background: var(--vedit-accent); color: #fff; }
.vedit-token-dot { width: 10px; height: 10px; border-radius: 3px; border: 1px solid rgba(255,255,255,.25); }

/* ---------------------------------------------------------------- images */
.vedit-image-preview {
  position: relative; height: 96px; border-radius: 6px; margin-bottom: 6px; cursor: crosshair;
  background-color: #1a1a1a; background-size: cover; background-position: center;
  border: 1px solid var(--vedit-border);
}
.vedit-focal {
  position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.5);
  pointer-events: none;
}
.vedit-assets {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 6px;
  max-height: 176px; overflow: auto;
}
.vedit-assets button {
  aspect-ratio: 1; border: 1px solid var(--vedit-border); border-radius: 5px; cursor: pointer;
  background-color: #1a1a1a; background-size: cover; background-position: center; padding: 0;
}
.vedit-assets button:hover { border-color: var(--vedit-accent); }

/* --------------------------------------------------------------- history */
.vedit-version {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 12px; border-bottom: 1px solid var(--vedit-border);
}
.vedit-version strong { display: block; font-weight: 600; }
.vedit-version em { display: block; font-style: normal; color: var(--vedit-accent); margin-top: 2px; }

/* ---------------------------------------------------------------- issues */
.vedit-issue-summary { display: flex; gap: 12px; }
.vedit-issue-summary span[data-tone="error"] { color: #ff8f84; }
.vedit-issue-summary span[data-tone="warning"] { color: #f0c674; }
.vedit-issue {
  display: flex; gap: 8px; width: 100%; text-align: left; padding: 8px 12px;
  border: 0; border-bottom: 1px solid var(--vedit-border); background: transparent; cursor: pointer;
  color: inherit;
}
.vedit-issue:hover { background: var(--vedit-panel-2); }
.vedit-issue span { display: block; }
.vedit-issue strong { display: block; font-weight: 600; }
.vedit-issue em { display: block; font-style: normal; color: var(--vedit-muted); margin-top: 2px; }
.vedit-issue code {
  display: block; margin-top: 3px; color: var(--vedit-muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; max-width: 176px;
}
.vedit-issue-dot {
  width: 7px; height: 7px; border-radius: 50%; margin-top: 4px; flex: none;
}
.vedit-issue[data-tone="error"] .vedit-issue-dot { background: #ff5c4d; }
.vedit-issue[data-tone="warning"] .vedit-issue-dot { background: #e8b339; }

/* ------------------------------------------------------------- breadcrumb */
.vedit-breadcrumb {
  display: flex; flex-wrap: wrap; align-items: center; gap: 2px;
  padding: 8px 12px; border-bottom: 1px solid var(--vedit-border); color: var(--vedit-muted);
}
.vedit-breadcrumb button {
  border: 0; background: none; padding: 1px 3px; border-radius: 3px; cursor: pointer;
  color: var(--vedit-muted); max-width: 108px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; vertical-align: bottom;
}
.vedit-breadcrumb button:hover { background: var(--vedit-panel-2); color: var(--vedit-text); }
.vedit-breadcrumb button[data-current="true"] { color: var(--vedit-text); font-weight: 600; }
.vedit-breadcrumb-sep { opacity: .5; }

/* -------------------------------------------------------------- inspector */
.vedit-section { border-bottom: 1px solid var(--vedit-border); padding: 10px 12px 12px; }
.vedit-section-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--vedit-muted); margin-bottom: 9px; cursor: pointer; user-select: none;
}
.vedit-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.vedit-row:last-child { margin-bottom: 0; }
.vedit-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.vedit-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.vedit-label { color: var(--vedit-muted); flex: none; width: 58px; }
.vedit-hint { color: var(--vedit-muted); line-height: 1.5; }

/* ------------------------------------------------------------------ insert */
/* A grab cursor, because these can be dragged onto the page as well as clicked. */
.vedit-insert-item {
  display: block; width: 100%; text-align: left; cursor: grab;
  background: var(--vedit-panel-2); border: 1px solid transparent; border-radius: var(--vedit-radius);
  padding: 7px 9px; margin-top: 4px;
}
.vedit-insert-item:hover:not(:disabled) { border-color: var(--vedit-accent); }
.vedit-insert-item:disabled { opacity: .45; cursor: default; }
.vedit-insert-item:active:not(:disabled) { cursor: grabbing; }
.vedit-insert-name { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.vedit-insert-note { display: block; margin-top: 3px; color: var(--vedit-muted); line-height: 1.45; }

.vedit-field {
  display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;
  height: 26px; padding: 0 6px; border-radius: var(--vedit-radius);
  background: var(--vedit-panel-2); border: 1px solid transparent;
}
.vedit-field:focus-within { border-color: var(--vedit-accent); }
.vedit-field[data-overridden="true"] { box-shadow: inset 2px 0 0 var(--vedit-accent); }
.vedit-field-prefix { color: var(--vedit-muted); flex: none; font-size: 10px; }
.vedit-input {
  flex: 1; min-width: 0; width: 100%; background: none; border: 0; outline: none;
  color: inherit; font: inherit; padding: 0;
}
.vedit-input::placeholder { color: #7a7a7a; }
.vedit-textarea {
  width: 100%; min-height: 68px; resize: vertical; padding: 7px 8px; line-height: 1.5;
  background: var(--vedit-panel-2); border: 1px solid transparent; border-radius: var(--vedit-radius);
  color: inherit; font: inherit; outline: none;
}
.vedit-textarea:focus { border-color: var(--vedit-accent); }
.vedit-select {
  flex: 1; height: 26px; padding: 0 6px; border-radius: var(--vedit-radius);
  background: var(--vedit-panel-2); border: 1px solid transparent; color: inherit;
  font: inherit; outline: none; cursor: pointer; min-width: 0;
}
.vedit-select:focus { border-color: var(--vedit-accent); }
.vedit-segmented { display: flex; gap: 2px; padding: 2px; background: var(--vedit-panel-2); border-radius: var(--vedit-radius); flex: 1; }
.vedit-segmented button {
  flex: 1; height: 22px; border: 0; border-radius: 4px; background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.vedit-segmented button[data-active="true"] { background: var(--vedit-accent); color: #fff; }
.vedit-swatch {
  width: 20px; height: 20px; border-radius: 4px; border: 1px solid rgba(255,255,255,.22);
  flex: none; padding: 0; cursor: pointer; overflow: hidden; position: relative;
  background-image: linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%),
                    linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%);
  background-size: 8px 8px; background-position: 0 0, 4px 4px;
}
.vedit-swatch input { position: absolute; inset: -6px; opacity: 0; cursor: pointer; }
.vedit-swatch span { position: absolute; inset: 0; }
.vedit-reset {
  border: 0; background: none; color: var(--vedit-muted); cursor: pointer; padding: 0 2px;
  opacity: 0; flex: none;
}
.vedit-row:hover .vedit-reset, .vedit-reset[data-visible="true"] { opacity: 1; }
.vedit-reset:hover { color: var(--vedit-text); }

/* ---------------------------------------------------------------- overlay */
.vedit-overlay { position: fixed; inset: 0; pointer-events: none; }
.vedit-rect { position: fixed; pointer-events: none; }
.vedit-rect-hover { outline: 1px solid var(--vedit-accent); outline-offset: 0; }
.vedit-rect-selected { outline: 1.5px solid var(--vedit-accent); }
.vedit-rect-move { pointer-events: auto; cursor: move; }
.vedit-tag {
  position: fixed; pointer-events: none; transform: translateY(-100%);
  background: var(--vedit-accent); color: #fff; padding: 2px 6px; border-radius: 4px 4px 4px 0;
  font-size: 10px; white-space: nowrap; font-weight: 500;
}
.vedit-handle {
  position: fixed; width: 9px; height: 9px; margin: -5px 0 0 -5px;
  background: #fff; border: 1.5px solid var(--vedit-accent); border-radius: 2px;
  pointer-events: auto;
}
.vedit-size {
  position: fixed; transform: translate(-50%, 6px); background: var(--vedit-accent); color: #fff;
  padding: 2px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap; pointer-events: none;
}
.vedit-measure { position: fixed; background: rgba(13,153,255,.16); pointer-events: none; }

/* ---------------------------------------------------------------- canvas */
.vedit-canvas {
  position: fixed; inset: 0; z-index: 2147482999; overflow: hidden;
  background: #1a1a1a;
  background-image: radial-gradient(circle at 1px 1px, #2b2b2b 1px, transparent 0);
  background-size: 24px 24px;
}
.vedit-canvas[data-panning="true"] { cursor: grab; }
.vedit-canvas[data-panning="true"]:active { cursor: grabbing; }
.vedit-artboards { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.vedit-artboard { position: absolute; top: 0; }
/*
 * A page that isn't in focus is hidden, not unmounted — its frame keeps its
 * document, its bridge and its unsaved edits. Hidden by visibility rather than
 * display so the frame still lays out and still reports its height, which is
 * what lets the canvas fit it correctly the moment it comes back.
 */
.vedit-artboard[data-hidden="true"] { visibility: hidden; pointer-events: none; }
.vedit-artboard[data-active="true"] .vedit-artboard-label { color: var(--vedit-text); }
.vedit-artboard[data-active="true"] iframe { box-shadow: 0 0 0 1.5px var(--vedit-accent), 0 30px 80px rgba(0,0,0,.55); }
.vedit-artboard iframe {
  display: block; border: 0; background: #fff;
  box-shadow: 0 0 0 1px #3a3a3a, 0 30px 80px rgba(0, 0, 0, .55);
}
.vedit-artboard-label {
  position: absolute; top: 0; left: 0; color: #8a8a8a; white-space: nowrap;
  font-family: ui-sans-serif, system-ui, sans-serif; cursor: pointer;
}
.vedit-frame-handle {
  position: absolute; top: 0; right: 0; height: 100%; transform: translateX(100%);
  cursor: ew-resize;
}
.vedit-frame-handle:hover { background: rgba(13, 153, 255, .5); }
.vedit-canvas-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #9b9b9b; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px;
}
.vedit-drop {
  position: fixed; background: var(--vedit-accent); border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .5); pointer-events: none;
}
html.vedit-canvas-host, html.vedit-canvas-host body { overflow: hidden !important; }

/* -------------------------------------------------------------- presence */
.vedit-presence { position: fixed; inset: 0; pointer-events: none; }
.vedit-peer-rect { position: fixed; outline: 1.5px solid; pointer-events: none; }
.vedit-peer-tag {
  position: absolute; top: 0; left: 0; transform: translateY(-100%);
  color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 3px 3px 3px 0; white-space: nowrap;
}
.vedit-peer-cursor { position: fixed; pointer-events: none; z-index: 1; }
.vedit-peer-cursor span {
  position: absolute; top: 15px; left: 10px; color: #fff; font-size: 10px; font-weight: 500;
  padding: 2px 6px; border-radius: 8px; white-space: nowrap;
}
.vedit-avatars { display: flex; align-items: center; }
.vedit-avatar {
  width: 24px; height: 24px; border-radius: 50%; margin-left: -6px; border: 2px solid var(--vedit-panel);
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
  font-size: 9px; font-weight: 700; letter-spacing: .02em; cursor: default; flex: none;
}
.vedit-avatar:first-child { margin-left: 0; }
.vedit-avatar[data-self="true"] { box-shadow: 0 0 0 1.5px var(--vedit-accent); }

/* -------------------------------------------------------------- comments */
.vedit-comments-layer { position: fixed; inset: 0; pointer-events: none; }
.vedit-pin-wrap { position: fixed; pointer-events: auto; }
.vedit-pin {
  position: absolute; top: -30px; left: 0; width: 26px; height: 26px; padding: 0;
  border-radius: 50% 50% 50% 2px; border: 2px solid #fff; cursor: pointer;
  color: #fff; font-size: 11px; font-weight: 700; display: inline-flex;
  align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(0,0,0,.35);
}
.vedit-pin[data-resolved="true"] { opacity: .45; }
.vedit-thread {
  position: absolute; top: 2px; left: 32px; width: 252px; z-index: 2;
  background: var(--vedit-panel); border: 1px solid var(--vedit-border); border-radius: 10px;
  padding: 10px; box-shadow: 0 14px 36px rgba(0,0,0,.5); max-height: 60vh; overflow: auto;
}
.vedit-thread-inline {
  position: static; width: auto; box-shadow: none; border-radius: 0; border: 0;
  border-bottom: 1px solid var(--vedit-border); background: var(--vedit-panel-2);
}
.vedit-comment { display: flex; gap: 7px; margin-bottom: 8px; }
.vedit-comment span:last-child { flex: 1; min-width: 0; line-height: 1.45; }
.vedit-comment strong { display: block; font-weight: 600; margin-bottom: 2px; }
.vedit-comment em { font-style: normal; color: var(--vedit-muted); font-weight: 400; margin-left: 4px; }
.vedit-comment-row { border-bottom: 1px solid var(--vedit-border); }
.vedit-comment-row[data-resolved="true"] { opacity: .55; }
.vedit-comment-head {
  display: flex; gap: 7px; width: 100%; text-align: left; padding: 9px 12px; border: 0;
  background: transparent; color: inherit; cursor: pointer;
}
.vedit-comment-head:hover { background: var(--vedit-panel-2); }
.vedit-comment-head span:last-child { flex: 1; min-width: 0; line-height: 1.45; }
.vedit-comment-head strong { display: block; font-weight: 600; margin-bottom: 2px; }
.vedit-comment-head em { font-style: normal; color: var(--vedit-muted); font-weight: 400; }
.vedit-comment-head > span:last-child > em { display: block; margin-top: 3px; }
html.vedit-editing.vedit-commenting [data-vedit-id] { cursor: crosshair !important; }

/* --------------------------------------------------------------- toasts */
.vedit-toast {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: var(--vedit-panel); border: 1px solid var(--vedit-border);
  border-radius: 8px; padding: 8px 14px; box-shadow: 0 10px 26px rgba(0,0,0,.4);
}
.vedit-toast[data-tone="error"] { border-color: #b4443a; color: #ffb4ac; }
.vedit-toast[data-tone="warn"] { border-color: #8a6d2b; color: #f0c674; }

/* ------------------------------------------------- host page, while editing */
html.vedit-editing [data-vedit-id] { cursor: default !important; }
html.vedit-editing [data-vedit-id]:not([data-vedit-inline]) { user-select: none !important; }
html.vedit-editing [data-vedit-inline="true"] { outline: 1.5px solid var(--vedit-accent, #0d99ff); cursor: text !important; }
html.vedit-editing .vedit-inserted-button {
  display: inline-block; padding: 10px 18px; border-radius: 8px;
  background: #0d99ff; color: #fff; text-decoration: none;
}
`
