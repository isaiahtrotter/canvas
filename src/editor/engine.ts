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
        containingFrame,
        selectedItems,
        singleSelectedFrame,
        addItem,
        addFrame,
        adoptLooseText,
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
    ctx.overlay = { renderUnderlines, renderSelectionOverlay }
    ctx.gestures = { startRenaming, startEditing }
    ctx.drag = { onItemPointerDown }
    ctx.panel = { fill: { applyBg, updateFill } }

    /* ================= ported app ================= */

    const VARIANTS = {
        1: { shape: "bar", ruler: "always", barH: 44 },
        2: {
            shape: "diamond",
            ruler: "hover",
            barH: 42,
            numtagPos: "above",
        },
        3: {
            shape: "bar",
            ruler: "none",
            barH: 42,
            segments: true,
            numtagPos: "below",
        },
    }
    let activeVariant = 1

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

    // Text underlines (hover, multi-select, marquee touch) are drawn here as
    // 1px screen-space lines rather than text-decoration inside the scaled
    // world, so they stay crisp at any zoom. Sits at the glyph baseline,
    // approximated as 0.22em above the bottom of a *natural* (default
    // line-height) line box — independent of the item's actual line height.
    // A taller line box centers its content within the extra space (half
    // above, half below, same as CSS half-leading), so the natural box's top
    // sits half the extra height below the item's own y; the glyph baseline
    // is found from there, not from the bottom of the (possibly much taller)
    // rendered box.
    function renderUnderlines() {
        overlay.querySelectorAll<HTMLElement>(".tunder").forEach((n) => n.remove())
        // hover reflects what a click would select: a text inside a nested
        // frame you haven't entered highlights that frame, not the text
        const lastHover = ctx.ui.lastHover
        const hoveredItem = lastHover && lastHover.isConnected ? itemById(Number(lastHover.dataset.id)) ?? null : null
        const hoverTarget = hoveredItem ? selectTargetFor(hoveredItem) : null
        items.filter(isText).forEach((it) => {
            const node = ctx.nodeFor(it.id)
            if (!node || node === ctx.ui.editingEl) return
            if (!(node.classList.contains("sel-underline") || hoverTarget === it)) return
            let { w, h } = nodeSize(it)
            if (!w) return
            const f = containingFrame(it)
            if (f) w = Math.max(0, Math.min(w, f.x + f.w - it.x)) // the clipped part has no underline
            const naturalH = it.size * DEFAULT_LINE_HEIGHT
            const y = it.y + (h + naturalH) / 2 - it.size * 0.22
            const a = toScreen(it.x, y)
            const u = document.createElement("div")
            u.className = "tunder"
            u.style.left = Math.round(a.x) + "px"
            u.style.top = Math.round(a.y) + "px"
            u.style.width = Math.round(a.x + w * view.z) - Math.round(a.x) + "px"
            overlay.appendChild(u)
        })
        // a child frame (nested inside another) shows no label of its own, so
        // hovering its own body — not its children, which get their normal
        // hover treatment above since they're whatever is actually under the
        // pointer — outlines the whole thing instead. Skipped when it's
        // already the sole selection, which draws this same box as .selbox.
        overlay.querySelectorAll<HTMLElement>(".childframe-hover, .childitem-hover").forEach((n) => n.remove())
        if (
            hoverTarget &&
            isFrame(hoverTarget) &&
            containingFrame(hoverTarget) &&
            hoverTarget.id !== ctx.ui.enteredFrame &&
            !(selection.size === 1 && selection.has(hoverTarget.id))
        ) {
            const box = document.createElement("div")
            box.className = "childframe-hover"
            placeScreenRect(box, itemBounds(hoverTarget))
            overlay.appendChild(box)
            // and a dotted box around each thing directly inside it, so you can
            // see what you'd be getting into before you double-click
            const f = hoverTarget
            const fb = itemBounds(f)
            items
                .filter((it) => (isText(it) ? it.parent === f.id : it.id !== f.id && containingFrame(it)?.id === f.id))
                .forEach((it) => {
                    // clipped to the frame, like the content itself is, so every
                    // dotted box sits inside the frame's own outline
                    const b = itemBounds(it)
                    const x1 = Math.max(b.x, fb.x),
                        y1 = Math.max(b.y, fb.y)
                    const x2 = Math.min(b.x + b.w, fb.x + fb.w),
                        y2 = Math.min(b.y + b.h, fb.y + fb.h)
                    if (x2 <= x1 || y2 <= y1) return
                    const dot = document.createElement("div")
                    dot.className = "childitem-hover"
                    placeScreenRect(dot, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
                    overlay.appendChild(dot)
                })
        }
    }
    /* ---- smart guides while dragging ---- */
    type Rect = { x: number; y: number; w: number; h: number }
    type SnapGuide = { axis: "x" | "y"; at: number; from: number; to: number }
    const SNAP_PX = 6 // screen px of pull
    // the three alignment lines of a box along one axis: start, center, end
    const linesOf = (r: Rect, axis: "x" | "y") =>
        axis === "x" ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h]
    /* Given the moving box (base + current delta) and the layers it may align
       with, find the smallest edge/center-to-edge/center gap per axis within
       the snap radius. Returns the corrected delta plus one guide per snapped
       axis, spanning both the moving box and the layer it snapped to.

       Only siblings count. Inside a frame (`context`), that's the frame
       itself and the other text it holds — nothing outside it. At the top
       level (no context), it's the frames and the loose text — never the
       text tucked inside a frame. */
    function snapToGuides(
        base: Rect,
        dx: number,
        dy: number,
        moving: Set<number>,
        locked: "x" | "y" | null,
        context: FrameItem | null
    ): { dx: number; dy: number; guides: SnapGuide[] } | null {
        const sibling = (it: Item) =>
            context ? it.id === context.id || it.parent === context.id : it.parent == null
        const targets = items.filter((it) => !moving.has(it.id) && sibling(it)).map((it) => itemBounds(it))
        if (!targets.length) return null
        const thr = SNAP_PX / view.z
        const guides: SnapGuide[] = []
        let changed = false
        for (const axis of ["x", "y"] as const) {
            // an axis Shift has pinned stays pinned
            if (locked === "x" && axis === "y") continue
            if (locked === "y" && axis === "x") continue
            const live: Rect = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h }
            const mine = linesOf(live, axis)
            let best: { delta: number; at: number; target: Rect } | null = null
            for (const t of targets) {
                for (const tl of linesOf(t, axis)) {
                    for (const ml of mine) {
                        const delta = tl - ml
                        if (Math.abs(delta) <= thr && (!best || Math.abs(delta) < Math.abs(best.delta)))
                            best = { delta, at: tl, target: t }
                    }
                }
            }
            if (!best) continue
            changed = true
            if (axis === "x") dx += best.delta
            else dy += best.delta
            const snappedLive: Rect = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h }
            // the guide runs along the snapped line, spanning both boxes
            guides.push(
                axis === "x"
                    ? {
                          axis,
                          at: best.at,
                          from: Math.min(snappedLive.y, best.target.y),
                          to: Math.max(snappedLive.y + snappedLive.h, best.target.y + best.target.h),
                      }
                    : {
                          axis,
                          at: best.at,
                          from: Math.min(snappedLive.x, best.target.x),
                          to: Math.max(snappedLive.x + snappedLive.w, best.target.x + best.target.w),
                      }
            )
        }
        return changed ? { dx, dy, guides } : null
    }
    function renderSnapGuides(guides: SnapGuide[]) {
        overlay.querySelectorAll<HTMLElement>(".snapline").forEach((n) => n.remove())
        guides.forEach((g) => {
            const el = document.createElement("div")
            el.className = "snapline"
            if (g.axis === "x") {
                const a = toScreen(g.at, g.from),
                    b = toScreen(g.at, g.to)
                el.style.left = Math.round(a.x) + "px"
                el.style.top = Math.round(a.y) + "px"
                el.style.width = "1px"
                el.style.height = Math.round(b.y) - Math.round(a.y) + "px"
            } else {
                const a = toScreen(g.from, g.at),
                    b = toScreen(g.to, g.at)
                el.style.left = Math.round(a.x) + "px"
                el.style.top = Math.round(a.y) + "px"
                el.style.width = Math.round(b.x) - Math.round(a.x) + "px"
                el.style.height = "1px"
            }
            overlay.appendChild(el)
        })
    }

    // while a frame is being dragged inside another frame, its selection box is
    // hidden so the drop reads cleanly; it comes back on release (see the drag)
    let hideSelBoxWhileNesting = false
    function renderSelectionOverlay() {
        canvas.querySelectorAll<HTMLElement>(".selbox").forEach((n) => n.remove())
        renderFrameLabels()
        renderUnderlines()
        if (ctx.ui.editingEl) {
            // while typing: the same 1px box, sized to the live text, no handles
            const it = items.find((i) => i.id === Number(ctx.ui.editingEl.dataset.id))
            if (!it) return
            const box = document.createElement("div")
            box.className = "selbox editing"
            placeScreenRect(box, itemBounds(it))
            overlay.appendChild(box)
            return
        }
        const b = selectionBounds() // one combined box around everything selected
        if (!b || hideSelBoxWhileNesting) return
        const box = document.createElement("div")
        box.className = "selbox"
        placeScreenRect(box, b)
        const frame = singleSelectedFrame() // a lone frame gets live resize handles
        ;["tl", "tr", "bl", "br"].forEach((c) => {
            const h = document.createElement("div")
            h.className = "selhandle " + c
            if (frame) {
                h.classList.add("resizable")
                h.addEventListener("pointerdown", (e) => startResize(e, frame, c))
            }
            box.appendChild(h)
        })
        if (frame) {
            // edge handles: drag any side to resize from that side alone
            ;["t", "r", "b", "l"].forEach((edge) => {
                const h = document.createElement("div")
                h.className = "seledge " + edge
                h.addEventListener("pointerdown", (e) => startResize(e, frame, edge))
                box.appendChild(h)
            })
        }
        const size = document.createElement("div")
        size.className = "selsize"
        size.textContent = Math.round(b.w) + " × " + Math.round(b.h)
        box.appendChild(size)
        overlay.appendChild(box)
    }

    function startResize(e: PointerEvent, it: FrameItem, corner: string) {
        e.stopPropagation()
        const start = toWorld(e.clientX, e.clientY)
        const o = { x: it.x, y: it.y, w: it.w, h: it.h }
        const pre = snapshot()
        let moved = false
        const MIN_SIZE = 1
        // corners ("tl", "br", ...) touch both axes; an edge handle ("t",
        // "r", ...) is a single letter and only ever touches its own axis —
        // dragging the left/right edge must not also change height, and
        // top/bottom must not also change width.
        const affectsX = corner.includes("l") || corner.includes("r")
        const affectsY = corner.includes("t") || corner.includes("b")
        function mv(ev: PointerEvent) {
            const p = toWorld(ev.clientX, ev.clientY)
            const dx = p.x - start.x,
                dy = p.y - start.y
            if (!moved) {
                moved = true
                pushHistory(pre)
            }
            // the corner opposite the grabbed one stays anchored
            let x = o.x,
                y = o.y,
                w = o.w,
                h = o.h
            if (affectsX) {
                if (corner.includes("l")) {
                    x = Math.min(o.x + dx, o.x + o.w - MIN_SIZE)
                    w = o.x + o.w - x
                } else w = Math.max(MIN_SIZE, o.w + dx)
            }
            if (affectsY) {
                if (corner.includes("t")) {
                    y = Math.min(o.y + dy, o.y + o.h - MIN_SIZE)
                    h = o.y + o.h - y
                } else h = Math.max(MIN_SIZE, o.h + dy)
            }
            it.x = Math.round(x)
            it.y = Math.round(y)
            it.w = Math.round(w)
            it.h = Math.round(h)
            const node = ctx.nodeFor(it.id)
            if (node) {
                node.style.left = it.x + "px"
                node.style.top = it.y + "px"
                node.style.width = it.w + "px"
                node.style.height = it.h + "px"
            }
            applyClips()
            renderSelectionOverlay()
            updateProps()
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            if (moved) {
                it.updatedAt = Date.now()
                // a hugging frame that's been sized by hand stops hugging
                if (it.layout?.sizing === "hug") it.layout = { ...it.layout, sizing: "fixed" }
                emit()
            }
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    function selectAllText(el: HTMLElement) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const s = window.getSelection()
        s.removeAllRanges()
        s.addRange(range)
    }

    function startEditing(el, it) {
        ctx.ui.editingEl = el
        el.style.clipPath = "" // see everything while typing; clipped again on commit
        renderSelectionOverlay()
        const preEdit = snapshot()
        el.setAttribute("contenteditable", "true")
        el.focus()
        selectAllText(el)
        const onInput = () => {
            relayoutLive() // a hugging frame grows and shrinks with the text as you type
            renderSelectionOverlay()
        }
        el.addEventListener("input", onInput)
        function done() {
            el.removeEventListener("input", onInput)
            el.removeAttribute("contenteditable")
            const newText = el.textContent.trim() || "Text"
            if (newText !== it.text) pushHistory(preEdit)
            it.text = newText
            el.removeEventListener("blur", done)
            ctx.ui.editingEl = null
            emit()
        }
        el.addEventListener("blur", done)
        el.addEventListener("keydown", (e) => {
            e.stopPropagation() // don't let Delete/Backspace inside editing delete the layer
            if (e.key === "Enter") {
                e.preventDefault()
                el.blur()
            }
            if (e.key === "Escape") {
                e.preventDefault()
                el.blur() // commits the text via done()
                selection.clear() // and drops the selection entirely
                emit()
            }
        })
    }

    // Double-click a frame's name to rename it inline.
    function startRenaming(nameEl: HTMLElement, it: FrameItem) {
        const pre = snapshot()
        nameEl.setAttribute("contenteditable", "true")
        nameEl.focus()
        selectAllText(nameEl)
        const stop = (e: Event) => e.stopPropagation() // typing/clicking in the name must not drag the frame
        nameEl.addEventListener("pointerdown", stop)
        function done() {
            nameEl.removeAttribute("contenteditable")
            nameEl.removeEventListener("blur", done)
            nameEl.removeEventListener("pointerdown", stop)
            const v = nameEl.textContent.trim() || it.name
            if (v !== it.name) {
                pushHistory(pre)
                it.name = v
                it.updatedAt = Date.now()
            }
            emit()
        }
        nameEl.addEventListener("blur", done)
        nameEl.addEventListener("keydown", (e) => {
            e.stopPropagation()
            if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault()
                nameEl.blur()
            }
        })
    }

    function onItemPointerDown(e: PointerEvent, it: Item, el: HTMLElement) {
        // panning and the frame tool are handled by the canvas — let it bubble
        if (ctx.ui.spaceDown || e.button === 1 || ctx.ui.tool === "frame") return
        if (e.button !== 0) return
        if (el.getAttribute("contenteditable") === "true") return
        e.stopPropagation()
        // inside a nested frame you haven't entered, the click lands on the frame
        leaveUnlessInside(it)
        const target = selectTargetFor(it)
        if (target !== it) {
            it = target
            el = ctx.nodeFor(target.id) ?? el
        }

        if (e.shiftKey) {
            if (selection.has(it.id)) selection.delete(it.id)
            else selection.add(it.id)
            emit()
            return
        }
        if (!selection.has(it.id)) {
            selection.clear()
            selection.add(it.id)
            emit()
        }


        const startX = e.clientX,
            startY = e.clientY
        const startWorld = toWorld(startX, startY) // for the shift-lock's frame-under check
        const starts = selectedItems().map((s) => ({
            it: s,
            x: s.x,
            y: s.y,
            parent: isText(s) ? s.parent ?? null : null,
        }))
        // a frame carries everything inside it — its text, the frames nested
        // in it, and their text — selected or not
        const carried = new Set(starts.map((s) => s.it.id))
        selectedItems()
            .filter(isFrame)
            .forEach((f) => {
                descendantsOf(f).forEach((d) => {
                    if (carried.has(d.id)) return
                    carried.add(d.id)
                    starts.push({ it: d, x: d.x, y: d.y, parent: isText(d) ? d.parent ?? null : null })
                })
            })
        const draggedFrames = new Set(starts.filter((s) => isFrame(s.it)).map((s) => s.it.id))
        // Text moving on its own (not riding along inside a dragged frame)
        // follows the pointer's membership: while the pointer is over a frame
        // the text belongs to it (and is clipped by it); the moment the pointer
        // leaves, the text leaves too.
        // whatever is moving on its own — not riding along inside a dragged
        // frame — follows the pointer's membership, text and frames alike
        const freeItems = starts.filter((s) => !(s.it.parent != null && draggedFrames.has(s.it.parent)))
        // the moving set's combined box at drag start; the live box is this
        // shifted by (dx, dy), so snapping never has to re-measure mid-drag
        const baseBounds = boundsOf(starts.map((s) => s.it))
        const movingIds = new Set(starts.map((s) => s.it.id))
        const preDrag = snapshot() // pre-state: pushed once if the gesture actually moves anything
        let moved = false
        let shiftAxis: "x" | "y" | null = null // sticks once chosen; see mv()
        let duplicated = false
        let copyIds: number[] = [] // the copies left at the origin while option is held
        // .dragging lifts the moving frame above other frames and its carried
        // text above the frame (see CSS). emit() re-renders the DOM, so this
        // is re-applied after a mid-drag duplicate, not just at the start.
        const markDragging = (on: boolean) =>
            starts.forEach((s) => {
                const node = ctx.nodeFor(s.it.id)
                if (node) node.classList.toggle("dragging", on)
            })
        markDragging(true)
        // a mid-gesture re-render: shows/hides the copies without any frame
        // timestamp moving — those settle once, at release
        function rerenderQuiet() {
            ctx.flags.skipTouch = true
            emit()
            ctx.flags.skipTouch = false
            markDragging(true) // the re-render dropped the class
        }
        /* Option (mac) / ctrl (windows) is a live modifier, not a one-shot
           trigger. While it's held, a copy of what's being dragged sits at the
           origin and the item under the pointer is the duplicate. Let go of it
           mid-drag and the copy is withdrawn — you're just moving the original
           again. Press it again and the copy is back. Nothing about frame
           timestamps happens here; the frame the item is dropped in is stamped
           at release, and only that one. */
        function syncDuplicate(alt: boolean) {
            if (!moved) return
            if (alt && !duplicated) {
                duplicated = true
                // the copies stay where the drag began, so they keep the
                // membership from then — pointed at the copied frame when
                // their frame was duplicated along with them
                const copies = new Map<number, number>()
                starts
                    .filter((s) => isFrame(s.it))
                    .forEach((s) => {
                        const c = duplicateItem(s.it, s.x, s.y)
                        copies.set(s.it.id, c.id)
                        copyIds.push(c.id)
                    })
                // a copied frame that sat in a copied frame points at the copy
                copies.forEach((copyId, origId) => {
                    const c = itemById(copyId)
                    const o = itemById(origId)
                    if (c && o && o.parent != null) c.parent = copies.get(o.parent) ?? o.parent
                })
                starts
                    .filter((s) => isText(s.it))
                    .forEach((s) => {
                        const c = duplicateItem(s.it, s.x, s.y) as TextItem
                        c.parent = s.parent == null ? null : copies.get(s.parent) ?? s.parent
                        copyIds.push(c.id)
                        // the copy left behind isn't a content change — it's
                        // exactly what was already there — so it's tracked as
                        // already-settled and never stamps its frame. (A real
                        // future edit to this layer still tracks normally.)
                        lastText.set(c.id, { sig: textSig(c), parent: c.parent ?? null })
                    })
                rerenderQuiet()
            } else if (!alt && duplicated) {
                duplicated = false
                const gone = new Set(copyIds)
                copyIds = []
                for (let i = items.length - 1; i >= 0; i--) if (gone.has(items[i].id)) items.splice(i, 1)
                gone.forEach((id) => lastText.delete(id))
                rerenderQuiet()
            }
        }
        // the modifier can change without the pointer moving
        const onModKey = (e: KeyboardEvent) => {
            if (e.key === "Alt" || e.key === "Control") syncDuplicate(e.type === "keydown")
        }
        document.addEventListener("keydown", onModKey)
        document.addEventListener("keyup", onModKey)
        function mv(ev: PointerEvent) {
            let dx = (ev.clientX - startX) / view.z,
                dy = (ev.clientY - startY) / view.z
            if (!moved && (Math.abs(dx) * view.z > 2 || Math.abs(dy) * view.z > 2)) {
                moved = true
                pushHistory(preDrag)
            }
            // Shift locks the drag to a straight line, horizontal or vertical.
            // dx/dy are always the pointer's total distance from the ORIGINAL
            // start (never accumulated), so the lock never drifts from where
            // the item actually started. Which axis wins is sticky, not just
            // "whichever is bigger right now": a path that trends horizontal
            // still drifts exactly through the point where |dx| equals |dy| at
            // some moment (jitter, or simply crossing that line on the way
            // through), and re-deciding from scratch every frame flips the
            // lock there for an instant before "trending" wins it back. Once
            // an axis is chosen it keeps its grip until the other one clears
            // it by a real margin — a few screen pixels, scaled for zoom — so
            // a momentary near-tie can't flip it.
            if (ev.shiftKey) {
                const HYSTERESIS = 30 / view.z // screen px worth of "clear lead" needed to flip
                if (shiftAxis === null) shiftAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
                else if (shiftAxis === "x" && Math.abs(dy) > Math.abs(dx) + HYSTERESIS) shiftAxis = "y"
                else if (shiftAxis === "y" && Math.abs(dx) > Math.abs(dy) + HYSTERESIS) shiftAxis = "x"
                if (shiftAxis === "x") dy = 0
                else dx = 0
            } else {
                shiftAxis = null // released — the next press re-decides fresh
            }
            /* Smart guides: within a few screen px, the moving box's left /
               center / right (and top / center / bottom) pull onto any other
               layer's matching edge or center, and a guide line spans the two
               while the snap holds. The nearest candidate wins per axis; an
               axis Shift has locked to zero is left alone. */
            // frames are top-level, so a drag that includes one aligns at the
            // root; a text-only drag aligns within whichever frame the pointer
            // is over right now (membership follows the pointer the same way)
            const snapContext = frameAt({ x: startWorld.x + dx, y: startWorld.y + dy }, draggedFrames)
            const snapped =
                moved && baseBounds ? snapToGuides(baseBounds, dx, dy, movingIds, shiftAxis, snapContext) : null
            if (snapped) {
                dx = snapped.dx
                dy = snapped.dy
            }
            renderSnapGuides(snapped ? snapped.guides : [])
            syncDuplicate(ev.altKey || ev.ctrlKey)
            starts.forEach((s) => {
                s.it.x = Math.round(s.x + dx)
                s.it.y = Math.round(s.y + dy)
            })
            if (moved && freeItems.length) {
                // use the same (possibly axis-locked) point the item is actually
                // drawn at, not the raw cursor — otherwise membership could pick
                // a frame the item doesn't visually appear to be over. While the
                // pointer is inside the parent the child stays in it; once the
                // pointer leaves, so does the child.
                const under = frameAt({ x: startWorld.x + dx, y: startWorld.y + dy }, draggedFrames)
                freeItems.forEach((s) => (s.it.parent = under ? under.id : null))
            }
            items.forEach((i2) => {
                const node = canvas.querySelector<HTMLElement>(
                    '[data-id="' + i2.id + '"]'
                )
                if (node) {
                    node.style.left = i2.x + "px"
                    node.style.top = i2.y + "px"
                }
            })
            applyClips()
            // a dragged frame that's currently inside another frame loses its
            // selection box for the duration — it's back the moment you release
            hideSelBoxWhileNesting = starts.some((s) => isFrame(s.it) && containingFrame(s.it) !== null)
            renderSelectionOverlay()
            updateProps() // X/Y readouts follow the drag in real time
        }
        function up() {
            markDragging(false)
            hideSelBoxWhileNesting = false
            renderSnapGuides([])
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            document.removeEventListener("keydown", onModKey)
            document.removeEventListener("keyup", onModKey)
            if (moved) {
                // dragging a frame carries its contents along for the ride —
                // that's not a content edit, so don't let the position diff
                // below bump the frame's timestamp for text that just came along
                const draggedFrame = starts.some((s) => isFrame(s.it))
                if (draggedFrame) ctx.flags.carryingFrameDrag = true
                // the dragged item can only land in one frame — if a copy was
                // left behind along the way, don't also light up whatever it left
                if (duplicated) ctx.flags.suppressLeaveBump = true
                emit()
                ctx.flags.carryingFrameDrag = false
                ctx.flags.suppressLeaveBump = false
            }
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    /* frame tool: drag to draw; a plain click drops a default-sized frame.
       While drawing, the draft looks like the frame it's about to become:
       its name and timestamp above it, and the selection box with the live
       size badge around it. */
    function startFrameDraw(e: PointerEvent) {
        // frames live on integer coordinates, so the draft snaps to the grid as
        // it's drawn: the anchor and every edge round to whole units, and the
        // final frame is exactly what the preview showed
        const s0 = toWorld(e.clientX, e.clientY)
        const s = { x: Math.round(s0.x), y: Math.round(s0.y) }
        let draft: HTMLDivElement | null = null
        let draftBox: HTMLDivElement | null = null
        let draftSize: HTMLDivElement | null = null
        let draftLabel: HTMLDivElement | null = null
        let r: { x: number; y: number; w: number; h: number } | null = null
        function mv(ev: PointerEvent) {
            const p = toWorld(ev.clientX, ev.clientY)
            if (
                !draft &&
                (Math.abs(p.x - s.x) * view.z > 3 || Math.abs(p.y - s.y) * view.z > 3)
            ) {
                draft = document.createElement("div")
                draft.className = "frame-draft"
                world.appendChild(draft)
                draftLabel = document.createElement("div")
                draftLabel.className = "flabel"
                const name = document.createElement("span")
                name.className = "fname"
                name.textContent = "Frame " + (ctx.doc.frameCount + 1) // the name it will get
                const time = document.createElement("span")
                time.className = "ftime"
                time.textContent = relTime(Date.now())
                draftLabel.append(name, time)
                labelLayer.appendChild(draftLabel)
                draftBox = document.createElement("div")
                draftBox.className = "selbox live"
                draftSize = document.createElement("div")
                draftSize.className = "selsize"
                draftBox.appendChild(draftSize)
                overlay.appendChild(draftBox)
            }
            if (!draft) return
            const px = Math.round(p.x),
                py = Math.round(p.y)
            r = {
                x: Math.min(s.x, px),
                y: Math.min(s.y, py),
                w: Math.abs(px - s.x),
                h: Math.abs(py - s.y),
            }
            draft.style.left = r.x + "px"
            draft.style.top = r.y + "px"
            draft.style.width = r.w + "px"
            draft.style.height = r.h + "px"
            if (draftBox) {
                if (!draftBox.isConnected) overlay.appendChild(draftBox) // a redraw may have cleared .selbox nodes
                placeScreenRect(draftBox, r)
                if (draftSize) draftSize.textContent = Math.round(r.w) + " × " + Math.round(r.h)
            }
            if (draftLabel) placeLabel(draftLabel, r.x, r.y, r.w)
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            if (draft) draft.remove()
            if (draftBox) draftBox.remove()
            if (draftLabel) draftLabel.remove()
            const box =
                r && r.w >= 8 && r.h >= 8 ? r : { x: s.x, y: s.y, w: 200, h: 150 }
            pushHistory()
            const f = addFrame({
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.w),
                h: Math.round(box.h),
            })
            const enclosing = frameEnclosing(f, f.id)
            f.parent = enclosing ? enclosing.id : null
            adoptLooseText(f)
            selection.clear()
            selection.add(f.id)
            ctx.tools.setTool("move")
            emit()
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    // text tool: a click drops a new text at that spot (inside whatever
    // frame it lands in) and starts editing it right away, like double-click
    function placeTextAt(e: PointerEvent) {
        const p = toWorld(e.clientX, e.clientY)
        const parent = frameAt(p)
        pushHistory()
        const it = addItem({ x: Math.round(p.x), y: Math.round(p.y), parent: parent ? parent.id : null })
        selection.clear()
        selection.add(it.id)
        ctx.tools.setTool("move")
        emit()
        const el = ctx.nodeFor(it.id)
        if (el) startEditing(el, it)
    }

    /* canvas: pan, frame tool, or marquee drag-select on empty space */
    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
        if (ctx.ui.spaceDown || e.button === 1) {
            e.preventDefault()
            startPan(e)
            return
        }
        if (e.button !== 0) return
        if (ctx.ui.tool === "frame") {
            startFrameDraw(e)
            return
        }
        if (ctx.ui.tool === "text") {
            // focusing the new text node synchronously in this same handler —
            // without this, the browser's own default mousedown-focus
            // behavior can steal focus back once the event finishes, since
            // the actual click target was empty canvas, not the new element
            e.preventDefault()
            placeTextAt(e)
            return
        }
        const t = e.target as HTMLElement
        if (t !== canvas && t !== world && !t.classList.contains("frame")) return
        // clicking away from text being edited: drop the selection now, before
        // the blur commits the edit — otherwise the regular selection box (with
        // handles) flashes for the span between mousedown and mouseup
        if (ctx.ui.editingEl && selection.size) selection.clear()
        ctx.ui.enteredFrame = null // empty canvas: back to the top level
        const rect = canvas.getBoundingClientRect()
        const s = toWorld(e.clientX, e.clientY)
        let marquee: HTMLDivElement | null = null,
            marqueeRect: { x: number; y: number; w: number; h: number } | null = null,
            moved = false

        function hits(r) {
            const out = new Set<number>()
            items.forEach((it) => {
                const { w: iw, h: ih } = nodeSize(it)
                if (isFrame(it)) {
                    // a frame is only swept up once the marquee fully covers it
                    if (
                        it.x >= r.x &&
                        it.y >= r.y &&
                        it.x + iw <= r.x + r.w &&
                        it.y + ih <= r.y + r.h
                    )
                        out.add(it.id)
                } else if (
                    it.x < r.x + r.w &&
                    it.x + iw > r.x &&
                    it.y < r.y + r.h &&
                    it.y + ih > r.y
                )
                    out.add(it.id)
            })
            return out
        }
        function mv(ev: PointerEvent) {
            // clamp to the canvas on screen, then convert to world coords
            const cx = Math.max(rect.left, Math.min(rect.right, ev.clientX))
            const cy = Math.max(rect.top, Math.min(rect.bottom, ev.clientY))
            const p = toWorld(cx, cy)
            if (
                !moved &&
                (Math.abs(cx - e.clientX) > 3 || Math.abs(cy - e.clientY) > 3)
            ) {
                moved = true
                marquee = document.createElement("div")
                marquee.className = "marquee"
                overlay.appendChild(marquee)
            }
            if (!marquee) return
            const x = Math.min(s.x, p.x),
                y = Math.min(s.y, p.y)
            const w = Math.abs(p.x - s.x),
                h = Math.abs(p.y - s.y)
            marqueeRect = { x, y, w, h }
            placeScreenRect(marquee, marqueeRect)
            // live highlight: text the rectangle touches gets the blue underline;
            // a frame it fully covers gets a selection box right away, so you
            // can see the moment it's captured rather than only on release
            const touched = hits(marqueeRect)
            overlay.querySelectorAll<HTMLElement>(".selbox.live").forEach((n) => n.remove())
            items.forEach((it) => {
                if (isFrame(it)) {
                    if (!touched.has(it.id)) return
                    const b = document.createElement("div")
                    b.className = "selbox live"
                    placeScreenRect(b, it)
                    overlay.appendChild(b)
                    return
                }
                const node = ctx.nodeFor(it.id)
                if (node) node.classList.toggle("sel-underline", touched.has(it.id))
            })
            renderUnderlines()
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            if (moved && marquee) {
                const r = marqueeRect || { x: s.x, y: s.y, w: 0, h: 0 }
                marquee.remove()
                selection.clear()
                hits(r).forEach((id) => selection.add(id))
                emit()
            } else {
                selection.clear()
                emit()
            }
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    })

    /* keyboard: tools, zoom, timestamps, delete */
    onDoc("keydown", (e) => {
        if (ctx.ui.settingsOpen) {
            if (e.key === "Escape") {
                e.preventDefault()
                ctx.settings.closeSettings()
            }
            return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === ",") {
            e.preventDefault()
            ctx.settings.openSettings()
            return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
            e.preventDefault()
            ctx.settings.toggleSidebars()
            return
        }
        const a = document.activeElement as HTMLElement | null
        // an active text edit counts as typing even if focus is elsewhere
        const typing =
            !!ctx.ui.editingEl ||
            (a &&
                (a.tagName === "INPUT" ||
                    a.tagName === "SELECT" ||
                    a.isContentEditable))
        if (e.code === "Space" && !typing) {
            if (!ctx.ui.spaceDown) setSpaceDown(true)
            e.preventDefault()
            return
        }
        if (e.key === "Alt") {
            ctx.measure.setAltDown(true)
            return
        }
        const mod = e.metaKey || e.ctrlKey
        if (mod && (e.key === "=" || e.key === "+")) {
            e.preventDefault()
            zoomCenter(1.25)
            return
        }
        if (mod && e.key === "-") {
            e.preventDefault()
            zoomCenter(1 / 1.25)
            return
        }
        if (mod && e.key === "0") {
            e.preventDefault()
            resetView()
            return
        }
        if (mod && (e.key === "a" || e.key === "A")) {
            // editing text (or in a sidebar field): the browser's own select-all
            if (typing) return
            e.preventDefault()
            selectAll()
            return
        }
        if (typing || mod) return
        if (e.shiftKey && (e.key === "T" || e.key === "t")) {
            e.preventDefault()
            ctx.times.toggleTimes()
            return
        }
        if (e.shiftKey && (e.key === "H" || e.key === "h")) {
            e.preventDefault()
            ctx.times.toggleHeat()
            return
        }
        if (e.shiftKey && (e.key === "A" || e.key === "a")) {
            e.preventDefault()
            toggleLayout()
            return
        }
        if (e.key === "v" || e.key === "V") {
            ctx.tools.setTool("move")
            return
        }
        if (e.key === "f" || e.key === "F") {
            ctx.tools.setTool("frame")
            return
        }
        if (e.key === "t" || e.key === "T") {
            ctx.tools.setTool("text")
            return
        }
        if (e.key.startsWith("Arrow") && selection.size) {
            e.preventDefault()
            const step = e.shiftKey ? 10 : 1
            const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
            const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
            nudgeSelection(dx, dy)
            return
        }
        if (e.key === "Escape") {
            if (ctx.ui.tool !== "move") ctx.tools.setTool("move")
            else if (ctx.ui.enteredFrame !== null) {
                // step out: the frame you were in becomes the selection, and its
                // own nested parent (if any) becomes the new context
                const was = frameById(ctx.ui.enteredFrame)
                const up = was ? containingFrame(was) : null
                ctx.ui.enteredFrame = up && containingFrame(up) ? up.id : null
                selection.clear()
                if (was) selection.add(was.id)
                emit()
            } else if (selection.size) {
                selection.clear()
                emit()
            }
            return
        }
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (!selection.size) return
        e.preventDefault()
        pushHistory()
        // a frame takes everything inside it along, nested frames included
        const doomed = new Set(selection)
        items.filter(isFrame).forEach((f) => {
            if (!doomed.has(f.id)) return
            descendantsOf(f).forEach((d) => doomed.add(d.id))
        })
        // a deleted item's frame counts as edited too — unless the frame is
        // being deleted along with it
        const now = Date.now()
        items.forEach((it) => {
            if (!doomed.has(it.id)) return
            const f = containingFrame(it)
            if (f && !doomed.has(f.id)) f.updatedAt = now
        })
        for (let i = items.length - 1; i >= 0; i--) {
            if (doomed.has(items[i].id)) items.splice(i, 1)
        }
        selection.clear()
        emit()
    })
    onDoc("keyup", (e) => {
        if (e.code === "Space") setSpaceDown(false)
        if (e.key === "Alt") ctx.measure.setAltDown(false)
    })

    /* version buttons in the canvas pill */
    root.querySelectorAll<HTMLElement>(".vergroup .vbtn").forEach((b) => {
        b.addEventListener("click", (e) => {
            e.stopPropagation() // keep the demo drawer open through the swap
            activateVariant(Number(b.dataset.v))
        })
    })

    /* ================= widget (selection-bound) ================= */
    function makeWidget(cfg, adapter) {
        const root = document.createElement("div")
        root.className =
            "w shape-" +
            cfg.shape +
            (cfg.numtagPos ? " numtag-" + cfg.numtagPos : "")

        let segWrapEl: HTMLDivElement | null = null

        const track = document.createElement("div")
        track.className = "track"
        if (cfg.barH) track.style.height = cfg.barH + "px"
        if (cfg.segments) {
            const segWrap = document.createElement("div")
            segWrap.style.cssText =
                "position:absolute;inset:0;pointer-events:none;border-radius:10px;overflow:hidden;"
            track.appendChild(segWrap)
            segWrapEl = segWrap
        }

        const ruler = document.createElement("div")
        ruler.className = "ruler"
        let rulerChip = null
        if (cfg.ruler === "always") {
            rulerChip = document.createElement("div")
            rulerChip.className = "rulerchip"
            ruler.appendChild(rulerChip)
        }

        const pillsEl = document.createElement("div")
        pillsEl.className = "pills"

        function cw() {
            return Math.max(1, track.clientWidth - INSET * 2)
        }
        function vToPx(v) {
            v = Math.max(MIN, Math.min(MAX, v)) // a size past the slider's range parks its handle at the end
            return INSET + ((v - MIN) / (MAX - MIN)) * cw()
        }
        function pxToV(px) {
            const p = Math.max(0, Math.min(1, (px - INSET) / cw()))
            return Math.round(MIN + p * (MAX - MIN))
        }

        let dragging = false
        const handles: Record<string, HTMLElement> = {},
            numEls: Record<string, HTMLElement> = {}

        function buildHandles() {
            Object.values(handles).forEach((h) => h.remove())
            for (const k in handles) delete handles[k]
            for (const k in numEls) delete numEls[k]
            adapter.list().forEach((item) => {
                const h = document.createElement("div")
                h.className = "handle"
                h.dataset.id = String(item.id)
                const inner = document.createElement("div")
                inner.className = "hshape"
                h.appendChild(inner)
                if (cfg.numtagPos) {
                    const tag = document.createElement("div")
                    tag.className = "numtag"
                    h.appendChild(tag)
                    numEls[item.id] = tag
                }
                track.appendChild(h)
                handles[item.id] = h
                h.addEventListener("pointerdown", onDown)
                if (adapter.highlight) {
                    h.addEventListener("mouseenter", () => {
                        const list = adapter.list()
                        const merged =
                            list.length > 1 &&
                            new Set(list.map((i) => i.value)).size === 1
                        if (merged) return // the consolidated black handle represents everything — no single line to point at
                        adapter.highlight(item.id, item.color)
                    })
                    h.addEventListener("mouseleave", () => {
                        if (!dragging) adapter.highlight(null, null)
                    })
                }
                if (rulerChip) {
                    h.addEventListener("mouseenter", () =>
                        showRulerChip(item.id)
                    )
                    h.addEventListener("mouseleave", () => {
                        if (!dragging) hideRulerChip()
                    })
                }
            })
        }

        function showRulerChip(id) {
            if (!rulerChip) return
            const item = adapter.list().find((i) => i.id === id)
            if (!item) return
            rulerChip.textContent = item.value
            rulerChip.style.left = vToPx(item.value) + "px"
            rulerChip.classList.add("on")
            ruler.classList.add("dimlabels")
        }
        function hideRulerChip() {
            if (!rulerChip) return
            rulerChip.classList.remove("on")
            ruler.classList.remove("dimlabels")
        }

        let stackTimer = null
        function applyStackHiding() {
            const list = adapter.list()
            const topOfStack = {}
            list.forEach((i) => {
                topOfStack[i.value] = i.id
            })
            list.forEach((i) => {
                const h = handles[i.id]
                if (!h) return
                h.querySelector<HTMLElement>(".hshape").style.opacity =
                    topOfStack[i.value] === i.id ? "1" : "0"
            })
        }

        function refreshVisual() {
            const list = adapter.list()
            const merged =
                list.length > 0 &&
                new Set(list.map((i) => i.value)).size === 1
            list.forEach((i) => {
                const h = handles[i.id]
                if (!h) return
                h.style.left = vToPx(i.value) + "px"
                const inner = h.querySelector<HTMLElement>(".hshape")
                inner.style.background =
                    merged && list.length > 1 ? "var(--text)" : i.color
                inner.style.opacity = "1"
                if (numEls[i.id]) numEls[i.id].textContent = i.value
            })
            if (segWrapEl) {
                segWrapEl.innerHTML = ""
                for (let v = MIN; v <= MAX; v += STEP) {
                    const s = document.createElement("div")
                    s.style.cssText =
                        "position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,.07);left:" +
                        vToPx(v) +
                        "px;"
                    segWrapEl.appendChild(s)
                }
            }
            clearTimeout(stackTimer)
            stackTimer = setTimeout(applyStackHiding, 270)
            renderPillButtons()
        }

        function renderRuler() {
            const chip = rulerChip
            ruler.innerHTML = ""
            if (chip) ruler.appendChild(chip)
            const gap = (cw() / (MAX - MIN)) * STEP
            const stride = gap < 24 ? Math.ceil(24 / gap) : 1
            let mi = 0
            for (let v = MIN; v <= MAX; v++) {
                const isMajor = v % STEP === 0
                const t = document.createElement("div")
                t.className = "rtick " + (isMajor ? "major" : "minor")
                t.style.left = vToPx(v) + "px"
                ruler.appendChild(t)
                if (isMajor) {
                    if (mi % stride === 0) {
                        const l = document.createElement("div")
                        l.className = "rlabel"
                        l.style.left = vToPx(v) + "px"
                        l.textContent = String(v)
                        ruler.appendChild(l)
                    }
                    mi++
                }
            }
        }

        function renderPillButtons() {
            const distinct = Array.from(
                new Set<number>(adapter.list().map((i) => i.value))
            ).sort((x, y) => x - y)
            pillsEl.innerHTML = ""
            distinct.forEach((v) => {
                const b = document.createElement("button")
                b.className = "pill"
                b.textContent = String(v)
                b.tabIndex = -1
                b.addEventListener("click", (e) => {
                    e.stopPropagation()
                    adapter.setAll(v)
                })
                pillsEl.appendChild(b)
            })
        }

        function onDown(e) {
            e.stopPropagation() // no preventDefault: it would suppress mousemove for the drag and freeze custom cursors
            const h = e.currentTarget
            const id = parseFloat(h.dataset.id)
            h.classList.add("dragging")
            try {
                h.setPointerCapture(e.pointerId)
            } catch (_) {
                /* document listeners cover the drag */
            }
            dragging = true
            if (adapter.beginGesture) adapter.beginGesture() // one undo entry per drag
            // Merged state is decided ONCE, at drag start: if every
            // selected layer already shares one size, this drag grabs the
            // consolidated black node and moves ALL of them together for
            // its entire duration — it never splits back into individual
            // handles mid-gesture.
            const startList = adapter.list()
            const draggingAll =
                startList.length > 1 &&
                new Set(startList.map((i) => i.value)).size === 1
            // The consolidated node is really N perfectly-stacked handles.
            // Only elements with .dragging skip the .25s left-transition,
            // so during a merged drag EVERY handle gets it — otherwise the
            // grabbed one moves instantly while the rest ease after it,
            // reading as a laggy ghost trailing the black node.
            if (draggingAll) {
                Object.values(handles).forEach((h2) =>
                    h2.classList.add("dragging")
                )
            }
            if (adapter.highlight) {
                const item = startList.find((i) => i.id === id)
                if (item && !draggingAll) adapter.highlight(id, item.color)
            }
            if (cfg.ruler === "hover") setRuler(true)
            if (rulerChip) showRulerChip(id)
            function mv(ev) {
                const rect = track.getBoundingClientRect()
                const v = pxToV(ev.clientX - rect.left)
                const item = adapter.list().find((i) => i.id === id)
                if (item && v !== item.value) {
                    if (draggingAll) adapter.setAllLive(v)
                    else adapter.set(id, v)
                    if (rulerChip) showRulerChip(id)
                }
            }
            function up() {
                h.classList.remove("dragging")
                if (draggingAll) {
                    Object.values(handles).forEach((h2) =>
                        h2.classList.remove("dragging")
                    )
                }
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", up)
                dragging = false
                if (cfg.ruler === "hover" && !stack.matches(":hover"))
                    setRuler(false)
                if (rulerChip && !h.matches(":hover")) hideRulerChip()
                if (adapter.highlight && !h.matches(":hover"))
                    adapter.highlight(null, null)
            }
            document.addEventListener("pointermove", mv)
            document.addEventListener("pointerup", up)
        }

        function setRuler(on) {
            if (cfg.ruler !== "hover") return
            ruler.style.height = on ? "26px" : "0px"
            ruler.style.opacity = on ? "1" : "0"
            track.style.borderRadius = on ? "10px 10px 0 0" : "10px"
        }
        if (cfg.ruler === "hover") {
            ruler.style.cssText +=
                "height:0;opacity:0;transition:height .2s ease,opacity .15s ease;border-radius:0 0 10px 10px;"
        } else if (cfg.ruler === "always") {
            ruler.style.height = "26px"
            ruler.style.borderRadius = "0 0 10px 10px"
            track.style.borderRadius = "10px 10px 0 0"
        }

        const stack = document.createElement("div")
        stack.className = "stack"
        if (cfg.trackWidth) {
            stack.style.flex = "0 0 auto"
            stack.style.width = cfg.trackWidth + "px"
        }
        stack.appendChild(track)
        if (cfg.ruler !== "none") stack.appendChild(ruler)
        if (cfg.ruler === "hover") {
            stack.addEventListener("mouseenter", () => setRuler(true))
            stack.addEventListener("mouseleave", () => {
                if (!dragging) setRuler(false)
            })
        }

        const up = document.createElement("button")
        up.textContent = "+"
        up.setAttribute("aria-label", "Increase all")
        up.tabIndex = -1
        const dn = document.createElement("button")
        dn.textContent = "–"
        dn.setAttribute("aria-label", "Decrease all")
        dn.tabIndex = -1
        up.addEventListener("click", (e) => {
            e.stopPropagation()
            adapter.nudge(1)
        })
        dn.addEventListener("click", (e) => {
            e.stopPropagation()
            adapter.nudge(-1)
        })

        const flank = document.createElement("div")
        flank.className = "flank"
        const stepcol = document.createElement("div")
        stepcol.className = "stepcol"
        up.className = "up"
        dn.className = "dn"
        stepcol.append(up, dn)
        flank.append(stack, stepcol)
        root.appendChild(flank)
        const bottom = document.createElement("div")
        bottom.className = "bottomrow"
        bottom.append(pillsEl)
        root.appendChild(bottom)

        requestAnimationFrame(() => {
            buildHandles()
            if (cfg.ruler !== "none") renderRuler()
            refreshVisual()
        })

        return {
            el: root,
            refresh: refreshVisual,
            rebuild: () => {
                buildHandles()
                if (cfg.ruler !== "none") renderRuler()
                refreshVisual()
            },
        }
    }

    /* ================= side panel (built once) ================= */
    const panelGroup = root.querySelector<HTMLElement>("#panelGroup")

    // alignment: single item aligns within the canvas, multi aligns within the selection bounds
    const alignBtns = []
    ;(function () {
        const row = root.querySelector<HTMLElement>("#alignRow")
        const defs = [
            {
                kind: "left",
                icon: '<rect x="1" y="2" width="2" height="10"/><rect x="5" y="4" width="8" height="2"/><rect x="5" y="8" width="5" height="2"/>',
            },
            {
                kind: "centerH",
                icon: '<rect x="6" y="2" width="2" height="10"/><rect x="2" y="4" width="10" height="2"/><rect x="3.5" y="8" width="7" height="2"/>',
            },
            {
                kind: "right",
                icon: '<rect x="11" y="2" width="2" height="10"/><rect x="1" y="4" width="8" height="2"/><rect x="4" y="8" width="5" height="2"/>',
            },
            {
                kind: "top",
                icon: '<rect x="2" y="1" width="10" height="2"/><rect x="4" y="5" width="2" height="8"/><rect x="8" y="5" width="2" height="5"/>',
            },
            {
                kind: "centerV",
                icon: '<rect x="2" y="6" width="10" height="2"/><rect x="4" y="2" width="2" height="10"/><rect x="8" y="3.5" width="2" height="7"/>',
            },
            {
                kind: "bottom",
                icon: '<rect x="2" y="11" width="10" height="2"/><rect x="4" y="1" width="2" height="8"/><rect x="8" y="4" width="2" height="5"/>',
            },
        ]
        defs.forEach((d) => {
            const b = document.createElement("button")
            b.className = "alignbtn"
            b.tabIndex = -1
            b.title = "Align " + d.kind
            b.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">' +
                d.icon +
                "</svg>"
            b.addEventListener("click", () => alignSelection(d.kind))
            row.appendChild(b)
            alignBtns.push(b)
        })
    })()

    function alignSelection(kind) {
        const sel = selectedItems()
        if (!sel.length) return
        // target: the selection's own bounds for multi; for a single item, the
        // frame it sits in, or the visible viewport if it isn't in one
        let frame
        if (sel.length > 1) {
            const b = selectionBounds()
            if (!b) return
            frame = { x: b.x, y: b.y, w: b.w, h: b.h }
        } else {
            const parent = containingFrame(sel[0])
            frame = parent
                ? { x: parent.x, y: parent.y, w: parent.w, h: parent.h }
                : viewportWorldRect()
        }
        pushHistory()
        sel.forEach((it) => {
            const { w: iw, h: ih } = nodeSize(it)
            if (kind === "left") it.x = frame.x
            if (kind === "centerH") it.x = frame.x + (frame.w - iw) / 2
            if (kind === "right") it.x = frame.x + frame.w - iw
            if (kind === "top") it.y = frame.y
            if (kind === "centerV") it.y = frame.y + (frame.h - ih) / 2
            if (kind === "bottom") it.y = frame.y + frame.h - ih
        })
        emit()
    }

    function updateAlignButtons() {
        const none = selection.size === 0
        alignBtns.forEach((b) => (b.disabled = none))
    }

    /* ---- fill: swatch + hex + alpha for the selection; with nothing
       selected the same row controls the canvas background instead. The
       host renders the picker either way (setFill routes to whichever
       applies at call time). ---- */
    const sidepanel = root.querySelector<HTMLElement>(".sidepanel")
    const fillRow = root.querySelector<HTMLElement>("#fillRow")
    const fillLabel = root.querySelector<HTMLElement>("#fillLabel")
    const fillSwatch = fillRow.querySelector<HTMLElement>(".swatch")
    const fillHex = fillRow.querySelector<HTMLElement>(".hex")
    const fillPct = fillRow.querySelector<HTMLElement>(".pct")
    // the canvas background is document data: ctx.doc.bg (saved with the doc, reset from settings)
    // The canvas is independent of the UI theme: its background is whatever
    // the user set, and the label / selection colors derive from that color
    // alone (composited over white, as before) — never from light/dark mode.
    const surfaceRgb = (): [number, number, number] => [255, 255, 255]
    /* Frame labels (name + timestamp) sit directly on the canvas background,
       so fixed grays stop reading as the background approaches them. Two
       palettes, one switch: dark grays on light and mid-tone backgrounds,
       pale grays once the background is dark enough that a light label reads
       better than a dark one. (A softer third tier for very light
       backgrounds was tried and dropped — the timestamp washed out.) */
    const LABEL_PALETTES = {
        dark: { name: "#1c1c1c", time: "#707070" },
        pale: { name: "#f4f4f4", time: "#a8a8a8" },
    }
    /* One light/dark call for the whole canvas, decided from the background's
       overall luminance (via two opposite grays' contrast — hue-independent,
       so a light pastel background still reads as "light"). Both the label
       palette and the frame-name accent switch together on it. */
    function canvasIsDark(seen: [number, number, number]) {
        // decided from the frame *name* colors, not the timestamp — the name
        // stays a near-black/near-white pair regardless of how light or dark
        // the timestamp itself is tuned to be, so this switch point doesn't
        // move whenever the timestamp color is adjusted
        const nameContrast = (p: { name: string }) => contrastRatio(hexToRgb(p.name), seen)
        return nameContrast(LABEL_PALETTES.pale) > nameContrast(LABEL_PALETTES.dark)
    }
    /* The frame name (selected/hovered) normally matches the fixed selection
       blue (--sel-blue) — only on a genuinely dark canvas does it switch to a
       paler blue for legibility. Set as --accent on #canvas, so only canvas
       chrome adapts; the panels keep the brand color regardless. */
    const ACCENTS = { base: "#0c8ce9", pale: "#a6d4ff" }
    function accentColor(seen: [number, number, number]) {
        return canvasIsDark(seen) ? ACCENTS.pale : ACCENTS.base
    }
    function labelPalette(seen: [number, number, number]) {
        return canvasIsDark(seen) ? LABEL_PALETTES.pale : LABEL_PALETTES.dark
    }
    function applyBg() {
        if (ctx.ui.heat) {
            // thermal view: near-black purple ground, light labels
            canvas.style.backgroundColor = HEAT_BG
            canvas.style.setProperty("--fname", "#efe4ff")
            canvas.style.setProperty("--ftime", "#b9a6d9")
            canvas.style.setProperty("--accent", accentColor(hexToRgb(HEAT_BG)))
            applyGrid()
            return
        }
        const bg = ctx.doc.bg
        canvas.style.backgroundColor = rgbaCss(bg.hex, bg.alpha)
        const seen = compositeOver(hexToRgb(bg.hex), bg.alpha, surfaceRgb())
        const p = labelPalette(seen)
        canvas.style.setProperty("--fname", p.name)
        canvas.style.setProperty("--ftime", p.time)
        canvas.style.setProperty("--accent", accentColor(seen))
        applyGrid()
    }
    // shared fill of the selection, or null when empty / mixed
    function selectionFill(): { fill: Fill | null; mixed: boolean } {
        const sel = selectedItems()
        if (!sel.length) return { fill: null, mixed: false }
        const f = { hex: sel[0].fill, alpha: sel[0].alpha }
        const mixed = sel.some((it) => it.fill !== f.hex || it.alpha !== f.alpha)
        return { fill: mixed ? null : f, mixed }
    }
    function fillMode(): FillMode {
        return selection.size ? "selection" : "background"
    }
    function updateFill() {
        const mode = fillMode()
        fillLabel.textContent = mode === "background" ? "Background" : "Fill"
        // with nothing selected the sidebar collapses to just this section
        const wasEmpty = sidepanel.classList.contains("empty")
        sidepanel.classList.toggle("empty", mode === "background")
        // the Versions indicator is measured from layout, which is all zeros
        // while its section is display:none — re-measure once it's back
        if (wasEmpty && mode !== "background") updateVariantButtons()
        fillRow.classList.toggle("disabled", false) // always actionable now — selection fill, or the background
        if (mode === "background") {
            fillRow.classList.remove("mixed")
            const bg = ctx.doc.bg
            fillSwatch.style.background = rgbaCss(bg.hex, bg.alpha)
            fillHex.textContent = bg.hex.replace("#", "").toUpperCase()
            fillPct.textContent = bg.alpha + "%"
            if (hooks.onFillChange) hooks.onFillChange({ ...bg }, mode)
            return
        }
        const { fill, mixed } = selectionFill()
        fillRow.classList.toggle("mixed", mixed)
        if (fill) {
            fillSwatch.style.background = rgbaCss(fill.hex, fill.alpha)
            fillHex.textContent = fill.hex.replace("#", "").toUpperCase()
            fillPct.textContent = fill.alpha + "%"
        } else {
            fillSwatch.style.background = mixed
                ? "linear-gradient(135deg,#1c1c1c 50%,#fff 50%)"
                : "#1c1c1c"
            fillHex.textContent = mixed ? "Mixed" : "–"
            fillPct.textContent = ""
        }
        // a different selection under an open picker starts a fresh undo step
        const sig = Array.from(selection).sort((a, b) => a - b).join(",")
        if (sig !== fillSelSig) {
            fillSelSig = sig
            if (fillGesture) fillPre = snapshot()
        }
        if (hooks.onFillChange) hooks.onFillChange(fill ?? { hex: sel0Fill(), alpha: 100 }, mode)
    }
    function sel0Fill() {
        const sel = selectedItems()
        return sel.length ? sel[0].fill : "#1c1c1c"
    }
    fillRow.addEventListener("click", () => {
        if (!hooks.onFillOpen) return
        const mode = fillMode()
        if (mode === "background") {
            hooks.onFillOpen(fillRow.getBoundingClientRect(), { ...ctx.doc.bg }, mode)
            return
        }
        const { fill } = selectionFill()
        hooks.onFillOpen(fillRow.getBoundingClientRect(), fill ?? { hex: sel0Fill(), alpha: 100 }, mode)
    })
    // A picker session is one gesture: the snapshot taken when it opens (or
    // when the selection changes under it) is pushed once, on the first change.
    // (The background isn't part of item history, so it has no gesture of its own.)
    let fillPre = null
    let fillGesture = false
    let fillSelSig = ""
    function setFill(hex: string, alpha: number) {
        if (!isHex(hex)) return
        hex = (hex.startsWith("#") ? hex : "#" + hex).toLowerCase()
        alpha = Math.max(0, Math.min(100, Math.round(alpha)))
        if (fillMode() === "background") {
            if (ctx.doc.bg.hex === hex && ctx.doc.bg.alpha === alpha) return
            ctx.doc.bg = { hex, alpha }
            applyBg()
            updateFill()
            scheduleSave()
            return
        }
        const sel = selectedItems()
        if (!sel.length) return
        if (sel.every((it) => it.fill === hex && it.alpha === alpha)) return
        if (fillPre) {
            pushHistory(fillPre)
            fillPre = null
        } else if (!fillGesture) pushHistory()
        const now = Date.now()
        sel.forEach((it) => {
            it.fill = hex
            it.alpha = alpha
            if (isFrame(it)) it.updatedAt = now
        })
        emit()
    }

    // Every numeric field steps with the arrow keys: ±1 unit, ×10 with Shift
    function arrowStep(e: KeyboardEvent, unit = 1) {
        const dir = e.key === "ArrowUp" ? 1 : -1
        return dir * unit * (e.shiftKey ? 10 : 1)
    }

    // position / dimensions / opacity fields, live-bound to the selection
    const posX = root.querySelector<HTMLInputElement>("#posX")
    const posY = root.querySelector<HTMLInputElement>("#posY")
    const dimW = root.querySelector<HTMLInputElement>("#dimW")
    const dimH = root.querySelector<HTMLInputElement>("#dimH")

    function updateProps() {
        const sel = selectedItems()
        const none = sel.length === 0
        ;[posX, posY].forEach((i) => {
            i.disabled = none
            if (none) {
                i.value = ""
                i.placeholder = "\u2013"
            }
        })
        // W/H are readouts, except for a lone frame where they're editable
        const frame = singleSelectedFrame()
        dimW.disabled = dimH.disabled = !frame
        if (none) {
            dimW.value = ""
            dimH.value = ""
            return
        }

        const b = selectionBounds()
        if (b) {
            if (document.activeElement !== posX)
                posX.value = String(Math.round(b.x))
            if (document.activeElement !== posY)
                posY.value = String(Math.round(b.y))
            if (document.activeElement !== dimW)
                dimW.value = String(Math.round(b.w))
            if (document.activeElement !== dimH)
                dimH.value = String(Math.round(b.h))
        }
    }

    let posPre = null
    function armPos() {
        posPre = snapshot()
    }
    function consumePos() {
        if (posPre) {
            pushHistory(posPre)
            posPre = null
        }
    }

    posX.addEventListener("focus", armPos)
    posY.addEventListener("focus", armPos)

    posX.addEventListener("input", () => {
        const v = parseFloat(posX.value)
        if (isNaN(v)) return
        const b = selectionBounds()
        if (!b) return
        const dx = v - b.x
        if (dx === 0) return
        consumePos()
        moveSelection(dx, 0)
        emit()
    })
    posY.addEventListener("input", () => {
        const v = parseFloat(posY.value)
        if (isNaN(v)) return
        const b = selectionBounds()
        if (!b) return
        const dy = v - b.y
        if (dy === 0) return
        consumePos()
        moveSelection(0, dy)
        emit()
    })
    // Cmd/Ctrl+A: with frames selected, select what's inside them (text, and
    // frames fully contained); otherwise select every layer
    function selectAll() {
        const frames = selectedItems().filter(isFrame)
        const inside = new Set<number>()
        frames.forEach((f) => descendantsOf(f).forEach((d) => inside.add(d.id)))
        selection.clear()
        if (inside.size) inside.forEach((id) => selection.add(id))
        else items.forEach((it) => selection.add(it.id))
        emit()
    }

    // Arrow keys: 1px, or 10px with Shift. A frame carries the text inside it,
    // like a drag does. A quick run of presses is one undo step.
    let nudgePre = null
    let nudgeTimer = null
    function nudgeSelection(dx: number, dy: number) {
        const moving = new Map<number, Item>()
        selectedItems().forEach((it) => moving.set(it.id, it))
        selectedItems()
            .filter(isFrame)
            .forEach((f) => descendantsOf(f).forEach((d) => moving.set(d.id, d)))
        if (!moving.size) return
        if (!nudgePre) {
            nudgePre = snapshot()
            pushHistory(nudgePre)
        }
        clearTimeout(nudgeTimer)
        nudgeTimer = setTimeout(() => (nudgePre = null), 600)
        moving.forEach((it) => {
            it.x += dx
            it.y += dy
        })
        if (Array.from(moving.values()).some(isFrame)) ctx.flags.carryingFrameDrag = true
        emit()
        ctx.flags.carryingFrameDrag = false
    }
    // repositioning a frame (typed X/Y) isn't a content edit either
    function moveSelection(dx: number, dy: number) {
        selectedItems().forEach((it) => {
            it.x += dx
            it.y += dy
        })
    }
    dimW.addEventListener("focus", armPos)
    dimH.addEventListener("focus", armPos)
    ;([
        [dimW, "w"],
        [dimH, "h"],
    ] as Array<[HTMLInputElement, "w" | "h"]>).forEach(([input, key]) => {
        input.addEventListener("input", () => {
            const frame = singleSelectedFrame()
            const v = parseFloat(input.value)
            if (!frame || isNaN(v)) return
            const next = Math.max(1, Math.round(v))
            if (next === frame[key]) return
            consumePos()
            frame[key] = next
            frame.updatedAt = Date.now()
            if (frame.layout?.sizing === "hug") frame.layout = { ...frame.layout, sizing: "fixed" }
            emit()
        })
    })
    ;[posX, posY, dimW, dimH].forEach((i) => {
        i.addEventListener("blur", () => {
            posPre = null
            updateProps()
        })
        i.addEventListener("keydown", (e) => {
            if (e.key === "Enter") i.blur()
            // arrows step the value (Shift ×10) and apply it like typing would
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault()
                if (i.disabled) return
                const cur = parseFloat(i.value)
                if (isNaN(cur)) return
                i.value = String(Math.round(cur + arrowStep(e)))
                i.dispatchEvent(new Event("input"))
            }
        })
    })
    let activeWidget = null
    let panelAPI = null

    function makeSelect(options: Array<string | { label: string; value: string | number }>, onChange?: (v: string) => void) {
        const wrap = document.createElement("div")
        wrap.className = "dd-wrap"
        const sel = document.createElement("select")
        sel.className = "dd"
        options.forEach((o) => {
            const opt = document.createElement("option")
            const isObj = typeof o === "object"
            opt.value = String(isObj ? o.value : o)
            opt.textContent = isObj ? o.label : o
            sel.appendChild(opt)
        })
        if (onChange)
            sel.addEventListener("change", () => onChange(sel.value))
        wrap.appendChild(sel)
        return wrap
    }

    // gesture-scoped history for the size controls: a handle drag or a typing session
    // logs ONE undo entry, captured before its first change; discrete actions (a pill
    // click, a +/- press) log one entry each
    let pendingPre = null
    const adapter = {
        beginGesture() {
            pendingPre = snapshot()
        },
        cancelGesture() {
            pendingPre = null
        },
        _consumeOrPush() {
            if (pendingPre) {
                pushHistory(pendingPre)
                pendingPre = null
            } else pushHistory()
        },
        highlight(id, color) {
            ctx.ui.hoverWash = color ? { id, color } : null
            applyWash()
        },
        list() {
            return selectedTextItems().map((it) => ({
                id: it.id,
                color: selColor(it.id),
                value: it.size,
            }))
        },
        set(id, v) {
            const it = items.find((i) => i.id === id)
            if (!it || !isText(it)) return
            v = Math.max(MIN, Math.min(MAX, Math.round(v)))
            if (v === it.size) return
            if (pendingPre) {
                pushHistory(pendingPre)
                pendingPre = null
            }
            it.size = v
            emit()
        },
        // Drag-safe variant of setAll: consumes the gesture's pending
        // snapshot on first change only, so a whole merged-node drag is
        // ONE undo entry (setAll would push history on every pixel).
        setAllLive(v) {
            v = Math.max(MIN, Math.min(MAX, Math.round(v)))
            if (selectedTextItems().every((it) => it.size === v)) return
            if (pendingPre) {
                pushHistory(pendingPre)
                pendingPre = null
            }
            selectedTextItems().forEach((it) => (it.size = v))
            emit()
        },
        // typed sizes (field, pills, +/-) have no ceiling — only slider drags are bounded
        setAll(v) {
            v = Math.max(SIZE_MIN, Math.round(v))
            if (selectedTextItems().every((it) => it.size === v)) return
            this._consumeOrPush()
            selectedTextItems().forEach((it) => (it.size = v))
            emit()
        },
        nudge(s) {
            this._consumeOrPush()
            selectedTextItems().forEach((it) => (it.size = Math.max(SIZE_MIN, it.size + s)))
            emit()
        },
    }

    // shared by the font row's button and the host's floating list
    const FONTS = ["Inter", "PP Mondwest", "PP NeueBit", "Helvetica Neue", "Georgia"]
    function currentFontValue(): string {
        const sel = selectedTextItems()
        if (!sel.length) return FONTS[0]
        const same = sel.every((it) => it.font === sel[0].font)
        return same ? sel[0].font : "__mixed"
    }
    function setFont(font: string) {
        const sel = selectedTextItems()
        if (!sel.length || sel.every((it) => it.font === font)) return
        pushHistory()
        sel.forEach((it) => (it.font = font))
        emit()
    }

    /* ---- Layout section: shown for a single selected frame ---- */
    const layoutSec = root.querySelector<HTMLElement>("#layoutSec")
    const layoutDiv = root.querySelector<HTMLElement>("#layoutDiv")
    const layoutGroup = root.querySelector<HTMLElement>("#layoutGroup")
    const ICON_V =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2.5h8M2 6h8M2 9.5h8"/></svg>'
    const ICON_H =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 2v8M6 2v8M9.5 2v8"/></svg>'
    // a compact segmented control with the sliding highlight, like the settings' .seg
    function makeSeg<T extends string>(
        options: Array<{ value: T; label: string; icon?: string; title?: string }>,
        onPick: (v: T) => void
    ) {
        const el = document.createElement("div")
        el.className = "lseg"
        const ind = document.createElement("div")
        ind.className = "segind"
        el.appendChild(ind)
        const btns = options.map((o) => {
            const b = document.createElement("button")
            b.type = "button"
            b.tabIndex = -1
            b.dataset.value = o.value
            b.innerHTML = (o.icon ?? "") + (o.label ? `<span>${o.label}</span>` : "")
            if (o.title) b.title = o.title
            b.addEventListener("click", () => onPick(o.value))
            el.appendChild(b)
            return b
        })
        let placed = false
        function set(v: T) {
            btns.forEach((b) => b.classList.toggle("active", b.dataset.value === v))
            const a = btns.find((b) => b.dataset.value === v)
            if (!a || !a.offsetWidth) return
            if (!placed) ind.style.transition = "none"
            ind.style.left = a.offsetLeft + "px"
            ind.style.width = a.offsetWidth + "px"
            if (!placed) {
                placed = true
                void ind.offsetWidth
                ind.style.transition = ""
            }
        }
        return { el, set }
    }
    // a .pi number field bound to one layout property of the selected frame
    function layoutNumField(key: string, label: string, prop: "gap" | "padding") {
        const pi = document.createElement("div")
        pi.className = "pi"
        const k = document.createElement("span")
        k.className = "pi-key"
        k.innerHTML = key // a letter or an inline icon
        const input = document.createElement("input")
        input.setAttribute("inputmode", "numeric")
        input.setAttribute("aria-label", label)
        input.title = label
        pi.append(k, input)
        let pre = null
        function apply(v: number) {
            const f = singleSelectedFrame()
            if (!f?.layout || f.layout[prop] === v) return
            if (pre) {
                pushHistory(pre)
                pre = null
            }
            f.layout = { ...f.layout, [prop]: v }
            f.updatedAt = Date.now()
            emit()
        }
        function update(force?: boolean) {
            const f = singleSelectedFrame()
            if (!f?.layout) return
            if (document.activeElement === input && !force) return
            input.value = String(f.layout[prop])
        }
        input.addEventListener("focus", () => {
            pre = snapshot()
            input.select()
        })
        input.addEventListener("input", () => {
            const v = parseFloat(input.value)
            if (!isNaN(v)) apply(Math.max(0, Math.round(v)))
        })
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                input.blur()
                return
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault()
                const f = singleSelectedFrame()
                if (!f?.layout) return
                if (!pre) pre = snapshot()
                apply(Math.max(0, f.layout[prop] + arrowStep(e)))
                update(true)
            }
        })
        input.addEventListener("blur", () => {
            pre = null
            update(true)
        })
        return { el: pi, update }
    }
    function buildLayoutPanel() {
        if (!layoutGroup) return () => {}
        const change = (patch: Partial<FrameLayout>) => {
            const f = singleSelectedFrame()
            if (!f?.layout) return
            pushHistory()
            f.layout = { ...f.layout, ...patch }
            f.updatedAt = Date.now()
            emit()
        }
        // --- empty state: one button
        const addBtn = document.createElement("button")
        addBtn.type = "button"
        addBtn.className = "layoutbtn"
        addBtn.tabIndex = -1
        addBtn.innerHTML = ICON_V + "<span>Add smart layout</span>"
        addBtn.addEventListener("click", () => {
            const f = singleSelectedFrame()
            if (f) {
                if (!f.layout) setLayout(f, { ...DEFAULT_LAYOUT })
                return
            }
            wrapSelectionInLayout()
        })
        // --- controls
        const controls = document.createElement("div")
        controls.className = "propgroup"
        // three compact rows: direction + alignment (icons), gap + padding
        // (icon-keyed fields), sizing + remove
        const svg = (body: string, stroke = false) =>
            `<svg width="12" height="12" viewBox="0 0 12 12" ${
                stroke ? 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"' : 'fill="currentColor"'
            }>${body}</svg>`
        const ICON_START = svg('<rect x="1" y="1.5" width="1.5" height="9"/><rect x="3.5" y="3" width="6.5" height="2"/><rect x="3.5" y="7" width="4" height="2"/>')
        const ICON_CENTER = svg('<rect x="5.25" y="1.5" width="1.5" height="9"/><rect x="1.5" y="3" width="9" height="2"/><rect x="3" y="7" width="6" height="2"/>')
        const ICON_END = svg('<rect x="9.5" y="1.5" width="1.5" height="9"/><rect x="2" y="3" width="6.5" height="2"/><rect x="4.5" y="7" width="4" height="2"/>')
        const ICON_GAP = svg('<path d="M2 2v8M10 2v8M4.5 6h3M6.5 4.5L8 6l-1.5 1.5M5.5 4.5L4 6l1.5 1.5"/>', true)
        const ICON_PAD = svg('<rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/><rect x="4.25" y="4.25" width="3.5" height="3.5" rx=".5" fill="currentColor" stroke="none"/>', true)
        const ICON_X = svg('<path d="M3 3l6 6M9 3l-6 6"/>', true)
        const row1 = document.createElement("div")
        row1.className = "proprow"
        const dirSeg = makeSeg<FrameLayout["direction"]>(
            [
                { value: "vertical", label: "", icon: ICON_V, title: "Vertical — stack top to bottom" },
                { value: "horizontal", label: "", icon: ICON_H, title: "Horizontal — stack left to right" },
            ],
            (direction) => change({ direction })
        )
        const alignSeg = makeSeg<FrameLayout["align"]>(
            [
                { value: "start", label: "", icon: ICON_START, title: "Align to the start" },
                { value: "center", label: "", icon: ICON_CENTER, title: "Align to the center" },
                { value: "end", label: "", icon: ICON_END, title: "Align to the end" },
            ],
            (align) => change({ align })
        )
        row1.append(dirSeg.el, alignSeg.el)
        const row2 = document.createElement("div")
        row2.className = "proprow"
        const gapField = layoutNumField(ICON_GAP, "Gap between items", "gap")
        const padField = layoutNumField(ICON_PAD, "Padding", "padding")
        row2.append(gapField.el, padField.el)
        const row3 = document.createElement("div")
        row3.className = "proprow"
        const sizingSeg = makeSeg<FrameLayout["sizing"]>(
            [
                { value: "hug", label: "Hug", title: "Hug — the frame sizes itself to its contents" },
                { value: "fixed", label: "Fixed", title: "Fixed — the frame keeps the size you give it" },
            ],
            (sizing) => change({ sizing })
        )
        const removeBtn = document.createElement("button")
        removeBtn.type = "button"
        removeBtn.className = "layoutbtn icon"
        removeBtn.tabIndex = -1
        removeBtn.title = "Remove smart layout"
        removeBtn.setAttribute("aria-label", "Remove smart layout")
        removeBtn.innerHTML = ICON_X
        removeBtn.addEventListener("click", () => {
            const f = singleSelectedFrame()
            if (f?.layout) setLayout(f, null)
        })
        row3.append(sizingSeg.el, removeBtn)
        controls.append(row1, row2, row3)
        layoutGroup.append(addBtn, controls)

        return function updateLayoutPanel() {
            const sel = selectedItems()
            const f = singleSelectedFrame()
            const show = sel.length > 0
            layoutSec?.classList.toggle("on", show)
            layoutDiv?.classList.toggle("on", show)
            if (!show) return
            if (!f) {
                // text selected: the button wraps it; a frame mixed in can't be
                // wrapped (frames don't nest), so say so instead of doing nothing
                const allText = sel.every(isText)
                addBtn.style.display = ""
                controls.style.display = "none"
                addBtn.disabled = !allText
                addBtn.innerHTML = ICON_V + `<span>${allText ? (sel.length > 1 ? "Wrap in smart layout" : "Add smart layout") : "Select text, or one frame"}</span>`
                return
            }
            const has = !!f.layout
            addBtn.disabled = false
            addBtn.innerHTML = ICON_V + "<span>Add smart layout</span>"
            addBtn.style.display = has ? "none" : ""
            controls.style.display = has ? "" : "none"
            if (!f.layout) return
            dirSeg.set(f.layout.direction)
            alignSeg.set(f.layout.align)
            sizingSeg.set(f.layout.sizing)
            gapField.update()
            padField.update()
        }
    }
    const updateLayoutPanel = buildLayoutPanel()

    function buildPanel() {
        // the font row opens a floating list next to the sidebar (see
        // onFontOpen/onFontChange), like the fill swatch opens the color
        // picker — not a native <select>, so each option can render in its
        // own typeface. The button shows the current font in that font too.
        const fontWrap = document.createElement("div")
        fontWrap.className = "dd-wrap"
        const fontBtn = document.createElement("button")
        fontBtn.type = "button"
        fontBtn.className = "dd"
        fontBtn.id = "fontRow"
        fontBtn.tabIndex = -1
        fontWrap.appendChild(fontBtn)
        function updateFontDD() {
            const sel = selectedTextItems()
            fontBtn.disabled = !sel.length
            const v = currentFontValue()
            fontBtn.textContent = v === "__mixed" ? "Mixed" : v
            fontBtn.style.fontFamily = v === "__mixed" ? "" : v
            if (hooks.onFontChange) hooks.onFontChange(v)
        }
        fontBtn.addEventListener("click", () => {
            if (!hooks.onFontOpen || fontBtn.disabled) return
            hooks.onFontOpen(fontBtn.getBoundingClientRect(), FONTS, currentFontValue())
        })

        const row = document.createElement("div")
        row.className = "proprow"
        const weightDD = makeSelect(
            [
                { label: "Light", value: 300 },
                { label: "Regular", value: 400 },
                { label: "Medium", value: 500 },
                { label: "Semibold", value: 600 },
                { label: "Bold", value: 700 },
            ],
            (v) => {
                const weight = Number(v)
                const sel = selectedTextItems()
                if (!sel.length || sel.every((it) => it.weight === weight)) return
                pushHistory()
                sel.forEach((it) => (it.weight = weight))
                emit()
            }
        )
        const weightSel = weightDD.querySelector<HTMLSelectElement>("select")
        const mixedWeight = document.createElement("option")
        mixedWeight.value = "__mixed"
        mixedWeight.textContent = "Mixed"
        mixedWeight.disabled = true
        mixedWeight.hidden = true
        weightSel.appendChild(mixedWeight)
        function updateWeightDD() {
            const sel = selectedTextItems()
            weightSel.disabled = !sel.length
            if (!sel.length) {
                weightSel.value = "400"
                return
            }
            const same = sel.every((it) => it.weight === sel[0].weight)
            weightSel.value = same ? String(sel[0].weight) : "__mixed"
        }

        /* line height (unitless, e.g. 1.2) and letter spacing (px). Each field
           applies live as you type; a typing session is one undo step. */
        const spacingRow = document.createElement("div")
        spacingRow.className = "proprow"
        function numField(
            key: string,
            label: string,
            read: (it: TextItem) => number,
            write: (it: TextItem, v: number) => void,
            step: number,
            decimals: number
        ) {
            const pi = document.createElement("div")
            pi.className = "pi"
            const k = document.createElement("span")
            k.className = "pi-key"
            k.textContent = key
            const input = document.createElement("input")
            input.setAttribute("inputmode", "decimal")
            input.setAttribute("aria-label", label)
            input.title = label
            pi.append(k, input)
            let pre = null
            const fmt = (v: number) => String(Number(v.toFixed(decimals)))
            function apply(v: number) {
                const sel = selectedTextItems()
                if (!sel.length || sel.every((it) => read(it) === v)) return
                if (pre) {
                    pushHistory(pre)
                    pre = null
                }
                sel.forEach((it) => write(it, v))
                emit()
            }
            function update(force?: boolean) {
                const sel = selectedTextItems()
                input.disabled = !sel.length
                if (!sel.length) {
                    input.value = ""
                    input.placeholder = "\u2013"
                    return
                }
                if (document.activeElement === input && !force) return
                const vals = sel.map(read)
                const same = vals.every((v) => v === vals[0])
                input.value = same ? fmt(vals[0]) : ""
                input.placeholder = same ? "" : "Mixed"
            }
            input.addEventListener("focus", () => {
                pre = snapshot()
                input.select()
            })
            input.addEventListener("input", () => {
                const v = parseFloat(input.value)
                if (!isNaN(v)) apply(Number(v.toFixed(decimals)))
            })
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    input.blur()
                    return
                }
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault()
                    const sel = selectedTextItems()
                    if (!sel.length) return
                    const s = arrowStep(e, step)
                    if (!pre) pre = snapshot()
                    pushHistory(pre)
                    pre = null
                    sel.forEach((it) => write(it, Number((read(it) + s).toFixed(decimals))))
                    emit()
                    update(true)
                }
            })
            input.addEventListener("blur", () => {
                pre = null
                update(true)
            })
            return { el: pi, update }
        }
        const lineHeightField = numField(
            "LH",
            "Line height",
            lineHeightOf,
            (it, v) => (it.lineHeight = Math.max(0, v)),
            0.1,
            2
        )
        const letterSpacingField = numField(
            "LS",
            "Letter spacing (px)",
            letterSpacingOf,
            (it, v) => (it.letterSpacing = v),
            0.5,
            2
        )
        spacingRow.append(lineHeightField.el, letterSpacingField.el)

        const sizewrap = document.createElement("div")
        sizewrap.className = "sizewrap"
        const field = document.createElement("div")
        field.className = "sizefield"
        const input = document.createElement("input")
        input.type = "text"
        input.className = "sizeinput"
        input.setAttribute("inputmode", "numeric")
        input.setAttribute("aria-label", "Font size")
        const chevronBtn = document.createElement("button")
        chevronBtn.type = "button"
        chevronBtn.className = "sizechevron"
        chevronBtn.tabIndex = -1
        chevronBtn.setAttribute("aria-label", "Show size controls")
        chevronBtn.innerHTML = '<span class="chev"></span>'
        field.append(input, chevronBtn)
        sizewrap.appendChild(field)

        const tooltip = document.createElement("div")
        tooltip.className = "tooltip-summary"
        const dotsRow = document.createElement("div")
        dotsRow.className = "dots-row"
        const summaryText = document.createElement("div")
        summaryText.className = "summary-text"
        tooltip.append(dotsRow, summaryText)
        sizewrap.appendChild(tooltip)

        row.append(weightDD, sizewrap)

        const drawer = document.createElement("div")
        drawer.className = "sizedrawer"

        let open = false
        function setOpen(v) {
            if (selectedTextItems().length === 0) v = false
            open = v
            drawer.classList.toggle("open", v)
            if (v) tooltip.classList.remove("visible")
        }

        function mountWidget() {
            drawer.innerHTML = ""
            activeWidget = makeWidget(VARIANTS[activeVariant], adapter)
            drawer.appendChild(activeWidget.el)
            // keep open state exactly as it was — swapping the version must not reset the panel
        }

        function updateField(force?: boolean) {
            updateFontDD()
            updateWeightDD()
            lineHeightField.update(force)
            letterSpacingField.update(force)
            const sel = selectedTextItems()
            if (sel.length === 0) {
                input.value = ""
                input.placeholder = "–"
                input.disabled = true
                chevronBtn.disabled = true
                setOpen(false)
                return
            }
            input.disabled = false
            chevronBtn.disabled = false
            if (document.activeElement === input && !force) return // don't clobber what the user is typing
            const vals = sel.map((it) => it.size)
            const allEqual = vals.every((v) => v === vals[0])
            if (allEqual) {
                input.value = String(vals[0])
                input.classList.remove("mixed")
            } else {
                input.value = "Mixed"
                input.classList.add("mixed")
            }
        }
        function updateTooltip() {
            const sel = selectedTextItems()
            dotsRow.innerHTML = ""
            sel.forEach((it) => {
                const dot = document.createElement("span")
                dot.className = "dot"
                dot.style.background = selColor(it.id)
                dotsRow.appendChild(dot)
            })
            const vals = sel.map((it) => it.size)
            if (!vals.length) {
                summaryText.textContent = "No layers selected"
                return
            }
            const min = Math.min(...vals),
                max = Math.max(...vals)
            const distinct = new Set(vals).size
            summaryText.innerHTML =
                min === max
                    ? "<b>" + min + "px</b>"
                    : "<b>" +
                      min +
                      "–" +
                      max +
                      "px</b> · " +
                      distinct +
                      " distinct layers"
        }

        chevronBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            setOpen(!open)
        })
        input.addEventListener("focus", () => {
            input.select()
            adapter.beginGesture()
        })
        input.addEventListener("input", () => {
            const v = parseFloat(input.value)
            if (!isNaN(v)) adapter.setAll(v) // applies live as you type
        })
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                input.blur()
                return
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault()
                adapter.nudge(arrowStep(e))
                updateField(true) // force: this is a real value change, not mid-typing
            }
        })
        input.addEventListener("blur", () => {
            adapter.cancelGesture()
            updateField()
        })
        sizewrap.addEventListener("mouseenter", () => {
            if (!open && selectedTextItems().length > 1) {
                updateTooltip()
                tooltip.classList.add("visible")
            }
        })
        sizewrap.addEventListener("mouseleave", () =>
            tooltip.classList.remove("visible")
        )
        onDoc("click", (e) => {
            if (
                open &&
                !sizewrap.contains(e.target as Node) &&
                !drawer.contains(e.target as Node)
            )
                setOpen(false)
        })

        panelGroup.append(fontWrap, row, drawer, spacingRow)
        mountWidget()
        updateField()
        setOpen(true)

        panelAPI = {
            updateField,
            updateTooltip: () => {
                if (tooltip.classList.contains("visible")) updateTooltip()
            },
            mountWidget,
        }
    }

    /* ================= version switching ================= */
    function activateVariant(num) {
        if (num === activeVariant) return
        activeVariant = num
        panelAPI.mountWidget() // swaps only the widget inside the drawer — open state and dropdowns untouched
        updateVariantButtons()
    }

    function updateVariantButtons() {
        let activeBtn = null
        root.querySelectorAll<HTMLElement>(".vergroup .vbtn").forEach((b) => {
            const on = Number(b.dataset.v) === activeVariant
            b.classList.toggle("active", on)
            if (on) activeBtn = b
        })
        // the blue highlight slides between buttons instead of popping
        const vind = root.querySelector<HTMLElement>("#vind")
        if (activeBtn && vind) {
            vind.style.left = activeBtn.offsetLeft + "px"
            vind.style.width = activeBtn.offsetWidth + "px"
        }
    }

    /* ================= preferences, theme, settings: settings/ ================= */
    use("settings", installSettings(ctx))

    /* ================= wire up ================= */
    subscribe(renderCanvas)

    let lastSelSig = ""
    subscribe(() => {
        updateProps()
        updateAlignButtons()
        updateFill()
        updateLayoutPanel()
        if (panelAPI) {
            panelAPI.updateField()
            panelAPI.updateTooltip()
        }
        if (!activeWidget) return
        const sig = Array.from(selection)
            .sort((a, b) => a - b)
            .join(",")
        if (sig !== lastSelSig) {
            lastSelSig = sig
            activeWidget.rebuild()
        } else {
            activeWidget.refresh()
        }
    })

    if (!loadDoc()) {
        seedDemoText(ctx)
        renderCanvas()
        centerDefaultItems(ctx) // needs real measurements from the render above
        seedDemoFrame(ctx)
    }
    applyView()
    ctx.settings.applyTheme()
    applyBg()
    ctx.settings.renderAvatar()
    ctx.flags.restoring = true
    touchParentFrames() // prime lastText without bumping anything
    ctx.flags.restoring = false
    renderCanvas() // re-render with the centered positions
    buildPanel()
    updateLayoutPanel()
    updateProps()
    updateAlignButtons()
    updateFill()
    updateVariantButtons()

    const destroy = () => {
        ctx.disposeDocListeners()
        clearTimeout(nudgeTimer)
        clearTimeout(saveTimer)
        window.removeEventListener("pagehide", onPageHide)
        for (let i = disposers.length - 1; i >= 0; i--) disposers[i]()
        root.innerHTML = ""
    }

    return {
        setFill,
        beginFillGesture: () => {
            fillGesture = true
            fillPre = snapshot()
        },
        endFillGesture: () => {
            fillGesture = false
            fillPre = null
        },
        setFont,
        destroy,
    }
}
