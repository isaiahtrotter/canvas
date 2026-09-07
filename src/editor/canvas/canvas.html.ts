// The canvas: #world (zoomed content) and #overlay (screen-space chrome, with
// the pixel grid). Keep #world and #overlay free of whitespace text nodes —
// renderCanvas walks #world's children as its reconcile cursor.
export const CANVAS_STAGE = `      <div class="canvas" id="canvas"><div class="world" id="world"></div><div class="overlay" id="overlay"><canvas class="grid" id="grid"></canvas></div></div>`
