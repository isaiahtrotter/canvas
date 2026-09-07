// The editor's composition root. mountEditor(root, hooks) renders the shell
// markup into `root`, creates the shared context, installs every module in a
// fixed order, runs the boot sequence, and returns the host-facing API plus
// a cleanup that tears the whole thing down.
//
// Each feature lives in its own folder (see CLAUDE.md for the map). Modules
// never import each other; they reach one another through the typed slots on
// ctx, resolved at call time, so the install order below only has to match
// the order listeners and DOM were registered in — it does not constrain who
// may call whom.
import { MARKUP } from "./markup"
import type { EditorAPI, EditorHooks } from "./core/types"
import { createContext, type EditorContext, type Disposable } from "./core/context"
import { createGeometry } from "./core/geometry"
import { installStore } from "./core/store"
import { installPersist } from "./core/persist"
import { installView } from "./view/view"
import { installMinimap } from "./minimap/minimap"
import { installMeasure } from "./measure/measure"
import { installTools } from "./tools/tools"
import { installTimes } from "./times/times"
import { installCanvas } from "./canvas/render"
import { installLayout } from "./canvas/layout"
import { installLayers } from "./layers/layers"
import { installDrill } from "./selection/drill"
import { installOverlay } from "./selection/overlay"
import { createSnap } from "./selection/snap"
import { installItemGestures } from "./interactions/itemGestures"
import { installDrag } from "./interactions/drag"
import { installCanvasPointer } from "./interactions/canvasPointer"
import { installKeymap } from "./interactions/keymap"
import { installPanel } from "./panel/panel"
import { installSettings } from "./settings/settings"
import { seedDemoText, centerDefaultItems, seedDemoFrame } from "./demo"
// the host-facing types keep their import path
export type { FrameLayout, FrameItem, Fill, FillMode, EditorHooks, EditorAPI } from "./core/types"

export function mountEditor(root: HTMLElement, hooks: EditorHooks = {}): EditorAPI {
    root.innerHTML = MARKUP
    const ctx = createContext(root, hooks)
    const disposers: Array<() => void> = []
    const use = <K extends keyof EditorContext>(slot: K, api: EditorContext[K] & Disposable) => {
        ctx[slot] = api
        if (api.dispose) disposers.push(() => api.dispose())
    }

    // 1. INSTALL — the order the code sat in when this was one file, so listener
    //    registration order (two keydowns, canvas pointermove before pointerdown)
    //    and install-time DOM appends (labels layer, heat key, panel rows) are unchanged.
    use("store", installStore(ctx)) // undo/redo keydown
    use("persist", installPersist(ctx)) // pagehide
    use("geo", createGeometry(ctx))
    use("view", installView(ctx)) // canvas ResizeObserver, wheel, scroll, zoom pill, window blur
    use("minimap", installMinimap(ctx))
    use("measure", installMeasure(ctx)) // canvas pointermove / pointerleave
    use("tools", installTools(ctx))
    use("times", installTimes(ctx)) // heat key appended to .canvas-wrap
    use("canvas", installCanvas(ctx)) // .labels appended to #overlay; fonts.ready
    use("layout", installLayout(ctx))
    use("layers", installLayers(ctx))
    use("drill", installDrill(ctx))
    use("overlay", installOverlay(ctx))
    use("snap", createSnap(ctx))
    use("gestures", installItemGestures(ctx))
    use("drag", installDrag(ctx))
    use("canvasPointer", installCanvasPointer(ctx)) // canvas pointerdown
    use("keymap", installKeymap(ctx)) // main keydown / keyup
    use("panel", installPanel(ctx)) // align row, position fields, fill row, layout section, Versions buttons
    use("settings", installSettings(ctx)) // theme, dialog, switches, resizers

    // 2. SUBSCRIBERS — the canvas first, then the panel, which measures what the canvas just wrote
    ctx.bus.subscribe(ctx.canvas.renderCanvas)
    ctx.bus.subscribe(ctx.panel.update)

    // 3. BOOT
    if (!ctx.persist.loadDoc()) {
        seedDemoText(ctx)
        ctx.canvas.renderCanvas()
        centerDefaultItems(ctx) // needs real measurements from the render above
        seedDemoFrame(ctx)
    }
    ctx.view.applyView()
    ctx.settings.applyTheme()
    ctx.panel.fill.applyBg()
    ctx.settings.renderAvatar()
    ctx.flags.restoring = true
    ctx.store.touchParentFrames() // prime lastText without bumping anything
    ctx.flags.restoring = false
    ctx.canvas.renderCanvas() // re-render with the centered positions
    ctx.panel.buildTextPanel()
    ctx.panel.updateLayoutPanel()
    ctx.panel.updateProps()
    ctx.panel.updateAlignButtons()
    ctx.panel.fill.updateFill()
    ctx.panel.variants.updateButtons()

    // 4. TEARDOWN
    const destroy = () => {
        ctx.disposeDocListeners()
        for (let i = disposers.length - 1; i >= 0; i--) disposers[i]()
        root.innerHTML = ""
    }

    return {
        setFill: (hex, alpha) => ctx.panel.fill.setFill(hex, alpha),
        beginFillGesture: () => ctx.panel.fill.beginGesture(),
        endFillGesture: () => ctx.panel.fill.endGesture(),
        setFont: (font) => ctx.panel.setFont(font),
        destroy,
    }
}
