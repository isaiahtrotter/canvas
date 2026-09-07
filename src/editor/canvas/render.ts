// Rendering the document into #world, and the frame labels into #overlay.
//
// The canvas DOM is reconciled in place, keyed by item id, rather than
// rebuilt on every change. Rebuilding restarted every CSS animation and
// dropped every in-flight transition on every layer (in the heatmap,
// everything blinked whenever anything changed) and tore down the node
// being edited. Now an unchanged layer's node is left exactly as it is;
// only the properties that actually changed are written, so only the
// affected layers transition. Handlers look their item up by id at event
// time, since undo/redo replaces the item objects.
import type { EditorContext, Disposable } from "../core/context"
import { type FrameItem, type TextItem, isFrame, isText, lineHeightOf, letterSpacingOf } from "../core/types"
import { rgbaCss } from "../color"
import { absTime, relTime } from "../time"

export interface CanvasAPI {
    /** Reconcile #world to the document, then run layouts, wash, clips, heat, overlay, minimap, layers. */
    renderCanvas(): void
    /** Re-run the layout engine against the current nodes and write back what moved (every keystroke while editing). */
    relayoutLive(): void
    /** The translucent tint on the text whose size handle is hovered. */
    applyWash(): void
    renderFrameLabels(): void
    placeLabel(el: HTMLElement, x: number, y: number, w: number): void
    /** The screen-space layer the frame labels live in (a frame draft's label is appended here too). */
    labelLayer: HTMLElement
}

export function installCanvas(ctx: EditorContext): CanvasAPI & Disposable {
    const { world, overlay } = ctx.dom
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const view = ctx.doc.view
    const itemById = (id: number) => ctx.store.itemById(id)
    const containingFrame = (it) => ctx.store.containingFrame(it)

    function hexToRgba(hex, a) {
        const n = parseInt(hex.slice(1), 16)
        return (
            "rgba(" +
            ((n >> 16) & 255) +
            "," +
            ((n >> 8) & 255) +
            "," +
            (n & 255) +
            "," +
            a +
            ")"
        )
    }
    function applyWash() {
        const hoverWash = ctx.ui.hoverWash
        // text only — a frame's background is its fill
        items.filter(isText).forEach((it) => {
            const node = ctx.nodeFor(it.id)
            if (!node) return
            node.style.background =
                hoverWash && hoverWash.id === it.id
                    ? hexToRgba(hoverWash.color, 0.15)
                    : ""
        })
    }

    function createTextNode(id: number) {
        const el = document.createElement("div")
        el.className = "titem"
        el.dataset.id = String(id)
        el.addEventListener("pointerdown", (e) => {
            const it = itemById(id)
            if (it) ctx.drag.onItemPointerDown(e, it, el)
        })
        el.addEventListener("dblclick", (e) => {
            e.stopPropagation()
            // already editing: this is a native double-click-to-select-word,
            // not a request to start over (which would re-select everything)
            if (el.getAttribute("contenteditable") === "true") return
            const it = itemById(id)
            if (!it || !isText(it)) return
            if (!ctx.drill.drillInto(it)) ctx.gestures.startEditing(el, it) // one level deeper, or edit once there's nowhere deeper
        })
        return el
    }
    function createFrameNode(id: number) {
        const el = document.createElement("div")
        el.className = "frame"
        el.dataset.id = String(id)
        // the name/timestamp label lives in the screen-space overlay (see
        // renderFrameLabels), not in here. A top-level frame is grabbed by
        // that label; an empty one also from anywhere inside it, but one
        // holding text keeps its body as empty canvas so a marquee can start
        // there. A child frame (nested inside another) has no label to grab
        // by at all — it shows none — so its body always selects it,
        // whether or not it holds text.
        el.addEventListener("pointerdown", (e) => {
            if (e.target !== el) return
            const it = itemById(id)
            if (!it || !isFrame(it)) return
            // "contents" means anything parented to it — text or a nested
            // frame — not just text; a top-level frame holding only a child
            // frame must be just as ungrabbable from its body
            const hasContents = items.some((c) => c.id !== id && c.parent === id)
            if (hasContents && !containingFrame(it)) return
            ctx.drag.onItemPointerDown(e, it, el)
        })
        el.addEventListener("dblclick", (e) => {
            if (e.target !== el) return
            const it = itemById(id)
            if (it && ctx.drill.drillInto(it)) e.stopPropagation()
        })
        return el
    }
    /* Frame labels (name + timestamp) are drawn in #overlay at exact screen
       coordinates, like the selection box — not inside the zoomed #world
       with a counter-scale. Nesting scale(1/z) inside scale(z) made Chromium
       rasterize the text a few pixels off its layout position, drifting with
       zoom (measured: −4px at 1160%, then +8px from 1400% on, so the label
       sat on the frame's edge). In screen space there is no transform to get
       wrong. Reconciled in place by frame id so a label being renamed, and
       any color transition, survives a re-render. */
    const labelLayer = document.createElement("div")
    labelLayer.className = "labels"
    overlay.appendChild(labelLayer)
    const LABEL_GAP = 6 // screen px between the label's bottom and the frame's top
    function placeLabel(el: HTMLElement, x: number, y: number, w: number) {
        const p = ctx.geo.toScreen(x, y)
        el.style.left = Math.round(p.x) + "px"
        el.style.top = Math.round(p.y) - LABEL_GAP + "px"
        el.style.maxWidth = Math.max(0, Math.round(w * view.z)) + "px" // never wider than the frame
    }
    function createLabel(id: number) {
        const label = document.createElement("div")
        label.className = "flabel"
        label.dataset.id = String(id)
        const name = document.createElement("span")
        name.className = "fname"
        const time = document.createElement("span")
        time.className = "ftime"
        label.append(name, time)
        label.addEventListener("pointerdown", (e) => {
            const it = itemById(id)
            const node = ctx.nodeFor(id)
            if (it && node) ctx.drag.onItemPointerDown(e, it, node)
        })
        name.addEventListener("dblclick", (e) => {
            e.stopPropagation()
            const it = itemById(id)
            if (it && isFrame(it)) ctx.gestures.startRenaming(name, it)
        })
        return label
    }
    function renderFrameLabels() {
        const frames = items.filter(isFrame)
        // a frame nested inside another frame is that frame's child — it
        // shows no name or timestamp of its own, same as it gets no
        // selection handles of its own when it's the lone selection
        const topLevel = new Set(frames.filter((f) => !containingFrame(f)).map((f) => f.id))
        Array.from(labelLayer.children).forEach((n) => {
            const idAttr = (n as HTMLElement).dataset.id
            if (idAttr !== undefined && !topLevel.has(Number(idAttr))) n.remove()
        })
        frames.forEach((f) => {
            if (!topLevel.has(f.id)) return
            let el = labelLayer.querySelector<HTMLElement>('[data-id="' + f.id + '"]')
            if (!el) {
                el = createLabel(f.id)
                labelLayer.appendChild(el)
            }
            el.classList.toggle("selected", selection.has(f.id))
            const name = el.querySelector<HTMLElement>(".fname")
            const time = el.querySelector<HTMLElement>(".ftime")
            if (name && name.getAttribute("contenteditable") !== "true" && name.textContent !== f.name)
                name.textContent = f.name
            if (time && time.dataset.t !== String(f.updatedAt)) {
                time.dataset.t = String(f.updatedAt)
                time.textContent = relTime(f.updatedAt)
                time.title = absTime(f.updatedAt)
            }
            placeLabel(el, f.x, f.y, f.w)
        })
    }
    // write a style only when it differs — an identical write is harmless
    // to layout but would still be noise, and this keeps intent clear
    function setStyle(el: HTMLElement, prop: string, value: string) {
        if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value)
    }
    function updateTextNode(el: HTMLElement, it: TextItem, multi: boolean) {
        el.classList.toggle("sel-underline", multi && selection.has(it.id))
        setStyle(el, "left", it.x + "px")
        setStyle(el, "top", it.y + "px")
        setStyle(el, "font-size", it.size + "px")
        setStyle(el, "font-family", it.font)
        setStyle(el, "font-weight", String(it.weight))
        setStyle(el, "line-height", String(lineHeightOf(it)))
        setStyle(el, "letter-spacing", letterSpacingOf(it) + "px")
        setStyle(el, "opacity", String((it.opacity != null ? it.opacity : 100) / 100))
        setStyle(el, "color", rgbaCss(it.fill, it.alpha))
        // the node being edited owns its own text until it commits
        if (el !== ctx.ui.editingEl && el.textContent !== it.text) el.textContent = it.text
    }
    function updateFrameNode(el: HTMLElement, it: FrameItem) {
        el.classList.toggle("selected", selection.has(it.id))
        setStyle(el, "left", it.x + "px")
        setStyle(el, "top", it.y + "px")
        setStyle(el, "width", it.w + "px")
        setStyle(el, "height", it.h + "px")
        setStyle(el, "background", rgbaCss(it.fill, it.alpha))
    }
    function renderCanvas() {
        const multi = selection.size > 1
        // frames sit under text
        const ordered = [...items.filter(isFrame), ...items.filter(isText)]
        const live = new Set(ordered.map((it) => it.id))
        // drop nodes whose item is gone (leave anything without an id, like a frame draft)
        Array.from(world.children).forEach((n) => {
            const idAttr = (n as HTMLElement).dataset.id
            if (idAttr !== undefined && !live.has(Number(idAttr))) n.remove()
        })
        // walk the expected order; a node is only moved when it's out of place
        let cursor: ChildNode | null = world.firstChild
        ordered.forEach((it) => {
            const want = isFrame(it) ? "frame" : "titem"
            let el = world.querySelector<HTMLElement>(':scope > [data-id="' + it.id + '"]')
            if (el && !el.classList.contains(want)) {
                el.remove()
                el = null
            }
            if (!el) el = isFrame(it) ? createFrameNode(it.id) : createTextNode(it.id)
            if (el === cursor) cursor = cursor.nextSibling
            else world.insertBefore(el, cursor)
            if (isFrame(it)) updateFrameNode(el, it)
            else updateTextNode(el, it as TextItem, multi)
        })
        // smart layouts need the fresh nodes' measurements; they may move
        // children and resize hugging frames, so write those nodes again
        relayoutLive()
        applyWash()
        ctx.layout.applyClips()
        if (ctx.ui.heat) ctx.times.applyHeat()
        ctx.overlay.renderSelectionOverlay()
        ctx.minimap.update()
        ctx.layers.renderLayers()
    }

    // run the layout engine against the current nodes and write back whatever
    // moved or resized. Used by renderCanvas() and, so hugging frames follow
    // their contents in real time, on every keystroke while editing text.
    function relayoutLive() {
        if (!ctx.layout.applyLayouts()) return
        const multi = selection.size > 1
        items.forEach((it) => {
            const el = world.querySelector<HTMLElement>(':scope > [data-id="' + it.id + '"]')
            if (!el) return
            if (isFrame(it)) updateFrameNode(el, it)
            else updateTextNode(el, it as TextItem, multi)
        })
        ctx.layout.applyClips()
    }
    // Text is measured from the DOM, so a layout computed before a web font
    // has finished loading used the fallback font's metrics — a hugging
    // frame could sit narrower than the text that arrived a moment later.
    // Re-run once the fonts are in (and whenever more load later).
    const onFontsLoaded = () => {
        relayoutLive()
        ctx.overlay.renderSelectionOverlay()
        ctx.persist.scheduleSave()
    }
    if (typeof document !== "undefined" && document.fonts) {
        document.fonts.ready.then(onFontsLoaded)
        document.fonts.addEventListener("loadingdone", onFontsLoaded)
    }

    return {
        renderCanvas,
        relayoutLive,
        applyWash,
        renderFrameLabels,
        placeLabel,
        labelLayer,
        dispose() {
            document.fonts?.removeEventListener("loadingdone", onFontsLoaded)
        },
    }
}
