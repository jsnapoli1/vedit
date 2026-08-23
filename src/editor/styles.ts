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
.vedit-toolbar {
  top: 12px; left: 50%; transform: translateX(-50%);
  flex-direction: row; align-items: center; gap: 4px;
  padding: 5px 6px; border-radius: 12px;
}
.vedit-left { top: 12px; left: 12px; bottom: 12px; width: 232px; }
.vedit-right { top: 12px; right: 12px; bottom: 12px; width: 272px; }
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
.vedit-artboard { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.vedit-artboard iframe {
  display: block; border: 0; background: #fff;
  box-shadow: 0 0 0 1px #3a3a3a, 0 30px 80px rgba(0, 0, 0, .55);
}
.vedit-artboard-label {
  position: absolute; top: 0; left: 0; color: #8a8a8a; white-space: nowrap;
  font-family: ui-sans-serif, system-ui, sans-serif; pointer-events: none;
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

/* --------------------------------------------------------------- toasts */
.vedit-toast {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: var(--vedit-panel); border: 1px solid var(--vedit-border);
  border-radius: 8px; padding: 8px 14px; box-shadow: 0 10px 26px rgba(0,0,0,.4);
}
.vedit-toast[data-tone="error"] { border-color: #b4443a; color: #ffb4ac; }

/* ------------------------------------------------- host page, while editing */
html.vedit-editing [data-vedit-id] { cursor: default !important; }
html.vedit-editing [data-vedit-id]:not([data-vedit-inline]) { user-select: none !important; }
html.vedit-editing [data-vedit-inline="true"] { outline: 1.5px solid var(--vedit-accent, #0d99ff); cursor: text !important; }
html.vedit-editing .vedit-inserted-button {
  display: inline-block; padding: 10px 18px; border-radius: 8px;
  background: #0d99ff; color: #fff; text-decoration: none;
}
`
