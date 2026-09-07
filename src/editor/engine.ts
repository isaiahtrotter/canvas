// Vanilla-DOM editor engine, ported from reference/multiple_text_editor.jsx.
// mountEditor(root) renders the markup into `root`, wires every interaction,
// and returns a cleanup that tears the whole thing down.
import { MARKUP } from "./markup"
import { absTime, relTime } from "./time"
import { compositeOver, contrastRatio, hexToRgb, isHex, rgbaCss } from "./color"

import {
    type TextItem,
    type FrameItem,
    type FrameLayout,
    type Fill,
    type FillMode,
    type EditorHooks,
    type EditorAPI,
    type Item,
    isFrame,
    isText,
    MIN,
    MAX,
    STEP,
    INSET,
    SIZE_MIN,
    DEFAULT_LINE_HEIGHT,
    lineHeightOf,
    letterSpacingOf,
    PALETTE,
} from "./core/types"
import { createContext, CANVAS_DEFAULT, type EditorContext, type Disposable } from "./core/context"
import { installTools } from "./tools/tools"
import { installSettings } from "./settings/settings"
import { installTimes, HEAT_BG } from "./times/times"
import { installMinimap } from "./minimap/minimap"
import { installLayers } from "./layers/layers"
import { installMeasure } from "./measure/measure"
import { installView } from "./view/view"
import { createGeometry } from "./core/geometry"
import { installDrill } from "./selection/drill"
import { seedDemoText, centerDefaultItems, seedDemoFrame } from "./demo"
import { installCanvas } from "./canvas/render"
import { installLayout, DEFAULT_LAYOUT } from "./canvas/layout"
import { installOverlay } from "./selection/overlay"
import { createSnap } from "./selection/snap"
import { installItemGestures } from "./interactions/itemGestures"
import { installDrag } from "./interactions/drag"
import { installCanvasPointer } from "./interactions/canvasPointer"
import { installKeymap } from "./interactions/keymap"
import { installPanel } from "./panel/panel"
// the host-facing types keep their import path
export type { FrameLayout, FrameItem, Fill, FillMode, EditorHooks, EditorAPI } from "./core/types"

export function mountEditor(root: HTMLElement, hooks: EditorHooks = {}): EditorAPI {
    root.innerHTML = MARKUP
    const ctx = createContext(root, hooks)
    const onDoc = ctx.onDoc
    // each extracted module installs into its ctx slot at the point in this
    // closure where its code used to sit, and hands back its own cleanup
    const disposers: Array<() => void> = []
    const use = <K extends keyof EditorContext>(slot: K, api: EditorContext[K] & Disposable) => {
        ctx[slot] = api
        if (api.dispose) disposers.push(() => api.dispose())
    }
    // the document lives on ctx; these are the same objects (mutated in place, never reassigned)
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const view = ctx.doc.view
    // module slots not yet extracted from this closure: publish the closure's own functions
    ctx.store = {
        touchParentFrames,
        itemById,
        frameById,
        containingFrame,
        selectedItems,
        selectedTextItems,
        selColor,
        singleSelectedFrame,
        addItem,
        addFrame,
        adoptLooseText,
        descendantsOf,
        duplicateItem,
        snapshot,
        pushHistory,
        get lastText() {
            return lastText // a const declared further down; read lazily
        },
        textSig,
    }
    ctx.persist = { scheduleSave }
    ctx.geo = createGeometry(ctx)
    const { nodeSize, boundsOf, selectionBounds, itemBounds, rectContains, frameEnclosing, frameAt, visibleRect } = ctx.geo

    /* ================= ported app ================= */


    /* ================= app state ================= */
    const { subscribe, emit } = ctx.bus

    /* A frame's "edited" time also moves when anything inside it changes.
       Rather than sprinkling bumps through every mutation path, each emit
       diffs text layers against the last emit: a text that changed (moved,
       retyped, restyled, or newly added) bumps the frame that contains it now
       and, if it moved, the one it came from. Undo/redo set `restoring` so a
       restored snapshot keeps the timestamps it was saved with. The switches
       (restoring, carryingFrameDrag, suppressLeaveBump, skipTouch) live in
       ctx.flags, since drags and the side panel flip them too. */
    const lastText = new Map<number, { sig: string; parent: number | null }>()
    function textSig(it: TextItem) {
        return [it.x, it.y, it.text, it.size, it.font, it.weight, it.fill, it.alpha, lineHeightOf(it), letterSpacingOf(it)].join("|")
    }
    function touchParentFrames() {
        if (ctx.flags.skipTouch) return
        const now = Date.now()
        const seen = new Set<number>()
        items.filter(isText).forEach((t) => {
            seen.add(t.id)
            const sig = textSig(t)
            const parent = t.parent ?? null
            const prev = lastText.get(t.id)
            if (!prev || prev.sig !== sig || prev.parent !== parent) {
                if (!ctx.flags.restoring && !ctx.flags.carryingFrameDrag) {
                    t.updatedAt = now
                    const bump = (f: FrameItem | null) => {
                        if (f) f.updatedAt = now
                    }
                    bump(containingFrame(t))
                    if (prev && prev.parent !== parent && !ctx.flags.suppressLeaveBump)
                        bump(frameById(prev.parent)) // the frame it left
                }
                lastText.set(t.id, { sig, parent })
            }
        })
        lastText.forEach((_, id) => {
            if (!seen.has(id)) lastText.delete(id)
        })
    }

    /* ---- undo history: up to 20 steps ---- */
    const HISTORY_MAX = 20
    const history = []
    const redoStack = []
    function snapshot() {
        return {
            items: items.map((it) => Object.assign({}, it)),
            selection: Array.from(selection),
        }
    }
    function pushHistory(pre?: ReturnType<typeof snapshot>) {
        history.push(pre || snapshot())
        if (history.length > HISTORY_MAX) history.shift()
        redoStack.length = 0 // a new action invalidates the redo timeline
    }
    function restore(st) {
        items.length = 0
        st.items.forEach((it) => items.push(Object.assign({}, it)))
        selection.clear()
        st.selection.forEach((id) => selection.add(id))
        ctx.doc.nextId = items.reduce((m, it) => Math.max(m, it.id), 0) + 1
        ctx.flags.restoring = true
        emit()
        ctx.flags.restoring = false
    }
    function undo() {
        if (!history.length) return
        redoStack.push(snapshot())
        if (redoStack.length > HISTORY_MAX) redoStack.shift()
        restore(history.pop())
    }
    function redo() {
        if (!redoStack.length) return
        history.push(snapshot())
        if (history.length > HISTORY_MAX) history.shift()
        restore(redoStack.pop())
    }
    onDoc("keydown", (e) => {
        if (ctx.ui.settingsOpen) return
        if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
            const a = document.activeElement as HTMLElement | null
            if (a && a.isContentEditable) return // let native undo run inside text editing
            e.preventDefault()
            if (e.shiftKey) redo()
            else undo()
        }
    })

    function addItem(props: Partial<TextItem>): TextItem {
        const it: TextItem = Object.assign(
            {
                kind: "text" as const,
                id: ctx.doc.nextId++,
                x: 60,
                y: 60,
                text: "Text",
                size: 16,
                font: "Inter",
                weight: 400,
                opacity: 100,
                fill: "#1c1c1c",
                alpha: 100,
                parent: null,
                updatedAt: Date.now(),
            },
            props
        )
        items.push(it)
        return it
    }
    function frameById(id: number | null | undefined): FrameItem | null {
        if (id == null) return null
        const f = items.find((it) => it.id === id)
        return f && isFrame(f) ? f : null
    }
    // a freshly drawn frame takes in the loose text that sits fully inside it
    function adoptLooseText(f: FrameItem) {
        // top-level text and frames sitting fully inside the new frame join it
        items.forEach((it) => {
            if (it.id !== f.id && it.parent == null && rectContains(f, it)) it.parent = f.id
        })
    }

    function addFrame(props: Partial<FrameItem>): FrameItem {
        const now = Date.now()
        ctx.doc.frameCount++
        const f: FrameItem = Object.assign(
            {
                kind: "frame" as const,
                id: ctx.doc.nextId++,
                x: 0,
                y: 0,
                w: 200,
                h: 150,
                name: "Frame " + ctx.doc.frameCount,
                createdAt: now,
                updatedAt: now,
                fill: "#ffffff",
                alpha: 100,
                parent: null,
            },
            props
        )
        items.push(f)
        return f
    }

    // copy of `it` placed at (x, y); a copied frame gets fresh timestamps
    function duplicateItem(it: Item, x: number, y: number) {
        const { id: _id, ...rest } = it
        if (isFrame(it)) return addFrame({ ...(rest as FrameItem), x, y }) // a copy keeps its timestamps
        return addItem({ ...(rest as TextItem), x, y })
    }

    /* ---- persistence: the document (layers, counters, background, view)
       lives in localStorage so a refresh picks up where you left off ---- */
    const DOC_KEY = "canvas.doc.v1"
    let saveTimer = null
    function saveDoc() {
        try {
            localStorage.setItem(
                DOC_KEY,
                JSON.stringify({ items, nextId: ctx.doc.nextId, frameCount: ctx.doc.frameCount, bg: ctx.doc.bg, view })
            )
        } catch (_) {
            /* storage unavailable or full — the session still works, just doesn't persist */
        }
    }
    function scheduleSave() {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(saveDoc, 150)
    }
    function loadDoc(): boolean {
        try {
            const raw = localStorage.getItem(DOC_KEY)
            if (!raw) return false
            const d = JSON.parse(raw)
            if (!Array.isArray(d.items)) return false
            d.items.forEach((it) => items.push(it))
            // documents from before explicit membership: a text belongs to the
            // smallest frame its top-left corner falls in
            items.filter(isText).forEach((t) => {
                if (t.parent !== undefined) return
                let best: FrameItem | null = null
                items.filter(isFrame).forEach((f) => {
                    const inside = t.x >= f.x && t.y >= f.y && t.x < f.x + f.w && t.y < f.y + f.h
                    if (inside && (!best || f.w * f.h < best.w * best.h)) best = f
                })
                t.parent = best ? best.id : null
            })
            // frames from before explicit nesting: a frame belongs to the
            // smallest frame it sits fully inside
            items.filter(isFrame).forEach((g) => {
                if (g.parent !== undefined) return
                const p = frameEnclosing(g, g.id)
                g.parent = p ? p.id : null
            })
            // text saved before it had its own edit time: inherit its frame's
            items.filter(isText).forEach((t) => {
                if (typeof t.updatedAt === "number") return
                const f = items.find((it) => it.id === t.parent)
                t.updatedAt = f && isFrame(f) ? f.updatedAt : Date.now()
            })
            ctx.doc.nextId = typeof d.nextId === "number" ? d.nextId : items.reduce((m, it) => Math.max(m, it.id), 0) + 1
            ctx.doc.frameCount = typeof d.frameCount === "number" ? d.frameCount : items.filter(isFrame).length
            if (d.bg && isHex(d.bg.hex)) ctx.doc.bg = { hex: d.bg.hex, alpha: d.bg.alpha ?? 100 }
            if (d.view && Number.isFinite(d.view.x) && Number.isFinite(d.view.y) && d.view.z > 0)
                Object.assign(view, d.view)
            return true
        } catch (_) {
            return false
        }
    }
    const onPageHide = () => {
        clearTimeout(saveTimer)
        saveDoc()
    }
    window.addEventListener("pagehide", onPageHide)

    function selectedItems(): Item[] {
        return items.filter((it) => selection.has(it.id))
    }
    // the text layers in the selection — what the Text panel and size widget bind to
    function selectedTextItems(): TextItem[] {
        return items.filter((it): it is TextItem => isText(it) && selection.has(it.id))
    }
    function selColor(id) {
        const sel = selectedTextItems()
        const idx = sel.findIndex((it) => it.id === id)
        return PALETTE[idx % PALETTE.length]
    }

    /* ================= canvas ================= */
    // Chrome that must render at a constant screen size (selection box,
    // handles, marquee, measurement guides) lives in #overlay, in screen space,
    // instead of inside the scaled #world — so a 1px border is 1px at any
    // zoom, with no counter-scaling and no blurry fractional strokes.
    const { app, canvas, world, overlay } = ctx.dom

    /* ---- view: pan + zoom + pixel grid: view/view.ts ---- */
    use("view", installView(ctx))
    // closure-local names for what still lives in this file; extracted modules call through ctx
    const { applyGrid, applyView, zoomCenter, resetView, viewportWorldRect, setSpaceDown, startPan } = ctx.view
    const { toWorld, toScreen, placeScreenRect } = ctx.geo
    /* ---- minimap: minimap/minimap.ts ---- */
    use("minimap", installMinimap(ctx))

    /* ---- Option/Alt measurement + canvas hover tracking: measure/measure.ts ---- */
    use("measure", installMeasure(ctx))

    /* ---- tools + toast: tools/tools.ts ---- */
    use("tools", installTools(ctx))

    /* ---- frame timestamps + heatmap: times/times.ts ---- */
    use("times", installTimes(ctx))

    /* ---- canvas rendering + labels: canvas/render.ts; smart layout + clipping: canvas/layout.ts ---- */
    use("canvas", installCanvas(ctx))
    use("layout", installLayout(ctx))
    const { renderCanvas, relayoutLive, applyWash, renderFrameLabels, placeLabel, labelLayer } = ctx.canvas
    const { applyClips, setLayout, wrapSelectionInLayout, toggleLayout } = ctx.layout

    // handlers look their item up by id at event time, since undo/redo replaces the item objects
    function itemById(id: number): Item | undefined {
        return items.find((i) => i.id === id)
    }

    /* ---- layers panel (parked): layers/layers.ts ---- */
    use("layers", installLayers(ctx))

    // geometry (sizes, bounds, containment, hit-testing) lives in core/geometry.ts

    // the frame holding the item — its recorded parent, text or frame alike
    function containingFrame(it: Item): FrameItem | null {
        return frameById(it.parent)
    }
    /* Everything inside a frame, at any depth: the text it holds directly, the
       frames fully inside it, and the text inside those. This is what moves
       with it, is deleted with it, and is selected by ⌘A inside it. */
    function isInside(it: Item, f: FrameItem): boolean {
        if (it.id === f.id) return false
        for (let p = frameById(it.parent); p; p = containingFrame(p)) if (p.id === f.id) return true
        return false
    }
    function descendantsOf(f: FrameItem): Item[] {
        return items.filter((it) => isInside(it, f))
    }

    /* ---- drilling into nested frames: selection/drill.ts ---- */
    use("drill", installDrill(ctx))
    const { selectTargetFor, leaveUnlessInside, drillInto } = ctx.drill
    function singleSelectedFrame(): FrameItem | null {
        const sel = selectedItems()
        return sel.length === 1 && isFrame(sel[0]) ? sel[0] : null
    }

    /* ---- selection chrome (underlines, selection box, snap lines): selection/overlay.ts; snapping: selection/snap.ts ---- */
    use("overlay", installOverlay(ctx))
    use("snap", createSnap(ctx))
    const { renderUnderlines, renderSelectionOverlay, renderSnapGuides } = ctx.overlay
    const { snapToGuides } = ctx.snap

    /* ---- resize / edit / rename / text placement: interactions/itemGestures.ts ---- */
    use("gestures", installItemGestures(ctx))
    /* ---- select + drag (with snapping, shift-lock, option-duplicate): interactions/drag.ts ---- */
    use("drag", installDrag(ctx))

    /* ---- canvas pointerdown (pan / draw frame / place text / marquee): interactions/canvasPointer.ts ---- */
    use("canvasPointer", installCanvasPointer(ctx))

    /* ---- keyboard (tools, zoom, toggles, ⌘A, nudge, delete, Escape): interactions/keymap.ts ---- */
    use("keymap", installKeymap(ctx))
    const { moveSelection } = ctx.keymap


    /* ================= side panel: panel/ ================= */
    use("panel", installPanel(ctx))

    /* ================= preferences, theme, settings: settings/ ================= */
    use("settings", installSettings(ctx))

    /* ================= wire up ================= */
    subscribe(renderCanvas)

    subscribe(ctx.panel.update)

    if (!loadDoc()) {
        seedDemoText(ctx)
        renderCanvas()
        centerDefaultItems(ctx) // needs real measurements from the render above
        seedDemoFrame(ctx)
    }
    applyView()
    ctx.settings.applyTheme()
    ctx.panel.fill.applyBg()
    ctx.settings.renderAvatar()
    ctx.flags.restoring = true
    touchParentFrames() // prime lastText without bumping anything
    ctx.flags.restoring = false
    renderCanvas() // re-render with the centered positions
    ctx.panel.buildTextPanel()
    ctx.panel.updateLayoutPanel()
    ctx.panel.updateProps()
    ctx.panel.updateAlignButtons()
    ctx.panel.fill.updateFill()
    ctx.panel.variants.updateButtons()

    const destroy = () => {
        ctx.disposeDocListeners()
        clearTimeout(saveTimer)
        window.removeEventListener("pagehide", onPageHide)
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
