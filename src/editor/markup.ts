// The static shell the engine mounts into (root.innerHTML = MARKUP). Each
// component owns its own fragment next to its code; this file only composes
// them, in the original order. The `.app` grid and the `.canvas-wrap` stage
// are layout, not a feature, so they stay here.
import { LAYERS_PANEL } from "./layers/layers.html"
import { CANVAS_STAGE } from "./canvas/canvas.html"
import { TOOL_PILL, TOAST } from "./tools/tools.html"
import { MINIMAP } from "./minimap/minimap.html"
import { ZOOM_PILL } from "./view/zoompill.html"
import { REVEAL_BUTTONS, RESIZERS, SETTINGS_DIALOG } from "./settings/settings.html"
import { SIDE_PANEL } from "./panel/panel.html"

export const MARKUP = `
<div class="app">
${LAYERS_PANEL}
    <div class="canvas-wrap">
${REVEAL_BUTTONS}
${CANVAS_STAGE}
${TOOL_PILL}
${MINIMAP}
${ZOOM_PILL}
${TOAST}
    </div>
${RESIZERS}
${SETTINGS_DIALOG}
${SIDE_PANEL}
  </div>
`
