// Vanilla-DOM editor engine, ported from reference/multiple_text_editor.jsx.
// mountEditor(root) renders the markup into `root`, wires every interaction,
// and returns a cleanup that tears the whole thing down.
import { MARKUP } from "./markup"
import { absTime, relTime } from "./time"
import { compositeOver, contrastRatio, hexToRgb, isHex, rgbaCss } from "./color"

interface TextItem {
    kind: "text"
    id: number
    x: number
    y: number
    text: string
    size: number
    font: string
    weight: number
    lineHeight?: number // unitless multiplier; default 1.2
    letterSpacing?: number // px; default 0
    /** id of the frame this text belongs to, or null. Membership is decided by
     *  where the pointer is when a drag ends (or where a frame is drawn), not by
     *  geometry, so a text can hang past its frame's edge and still be clipped
     *  by it. `undefined` only in documents saved before this field existed. */
    parent?: number | null
    /** last content/style edit — what the heatmap reads. Frames have the same field. */
    updatedAt?: number
    opacity?: number
    fill: string // hex
    alpha: number // 0–100
}

export interface FrameItem {
    kind: "frame"
    id: number
    x: number
    y: number
    w: number
    h: number
    name: string
    createdAt: number
    updatedAt: number
    fill: string // hex
    alpha: number // 0–100
}

export interface Fill {
    hex: string
    alpha: number
}
/** What the editor tells its host about the Fill control. */
export type FillMode = "selection" | "background"
export interface EditorHooks {
    /** The fill swatch was clicked: open a picker anchored to `anchor`, for the selection or the canvas background. */
    onFillOpen?: (anchor: DOMRect, fill: Fill, mode: FillMode) => void
    /** Selection (or, in background mode, the background color) changed while the host may be showing a picker. */
    onFillChange?: (fill: Fill, mode: FillMode) => void
}
export interface EditorAPI {
    /** Apply a fill to every selected layer. The first call after beginFillGesture() logs one undo step. */
    setFill: (hex: string, alpha: number) => void
    beginFillGesture: () => void
    endFillGesture: () => void
    destroy: () => void
}

type Item = TextItem | FrameItem
const isFrame = (it: Item): it is FrameItem => it.kind === "frame"
const isText = (it: Item): it is TextItem => it.kind === "text"

export function mountEditor(root: HTMLElement, hooks: EditorHooks = {}): EditorAPI {
    root.innerHTML = MARKUP

    // document-level listeners, tracked so unmount removes them
    const docListeners: Array<[string, EventListener]> = []
    function onDoc<K extends keyof DocumentEventMap>(
        type: K,
        fn: (e: DocumentEventMap[K]) => void
    ) {
        document.addEventListener(type, fn)
        docListeners.push([type, fn as EventListener])
    }

    /* ================= ported app ================= */

    // MIN..MAX is the range the size slider shows; the size itself has no
    // upper limit (type any value into the field) and a floor of SIZE_MIN
    const MIN = 8,
        MAX = 48,
        STEP = 4,
        INSET = 12
    const SIZE_MIN = 1
    const DEFAULT_LINE_HEIGHT = 1.2
    const lineHeightOf = (it: TextItem) => it.lineHeight ?? DEFAULT_LINE_HEIGHT
    const letterSpacingOf = (it: TextItem) => it.letterSpacing ?? 0
    const PALETTE = [
        "#008FF0",
        "#F24822",
        "#FFCD29",
        "#14AE5C",
        "#9747FF",
        "#FF7A00",
        "#FF24BD",
        "#00B5CE",
        "#845EF7",
        "#E8590C",
    ]

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
    let nextId = 1
    const items: Item[] = []
    const selection = new Set<number>()
    const listeners = []
    function subscribe(fn) {
        listeners.push(fn)
    }
    function emit() {
        touchParentFrames()
        listeners.forEach((fn) => fn())
        scheduleSave()
    }

    /* A frame's "edited" time also moves when anything inside it changes.
       Rather than sprinkling bumps through every mutation path, each emit
       diffs text layers against the last emit: a text that changed (moved,
       retyped, restyled, or newly added) bumps the frame that contains it now
       and, if it moved, the one it came from. Undo/redo set `restoring` so a
       restored snapshot keeps the timestamps it was saved with. */
    let restoring = false
    let carryingFrameDrag = false // true only while a frame-drag's own emit() is diffing
    const lastText = new Map<number, { sig: string; parent: number | null }>()
    function textSig(it: TextItem) {
        return [it.x, it.y, it.text, it.size, it.font, it.weight, it.fill, it.alpha, lineHeightOf(it), letterSpacingOf(it)].join("|")
    }
    function touchParentFrames() {
        const now = Date.now()
        const seen = new Set<number>()
        items.filter(isText).forEach((t) => {
            seen.add(t.id)
            const sig = textSig(t)
            const parent = t.parent ?? null
            const prev = lastText.get(t.id)
            if (!prev || prev.sig !== sig || prev.parent !== parent) {
                if (!restoring && !carryingFrameDrag) {
                    t.updatedAt = now
                    const bump = (f: FrameItem | null) => {
                        if (f) f.updatedAt = now
                    }
                    bump(containingFrame(t))
                    if (prev && prev.parent !== parent) bump(frameById(prev.parent)) // the frame it left
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
        nextId = items.reduce((m, it) => Math.max(m, it.id), 0) + 1
        restoring = true
        emit()
        restoring = false
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
        if (settingsOpen) return
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
                id: nextId++,
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
        items.filter(isText).forEach((t) => {
            if (t.parent == null && rectContains(f, t)) t.parent = f.id
        })
    }

    let frameCount = 0
    function addFrame(props: Partial<FrameItem>): FrameItem {
        const now = Date.now()
        frameCount++
        const f: FrameItem = Object.assign(
            {
                kind: "frame" as const,
                id: nextId++,
                x: 0,
                y: 0,
                w: 200,
                h: 150,
                name: "Frame " + frameCount,
                createdAt: now,
                updatedAt: now,
                fill: "#ffffff",
                alpha: 100,
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

    function seedDemoText() {
        addItem({ x: 60, y: 70, text: "select multiple", size: 32, weight: 400 })
        addItem({ x: 60, y: 130, text: "lines of text", size: 20, weight: 400 })
        addItem({ x: 60, y: 180, text: "and use the drop down", size: 16, weight: 400 })
        addItem({ x: 60, y: 220, text: "to edit them", size: 14, weight: 400 })
    }

    /* ---- persistence: the document (layers, counters, background, view)
       lives in localStorage so a refresh picks up where you left off ---- */
    const DOC_KEY = "canvas.doc.v1"
    let saveTimer = null
    function saveDoc() {
        try {
            localStorage.setItem(
                DOC_KEY,
                JSON.stringify({ items, nextId, frameCount, bg, view })
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
            // text saved before it had its own edit time: inherit its frame's
            items.filter(isText).forEach((t) => {
                if (typeof t.updatedAt === "number") return
                const f = items.find((it) => it.id === t.parent)
                t.updatedAt = f && isFrame(f) ? f.updatedAt : Date.now()
            })
            nextId = typeof d.nextId === "number" ? d.nextId : items.reduce((m, it) => Math.max(m, it.id), 0) + 1
            frameCount = typeof d.frameCount === "number" ? d.frameCount : items.filter(isFrame).length
            if (d.bg && isHex(d.bg.hex)) bg = { hex: d.bg.hex, alpha: d.bg.alpha ?? 100 }
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
    const app = root.querySelector<HTMLElement>(".app")
    const canvas = root.querySelector<HTMLElement>("#canvas")
    const world = root.querySelector<HTMLElement>("#world")
    // Chrome that must render at a constant screen size (selection box,
    // handles, marquee, measurement guides) lives here, in screen space,
    // instead of inside the scaled #world — so a 1px border is 1px at any
    // zoom, with no counter-scaling and no blurry fractional strokes.
    const overlay = root.querySelector<HTMLElement>("#overlay")
    let editingEl = null
    let hoverWash = null // {id, color} — set while a slider handle is hovered/dragged

    /* ---- view: pan + zoom. Items live in world coords; #world carries
       translate(x,y) scale(z). --inv is 1/z so chrome that should stay a
       constant size on screen (frame labels, handles) can counter-scale. ---- */
    const ZOOM_MIN = 0.1,
        ZOOM_MAX = 20 // 2000%
    const GRID_FROM = 10 // the pixel grid appears from 1000%
    const view = { x: 0, y: 0, z: 1 }
    const zoomVal = root.querySelector<HTMLElement>("#zoomVal")
    const grid = root.querySelector<HTMLCanvasElement>("#grid")
    /* One line per integer world coordinate, each placed at its exact screen
       position (rounded to a device pixel) so frame edges — which sit on
       integer coordinates — land on grid lines at any zoom, with no drift. */
    function applyGrid() {
        if (!grid) return
        const on = prefs.grid && view.z >= GRID_FROM
        grid.classList.toggle("on", on)
        if (!on) return
        const dpr = window.devicePixelRatio || 1
        const W = canvas.clientWidth,
            H = canvas.clientHeight
        const pw = Math.round(W * dpr),
            ph = Math.round(H * dpr)
        if (grid.width !== pw || grid.height !== ph) {
            grid.width = pw
            grid.height = ph
        }
        const ctx = grid.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, pw, ph)
        ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--grid").trim() || "rgba(0,0,0,.09)"
        const z = view.z
        for (let k = Math.ceil(-view.x / z); k <= Math.floor((W - view.x) / z); k++)
            ctx.fillRect(Math.round((view.x + k * z) * dpr), 0, 1, ph)
        for (let k = Math.ceil(-view.y / z); k <= Math.floor((H - view.y) / z); k++)
            ctx.fillRect(0, Math.round((view.y + k * z) * dpr), pw, 1)
    }
    function applyView() {
        world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`
        world.style.setProperty("--inv", String(1 / view.z))
        if (zoomVal) zoomVal.textContent = Math.round(view.z * 100) + "%"
        applyGrid()
        updateMinimap()
        // screen-space chrome has to follow the view
        renderSelectionOverlay()
        refreshMeasure()
        scheduleSave()
    }

    /* ---- minimap: fades in above the zoom pill once nothing is on screen.
       Frames are dots, the viewport is a rectangle; click to jump there. ---- */
    const minimap = root.querySelector<HTMLElement>("#minimap")
    // the viewport rectangle is sized from canvas.clientWidth/Height, so a
    // browser resize has to redraw it too
    const canvasRO =
        typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => {
                  updateMinimap()
                  renderSelectionOverlay()
                  applyGrid() // the bitmap is sized to the canvas
              })
            : null
    canvasRO?.observe(canvas)
    // the minimap is exactly as wide as the zoom pill beneath it; MM_W is
    // re-measured from the pill each time the map is drawn
    let MM_W = 110
    const MM_H = 72,
        MM_PAD = 4
    const zoomPill = root.querySelector<HTMLElement>(".zoompill")
    const PILL_GAP = 12 // the zoom pill's distance from the canvas edge; the minimap sits the same distance above it
    function syncMinimapWidth() {
        if (!zoomPill || !minimap) return
        const w = zoomPill.offsetWidth - 2 // the map is content-box with a 1px border
        if (w > 0 && w !== MM_W) {
            MM_W = w
            minimap.style.width = MM_W + "px"
        }
        minimap.style.bottom = PILL_GAP + zoomPill.offsetHeight + PILL_GAP + "px"
    }
    let mmScale = 1,
        mmOx = 0,
        mmOy = 0 // world → minimap: (x - mmOx) * mmScale
    function intersects(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    }
    let mmDragging = false
    function positionMmView(v: HTMLElement, vp) {
        v.style.left = (vp.x - mmOx) * mmScale + "px"
        v.style.top = (vp.y - mmOy) * mmScale + "px"
        v.style.width = vp.w * mmScale + "px"
        v.style.height = vp.h * mmScale + "px"
    }
    function updateMinimap() {
        if (!minimap) return
        const vp = viewportWorldRect()
        // while the viewport rectangle is being dragged the map stays put
        // (no refit, no hide) — only the rectangle moves
        if (mmDragging) {
            const v = minimap.querySelector<HTMLElement>(".mm-view")
            if (v) positionMmView(v, vp)
            return
        }
        const anyVisible = items.some((it) => {
            const { w, h } = nodeSize(it)
            return intersects({ x: it.x, y: it.y, w, h }, vp)
        })
        const show = items.length > 0 && !anyVisible
        minimap.classList.toggle("on", show)
        if (!show) return
        syncMinimapWidth()
        // fit everything plus the viewport
        const all = boundsOf(items)
        const x1 = Math.min(all.x, vp.x),
            y1 = Math.min(all.y, vp.y)
        const x2 = Math.max(all.x + all.w, vp.x + vp.w),
            y2 = Math.max(all.y + all.h, vp.y + vp.h)
        mmScale = Math.min((MM_W - MM_PAD * 2) / (x2 - x1), (MM_H - MM_PAD * 2) / (y2 - y1))
        mmOx = x1 - (MM_W / mmScale - (x2 - x1)) / 2
        mmOy = y1 - (MM_H / mmScale - (y2 - y1)) / 2
        minimap.innerHTML = ""
        items.filter(isFrame).forEach((f) => {
            const d = document.createElement("i")
            d.className = "mm-dot"
            d.style.left = (f.x + f.w / 2 - mmOx) * mmScale + "px"
            d.style.top = (f.y + f.h / 2 - mmOy) * mmScale + "px"
            minimap.appendChild(d)
        })
        const v = document.createElement("div")
        v.className = "mm-view"
        positionMmView(v, vp)
        v.addEventListener("pointerdown", startMmDrag)
        minimap.appendChild(v)
    }
    // Drag the viewport rectangle to pan. It's clamped to the map's edges, so
    // you can't drag the view out past what the minimap shows.
    function startMmDrag(e: PointerEvent) {
        e.stopPropagation()
        e.preventDefault()
        mmDragging = true
        minimap.classList.add("dragging")
        const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        const vp0 = viewportWorldRect()
        // keep an 8px gutter so the rectangle never touches the map's edge
        const MM_GUTTER = 4
        const maxX = MM_W - MM_GUTTER - vp0.w * mmScale,
            maxY = MM_H - MM_GUTTER - vp0.h * mmScale
        function mv(ev: PointerEvent) {
            // desired rect position in minimap px, clamped inside the map
            let mx = (vp0.x - mmOx) * mmScale + (ev.clientX - start.x)
            let my = (vp0.y - mmOy) * mmScale + (ev.clientY - start.y)
            mx = Math.max(MM_GUTTER, Math.min(maxX, mx))
            my = Math.max(MM_GUTTER, Math.min(maxY, my))
            const wx = mx / mmScale + mmOx,
                wy = my / mmScale + mmOy
            view.x = -wx * view.z
            view.y = -wy * view.z
            applyView()
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            mmDragging = false
            minimap.classList.remove("dragging")
            updateMinimap() // refit (and possibly hide) now that the drag is over
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }
    minimap?.addEventListener("click", (e: MouseEvent) => {
        if ((e.target as HTMLElement).classList.contains("mm-view")) return
        const r = minimap.getBoundingClientRect()
        const wx = (e.clientX - r.left) / mmScale + mmOx
        const wy = (e.clientY - r.top) / mmScale + mmOy
        // center the viewport on the clicked world point
        view.x = canvas.clientWidth / 2 - wx * view.z
        view.y = canvas.clientHeight / 2 - wy * view.z
        applyView()
    })
    function toWorld(clientX: number, clientY: number) {
        const r = canvas.getBoundingClientRect()
        return {
            x: (clientX - r.left - view.x) / view.z,
            y: (clientY - r.top - view.y) / view.z,
        }
    }
    // world → canvas-relative screen coords
    function toScreen(x: number, y: number) {
        return { x: view.x + x * view.z, y: view.y + y * view.z }
    }
    function placeScreenRect(el: HTMLElement, r: { x: number; y: number; w: number; h: number }) {
        const p = toScreen(r.x, r.y)
        // snap edges to whole pixels so the 1px strokes stay crisp
        const l = Math.round(p.x),
            t = Math.round(p.y)
        el.style.left = l + "px"
        el.style.top = t + "px"
        el.style.width = Math.round(p.x + r.w * view.z) - l + "px"
        el.style.height = Math.round(p.y + r.h * view.z) - t + "px"
    }
    // zoom so the world point under canvas-relative (cx, cy) stays put
    function zoomAt(factor: number, cx: number, cy: number) {
        const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.z * factor))
        if (z === view.z) return
        view.x = cx - (cx - view.x) * (z / view.z)
        view.y = cy - (cy - view.y) * (z / view.z)
        view.z = z
        applyView()
    }
    function zoomCenter(factor: number) {
        zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2)
    }
    function resetView() {
        view.x = 0
        view.y = 0
        view.z = 1
        applyView()
    }
    // the visible part of the world, in world coords
    function viewportWorldRect() {
        return {
            x: -view.x / view.z,
            y: -view.y / view.z,
            w: canvas.clientWidth / view.z,
            h: canvas.clientHeight / view.z,
        }
    }
    canvas.addEventListener(
        "wheel",
        (e: WheelEvent) => {
            e.preventDefault()
            const r = canvas.getBoundingClientRect()
            // a pinch (ctrlKey) reports smaller deltas than a wheel notch
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
            zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
        },
        { passive: false }
    )
    /* Panning is always done through view.x/y + the #world transform — #canvas
       itself never scrolls under our own code. But while editing text near an
       edge, the browser's native "keep the caret in view" behavior scrolls
       #canvas directly, and everything our own render pipeline draws (the
       selection box, handles, and size tooltip in #overlay) is positioned
       from view.x/y alone, with no idea that #canvas has scrolled — so it
       stops tracking the text and is left stranded at its pre-scroll spot.
       Fold that scroll straight into our own pan instead of fighting it: the
       browser still decides when and how far to scroll to keep the caret
       visible, we just absorb the result into view.x/y and re-render through
       the normal path, so everything — including the selection box — moves
       together and stays in sync. */
    canvas.addEventListener("scroll", () => {
        if (!canvas.scrollLeft && !canvas.scrollTop) return
        view.x -= canvas.scrollLeft
        view.y -= canvas.scrollTop
        canvas.scrollLeft = 0
        canvas.scrollTop = 0
        applyView()
    })
    root.querySelectorAll<HTMLElement>(".zoompill [data-z]").forEach((b) => {
        b.addEventListener("click", () => {
            if (b.dataset.z === "reset") resetView()
            else zoomCenter(b.dataset.z === "+" ? 1.25 : 1 / 1.25)
        })
    })

    /* ---- panning: hold Space and drag, or drag with the middle button ---- */
    let spaceDown = false
    function setSpaceDown(v: boolean) {
        spaceDown = v
        canvas.classList.toggle("pan-ready", v)
    }
    function startPan(e: PointerEvent) {
        canvas.classList.add("panning")
        let lx = e.clientX,
            ly = e.clientY
        function mv(ev: PointerEvent) {
            view.x += ev.clientX - lx
            view.y += ev.clientY - ly
            lx = ev.clientX
            ly = ev.clientY
            applyView()
        }
        function up() {
            canvas.classList.remove("panning")
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }
    const onWindowBlur = () => {
        setSpaceDown(false)
        setAltDown(false)
    }
    window.addEventListener("blur", onWindowBlur)

    /* ---- Option/Alt measurement: hold the key and hover another layer to see
       the pixel gap to the current selection. Hovering a frame instead draws
       two guides — horizontal and vertical — to whichever of its edges are
       nearest the cursor, each labeled with the distance from the selection. ---- */
    let altDown = false
    let measureBox: HTMLElement | null = null
    let measureSig = "" // what's currently drawn; skip the rebuild when nothing changed
    let lastHover: HTMLElement | null = null // last layer under the pointer, kept even without Alt
    function setAltDown(v: boolean) {
        if (altDown === v) return
        altDown = v
        if (v) refreshMeasure() // show immediately, even if the mouse is still
        else clearMeasure()
    }
    function clearMeasure() {
        measureBox?.remove()
        measureBox = null
        measureSig = ""
    }
    function itemBounds(it: Item) {
        const { w, h } = nodeSize(it)
        return { x: it.x, y: it.y, w, h }
    }
    // a guide between two world points on one axis; drawn in screen space
    function addMeasureLine(
        container: HTMLElement,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        dist: number
    ) {
        if (Math.abs(dist) < 0.5) return // touching — nothing to show
        const a0 = toScreen(x1, y1),
            b0 = toScreen(x2, y2)
        const a = { x: Math.round(a0.x), y: Math.round(a0.y) },
            b = { x: Math.round(b0.x), y: Math.round(b0.y) }
        const horizontal = y1 === y2
        const line = document.createElement("div")
        line.className = "measure-line"
        if (horizontal) {
            line.style.left = Math.min(a.x, b.x) + "px"
            line.style.top = a.y + "px"
            line.style.width = Math.abs(b.x - a.x) + "px"
            line.style.height = "1px"
        } else {
            line.style.left = a.x + "px"
            line.style.top = Math.min(a.y, b.y) + "px"
            line.style.width = "1px"
            line.style.height = Math.abs(b.y - a.y) + "px"
        }
        container.appendChild(line)
        const label = document.createElement("div")
        label.className = "measure-label"
        label.textContent = Math.round(Math.abs(dist)) + "px"
        label.style.left = (a.x + b.x) / 2 + "px"
        label.style.top = (a.y + b.y) / 2 + "px"
        container.appendChild(label)
    }
    // Guides run from the middle of the selection's facing side straight to
    // the hovered target's edge. When the target surrounds the selection (its
    // frame), rulers extend to all four of its edges.
    function measureTo(container: HTMLElement, sel, target) {
        const selCx = sel.x + sel.w / 2,
            selCy = sel.y + sel.h / 2
        const overlapX = Math.max(sel.x, target.x) < Math.min(sel.x + sel.w, target.x + target.w)
        const overlapY = Math.max(sel.y, target.y) < Math.min(sel.y + sel.h, target.y + target.h)
        if (overlapX && overlapY) {
            addMeasureLine(container, target.x, selCy, sel.x, selCy, sel.x - target.x) // left
            addMeasureLine(container, sel.x + sel.w, selCy, target.x + target.w, selCy, target.x + target.w - (sel.x + sel.w)) // right
            addMeasureLine(container, selCx, target.y, selCx, sel.y, sel.y - target.y) // top
            addMeasureLine(container, selCx, sel.y + sel.h, selCx, target.y + target.h, target.y + target.h - (sel.y + sel.h)) // bottom
            return
        }
        if (!overlapY) {
            const below = target.y >= sel.y + sel.h
            const y1 = below ? sel.y + sel.h : sel.y
            const y2 = below ? target.y : target.y + target.h
            addMeasureLine(container, selCx, y1, selCx, y2, y2 - y1)
        }
        if (!overlapX) {
            const right = target.x >= sel.x + sel.w
            const x1 = right ? sel.x + sel.w : sel.x
            const x2 = right ? target.x : target.x + target.w
            addMeasureLine(container, x1, selCy, x2, selCy, x2 - x1)
        }
    }
    function hoveredItem(): Item | null {
        if (!lastHover || !lastHover.isConnected) return null
        return items.find((it) => it.id === Number(lastHover.dataset.id)) ?? null
    }
    // (re)draw for the current hover — cheap no-op when nothing relevant changed
    function refreshMeasure(force = false) {
        const hovered = altDown ? hoveredItem() : null
        const sel = hovered && !selection.has(hovered.id) ? selectionBounds() : null
        if (!hovered || !sel) {
            clearMeasure()
            return
        }
        const hb = itemBounds(hovered)
        const sig = [hovered.id, sel.x, sel.y, sel.w, sel.h, hb.x, hb.y, hb.w, hb.h, view.x, view.y, view.z].join("|")
        if (!force && sig === measureSig && measureBox) return
        clearMeasure()
        measureSig = sig
        measureBox = document.createElement("div")
        measureBox.className = "measure"
        measureTo(measureBox, sel, hb)
        overlay.appendChild(measureBox)
    }
    canvas.addEventListener("pointermove", (e: PointerEvent) => {
        // remember what's under the pointer even without Alt, so pressing Alt
        // with a still mouse can show the measurement right away
        const nowHover =
            e.buttons !== 0 ? lastHover : (e.target as HTMLElement).closest<HTMLElement>(".titem, .frame")
        if (nowHover !== lastHover) {
            lastHover = nowHover
            renderUnderlines()
        }
        // e.buttons !== 0 means some other gesture (drag, resize, pan...) owns
        // this move — Alt already means "duplicate" mid-drag, so stay out of the way
        if (!altDown || e.buttons !== 0) {
            if (measureBox) clearMeasure()
            return
        }
        refreshMeasure()
    })
    canvas.addEventListener("pointerleave", () => {
        lastHover = null
        renderUnderlines()
        clearMeasure()
    })

    /* ---- tools: V = move/select, F = draw a frame ---- */
    type Tool = "move" | "frame"
    let tool: Tool = "move"
    function setTool(t: Tool) {
        tool = t
        canvas.classList.toggle("tool-frame", t === "frame")
        root.querySelectorAll<HTMLElement>(".toolpill [data-tool]").forEach(
            (b) => b.classList.toggle("active", b.dataset.tool === t)
        )
    }
    root.querySelectorAll<HTMLElement>(".toolpill [data-tool]").forEach((b) =>
        b.addEventListener("click", () => setTool(b.dataset.tool as Tool))
    )

    /* ---- toast ---- */
    const toastEl = root.querySelector<HTMLElement>("#toast")
    let toastTimer = null
    function showToast(msg: string) {
        toastEl.textContent = msg
        toastEl.classList.add("show")
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800)
    }

    /* ---- frame timestamps: shown beside the name; Shift+T toggles, and
       the choice sticks in localStorage ---- */
    const TIMES_KEY = "canvas.showTimestamps"
    let showTimes = true
    try {
        showTimes = localStorage.getItem(TIMES_KEY) !== "0"
    } catch (_) {
        /* storage unavailable — default to shown */
    }
    function applyShowTimes() {
        app.classList.toggle("hide-times", !showTimes)
        const sw = root.querySelector<HTMLInputElement>("#prefTimes")
        if (sw) sw.checked = showTimes
    }
    function setShowTimes(v: boolean, toast = true) {
        if (v === showTimes) return
        showTimes = v
        try {
            localStorage.setItem(TIMES_KEY, showTimes ? "1" : "0")
        } catch (_) {
            /* ignore */
        }
        applyShowTimes()
        if (toast) showToast(showTimes ? "Timestamps shown" : "Timestamps hidden")
    }
    function toggleTimes() {
        setShowTimes(!showTimes)
    }
    applyShowTimes()
    function refreshTimes() {
        canvas.querySelectorAll<HTMLElement>(".ftime").forEach((t) => {
            t.textContent = relTime(Number(t.dataset.t))
        })
    }
    const timesTimer = setInterval(refreshTimes, 30000)

    /* ---- heatmap (Shift+H): thermal view of how recently each layer was
       edited. Heat decays on a log scale over a week — just-edited layers
       glow light yellow, untouched ones sink to dark purple. Only the canvas
       changes: the frame/text colors are overridden through CSS variables
       set per node (--heat / --heat-frame), the world gets a slight blur, and
       a key appears on the left. Toggling fades over 300ms via a temporary
       .heat-transition class so the transition never applies to ordinary
       fill edits. ---- */
    let heat = false
    let heatTransTimer = null
    const HEAT_BG = "#0a0218"
    const HEAT_STOPS: [number, number, number][] = [
        [0x1a, 0x05, 0x33], // dark purple — untouched
        [0x4a, 0x0f, 0x7a],
        [0xa3, 0x21, 0x6e],
        [0xef, 0x72, 0x33],
        [0xfb, 0xea, 0x6a], // light yellow — just edited
    ]
    const HEAT_WINDOW_S = 7 * 86400 // a week and beyond is fully cold
    const HEAT_KEY: Array<[string, number]> = [
        ["Now", 0],
        ["10 min", 600],
        ["1 hr", 3600],
        ["1 day", 86400],
        ["1 wk+", HEAT_WINDOW_S],
    ]
    function heatFromAge(ageSeconds: number) {
        const a = Math.max(0, ageSeconds)
        return 1 - Math.min(1, Math.log10(1 + a / 10) / Math.log10(1 + HEAT_WINDOW_S / 10))
    }
    function heatColor(h: number): [number, number, number] {
        const t = Math.max(0, Math.min(1, h)) * (HEAT_STOPS.length - 1)
        const i = Math.min(HEAT_STOPS.length - 2, Math.floor(t))
        const f = t - i
        const a = HEAT_STOPS[i],
            b = HEAT_STOPS[i + 1]
        return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number]
    }
    const rgbCss = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`
    let heatTimer = null // 1s refresh while on; the CSS transition smooths each step
    function applyHeat() {
        const now = Date.now()
        items.forEach((it) => {
            const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
            if (!node) return
            // stagger the glow so frames don't all breathe together
            node.style.setProperty("--phase", ((it.id * 0.37) % 1).toFixed(3))
            const c = heatColor(heatFromAge((now - (it.updatedAt ?? 0)) / 1000))
            // frames and text both take the full heat color, so a fresh edit is
            // the key's bright yellow; text stays legible on a same-heat frame
            // through its dark text-shadow edge and the frame's moving sheen
            node.style.setProperty(isFrame(it) ? "--heat-frame" : "--heat", rgbCss(c))
        })
    }
    // the key: a gradient bar with labels placed at their heat positions
    const heatKey = document.createElement("div")
    heatKey.className = "heatkey"
    heatKey.setAttribute("aria-hidden", "true")
    const heatBar = document.createElement("div")
    heatBar.className = "bar"
    heatBar.style.background =
        "linear-gradient(to bottom, " +
        HEAT_STOPS.slice()
            .reverse()
            .map((c, i) => `${rgbCss(c)} ${(i / (HEAT_STOPS.length - 1)) * 100}%`)
            .join(", ") +
        ")"
    const heatTicks = document.createElement("div")
    heatTicks.className = "ticks"
    HEAT_KEY.forEach(([label, age]) => {
        const t = document.createElement("div")
        t.className = "tick"
        t.textContent = label
        t.style.top = (1 - heatFromAge(age)) * 100 + "%"
        heatTicks.appendChild(t)
    })
    heatKey.append(heatBar, heatTicks)
    canvas.parentElement?.appendChild(heatKey)
    function setHeat(on: boolean) {
        if (heat === on) return
        heat = on
        if (on) applyHeat() // colors are in place before the class reveals them
        canvas.classList.add("heat-transition")
        canvas.classList.toggle("heat", on)
        heatKey.classList.toggle("on", on)
        applyBg() // canvas background + label colors for the thermal look
        clearTimeout(heatTransTimer)
        heatTransTimer = setTimeout(() => canvas.classList.remove("heat-transition"), 350)
        clearInterval(heatTimer)
        if (on) heatTimer = setInterval(applyHeat, 1000)
        showToast(on ? "Heatmap on" : "Heatmap off")
    }
    function toggleHeat() {
        setHeat(!heat)
    }

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
        // text only — a frame's background is its fill
        items.filter(isText).forEach((it) => {
            const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
            if (!node) return
            node.style.background =
                hoverWash && hoverWash.id === it.id
                    ? hexToRgba(hoverWash.color, 0.15)
                    : ""
        })
    }

    /* The canvas DOM is reconciled in place, keyed by item id, rather than
       rebuilt on every change. Rebuilding restarted every CSS animation and
       dropped every in-flight transition on every layer (in the heatmap,
       everything blinked whenever anything changed) and tore down the node
       being edited. Now an unchanged layer's node is left exactly as it is;
       only the properties that actually changed are written, so only the
       affected layers transition. Handlers look their item up by id at event
       time, since undo/redo replaces the item objects. */
    function itemById(id: number): Item | undefined {
        return items.find((i) => i.id === id)
    }
    function createTextNode(id: number) {
        const el = document.createElement("div")
        el.className = "titem"
        el.dataset.id = String(id)
        el.addEventListener("pointerdown", (e) => {
            const it = itemById(id)
            if (it) onItemPointerDown(e, it, el)
        })
        el.addEventListener("dblclick", (e) => {
            e.stopPropagation()
            // already editing: this is a native double-click-to-select-word,
            // not a request to start over (which would re-select everything)
            if (el.getAttribute("contenteditable") === "true") return
            const it = itemById(id)
            if (it && isText(it)) startEditing(el, it)
        })
        return el
    }
    function createFrameNode(id: number) {
        const el = document.createElement("div")
        el.className = "frame"
        el.dataset.id = String(id)
        // the name/timestamp label lives in the screen-space overlay (see
        // renderFrameLabels), not in here. A frame is grabbed by that label;
        // an empty frame also from anywhere inside it. A frame holding text
        // keeps its body as empty canvas so a marquee can start there.
        el.addEventListener("pointerdown", (e) => {
            if (e.target !== el) return
            if (items.some((t) => isText(t) && t.parent === id)) return
            const it = itemById(id)
            if (it) onItemPointerDown(e, it, el)
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
        const p = toScreen(x, y)
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
            const node = canvas.querySelector<HTMLElement>('[data-id="' + id + '"]')
            if (it && node) onItemPointerDown(e, it, node)
        })
        name.addEventListener("dblclick", (e) => {
            e.stopPropagation()
            const it = itemById(id)
            if (it && isFrame(it)) startRenaming(name, it)
        })
        return label
    }
    function renderFrameLabels() {
        const frames = items.filter(isFrame)
        const live = new Set(frames.map((f) => f.id))
        Array.from(labelLayer.children).forEach((n) => {
            const idAttr = (n as HTMLElement).dataset.id
            if (idAttr !== undefined && !live.has(Number(idAttr))) n.remove()
        })
        frames.forEach((f) => {
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
        if (el !== editingEl && el.textContent !== it.text) el.textContent = it.text
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
        applyWash()
        applyClips()
        if (heat) applyHeat()
        renderSelectionOverlay()
        updateMinimap()
        renderLayers()
    }

    /* Text belongs to the frame recorded in its `parent` (set by where the
       pointer is when it's dropped, or by the frame drawn around it), so a
       line that runs past the frame's edge still belongs to it and the part
       poking out is clipped. Frames nest only when fully contained. */
    function frameHolds(f: FrameItem, it: Item) {
        if (f.id === it.id) return false
        if (isFrame(it)) return rectContains(f, it)
        return it.parent === f.id
    }
    // smallest frame under a world point, skipping `exclude` (frames being dragged)
    function frameAt(p: { x: number; y: number }, exclude?: Set<number>): FrameItem | null {
        let best: FrameItem | null = null
        items.filter(isFrame).forEach((f) => {
            if (exclude?.has(f.id)) return
            if (p.x < f.x || p.y < f.y || p.x >= f.x + f.w || p.y >= f.y + f.h) return
            if (!best || f.w * f.h < best.w * best.h) best = f
        })
        return best
    }
    // clip every text layer to the frame it belongs to; text being edited is
    // left unclipped so the caret and what's typed stay visible
    function applyClips() {
        items.filter(isText).forEach((it) => {
            const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
            if (!node) return
            const f = node === editingEl ? null : containingFrame(it)
            if (!f) {
                node.style.clipPath = ""
                return
            }
            const { w, h } = nodeSize(it)
            const top = Math.max(0, f.y - it.y),
                left = Math.max(0, f.x - it.x),
                right = Math.max(0, it.x + w - (f.x + f.w)),
                bottom = Math.max(0, it.y + h - (f.y + f.h))
            node.style.clipPath =
                top || left || right || bottom ? `inset(${top}px ${right}px ${bottom}px ${left}px)` : ""
        })
    }

    /* ---- layers panel: top-most first. Loose text sits above every frame;
       each frame lists the text it holds beneath it. ---- */
    const layerList = root.querySelector<HTMLElement>("#layerList")
    const TEXT_ICON =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1.5 1.5h9v2.2H9.3V3H6.9v7h1.3v1.5H3.8V10h1.3V3H2.7v.7H1.5z"/></svg>'
    const FRAME_ICON =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3.8 1v10M8.2 1v10M1 3.8h10M1 8.2h10"/></svg>'
    function layerRow(it: Item, child: boolean) {
        const row = document.createElement("div")
        row.className =
            "layerrow " + (isFrame(it) ? "frame" : "text") + (child ? " child" : "") + (selection.has(it.id) ? " selected" : "")
        row.dataset.id = String(it.id)
        row.innerHTML = isFrame(it) ? FRAME_ICON : TEXT_ICON
        const name = document.createElement("span")
        name.className = "lname"
        name.textContent = isFrame(it) ? it.name : it.text
        row.appendChild(name)
        row.addEventListener("click", (e) => {
            if (name.getAttribute("contenteditable") === "true") return
            if (e.shiftKey) {
                if (selection.has(it.id)) selection.delete(it.id)
                else selection.add(it.id)
            } else {
                selection.clear()
                selection.add(it.id)
            }
            emit()
        })
        // hovering a text row underlines it on the canvas, like hovering the text itself
        row.addEventListener("mouseenter", () => {
            const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
            if (isText(it) && node) {
                lastHover = node
                renderUnderlines()
            }
        })
        row.addEventListener("mouseleave", () => {
            if (lastHover && lastHover.dataset.id === String(it.id)) {
                lastHover = null
                renderUnderlines()
            }
        })
        if (isFrame(it))
            name.addEventListener("dblclick", (e) => {
                e.stopPropagation()
                startRenaming(name, it)
            })
        return row
    }
    function renderLayers() {
        if (!layerList) return
        layerList.innerHTML = ""
        if (!items.length) {
            const empty = document.createElement("div")
            empty.className = "empty"
            empty.textContent = "No layers yet"
            layerList.appendChild(empty)
            return
        }
        const frames = items.filter(isFrame)
        const texts = items.filter(isText)
        const held = new Set<number>()
        const byFrame = new Map<number, TextItem[]>()
        texts.forEach((t) => {
            const f = containingFrame(t)
            if (!f) return
            held.add(t.id)
            if (!byFrame.has(f.id)) byFrame.set(f.id, [])
            byFrame.get(f.id).push(t)
        })
        texts
            .filter((t) => !held.has(t.id))
            .reverse()
            .forEach((t) => layerList.appendChild(layerRow(t, false)))
        frames
            .slice()
            .reverse()
            .forEach((f) => {
                layerList.appendChild(layerRow(f, false))
                ;(byFrame.get(f.id) ?? [])
                    .slice()
                    .reverse()
                    .forEach((t) => layerList.appendChild(layerRow(t, true)))
            })
    }

    // One-time initial layout for the default demo lines: each line is
    // horizontally centered on its own (a centered text block, not
    // left-margin-aligned), and the whole stack is shifted so it sits
    // vertically centered in the canvas — the original relative gaps
    // between lines (60/50/40px) are preserved, only re-centered as a
    // group. Requires a render pass first so offsetWidth/offsetHeight
    // are real measurements, not guesses.
    function centerDefaultItems() {
        if (!items.length) return
        const canvasW = canvas.clientWidth
        const canvasH = canvas.clientHeight
        const rects = items.map(nodeSize)
        const firstY = items[0].y
        const lastIdx = items.length - 1
        const blockTop = firstY
        const blockBottom = items[lastIdx].y + rects[lastIdx].h
        const shiftY = canvasH / 2 - (blockTop + blockBottom) / 2
        items.forEach((it, i) => {
            it.x = Math.round(canvasW / 2 - rects[i].w / 2) // center each line horizontally
            it.y = Math.round(it.y + shiftY) // recenter the whole stack vertically
        })
    }

    // Wrap the demo text in a frame so frames + timestamps are visible on load.
    function seedDemoFrame() {
        const b = boundsOf(items.filter(isText))
        if (!b) return
        const PAD = 48
        const f = addFrame({
            x: Math.round(b.x - PAD),
            y: Math.round(b.y - PAD),
            w: Math.round(b.w + PAD * 2),
            h: Math.round(b.h + PAD * 2),
        })
        adoptLooseText(f)
    }

    /* Rendered size of an item, in world units. Frames know their size;
       text is measured off its node (unscaled layout size inside #world). */
    function nodeSize(it: Item) {
        if (isFrame(it)) return { w: it.w, h: it.h }
        const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
        if (!node) return { w: 0, h: 0 }
        // getBoundingClientRect is fractional (offsetWidth/Height round), and
        // includes the zoom — divide it back out to get world units
        const r = node.getBoundingClientRect()
        return { w: r.width / view.z, h: r.height / view.z }
    }
    function boundsOf(list: Item[]) {
        if (!list.length) return null
        let x1 = Infinity,
            y1 = Infinity,
            x2 = -Infinity,
            y2 = -Infinity
        list.forEach((it) => {
            const { w, h } = nodeSize(it)
            x1 = Math.min(x1, it.x)
            y1 = Math.min(y1, it.y)
            x2 = Math.max(x2, it.x + w)
            y2 = Math.max(y2, it.y + h)
        })
        if (x1 === Infinity) return null
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    }
    /* Figma-style bounding box: combined bounds of the selection */
    function selectionBounds() {
        return boundsOf(selectedItems())
    }
    function rectContains(f: FrameItem, it: Item) {
        const { w, h } = nodeSize(it)
        return (
            it.x >= f.x &&
            it.y >= f.y &&
            it.x + w <= f.x + f.w &&
            it.y + h <= f.y + f.h
        )
    }
    // the frame holding the item (see frameHolds), if any: a text's parent,
    // or the smallest frame fully containing a frame
    function containingFrame(it: Item): FrameItem | null {
        if (isText(it)) return frameById(it.parent)
        let best: FrameItem | null = null
        items.filter(isFrame).forEach((f) => {
            if (!frameHolds(f, it)) return
            if (!best || f.w * f.h < best.w * best.h) best = f
        })
        return best
    }
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
        items.filter(isText).forEach((it) => {
            const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
            if (!node || node === editingEl) return
            if (!(node.classList.contains("sel-underline") || node === lastHover)) return
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
    }
    function renderSelectionOverlay() {
        canvas.querySelectorAll<HTMLElement>(".selbox").forEach((n) => n.remove())
        renderFrameLabels()
        renderUnderlines()
        if (editingEl) {
            // while typing: the same 1px box, sized to the live text, no handles
            const it = items.find((i) => i.id === Number(editingEl.dataset.id))
            if (!it) return
            const box = document.createElement("div")
            box.className = "selbox editing"
            placeScreenRect(box, itemBounds(it))
            overlay.appendChild(box)
            return
        }
        const b = selectionBounds() // one combined box around everything selected
        if (!b) return
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
            const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
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
        editingEl = el
        el.style.clipPath = "" // see everything while typing; clipped again on commit
        renderSelectionOverlay()
        const preEdit = snapshot()
        el.setAttribute("contenteditable", "true")
        el.focus()
        selectAllText(el)
        const onInput = () => renderSelectionOverlay()
        el.addEventListener("input", onInput)
        function done() {
            el.removeEventListener("input", onInput)
            el.removeAttribute("contenteditable")
            const newText = el.textContent.trim() || "Text"
            if (newText !== it.text) pushHistory(preEdit)
            it.text = newText
            el.removeEventListener("blur", done)
            editingEl = null
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
        if (spaceDown || e.button === 1 || tool === "frame") return
        if (e.button !== 0) return
        if (el.getAttribute("contenteditable") === "true") return
        e.stopPropagation()

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
        const starts = selectedItems().map((s) => ({
            it: s,
            x: s.x,
            y: s.y,
            parent: isText(s) ? s.parent ?? null : null,
        }))
        // a frame carries the text sitting inside it, selected or not
        const carried = new Set(starts.map((s) => s.it.id))
        const draggedFrames = new Set(starts.filter((s) => isFrame(s.it)).map((s) => s.it.id))
        selectedItems()
            .filter(isFrame)
            .forEach((f) => {
                items.filter(isText).forEach((t) => {
                    if (carried.has(t.id) || !frameHolds(f, t)) return
                    carried.add(t.id)
                    starts.push({ it: t, x: t.x, y: t.y, parent: t.parent ?? null })
                })
            })
        // Text moving on its own (not riding along inside a dragged frame)
        // follows the pointer's membership: while the pointer is over a frame
        // the text belongs to it (and is clipped by it); the moment the pointer
        // leaves, the text leaves too.
        const freeTexts = starts.filter(
            (s): s is typeof s & { it: TextItem } =>
                isText(s.it) && !(s.it.parent != null && draggedFrames.has(s.it.parent))
        )
        const preDrag = snapshot() // pre-state: pushed once if the gesture actually moves anything
        let moved = false
        let duplicated = false
        // .dragging lifts the moving frame above other frames and its carried
        // text above the frame (see CSS). emit() re-renders the DOM, so this
        // is re-applied after the mid-drag duplicate, not just at the start.
        const markDragging = (on: boolean) =>
            starts.forEach((s) => {
                const node = canvas.querySelector<HTMLElement>('[data-id="' + s.it.id + '"]')
                if (node) node.classList.toggle("dragging", on)
            })
        markDragging(true)
        function mv(ev: PointerEvent) {
            const dx = (ev.clientX - startX) / view.z,
                dy = (ev.clientY - startY) / view.z
            if (!moved && (Math.abs(dx) * view.z > 2 || Math.abs(dy) * view.z > 2)) {
                moved = true
                pushHistory(preDrag)
            }
            // option (mac) / ctrl (windows) duplicates — works whether held at click time
            // or pressed at any point during the drag: a copy is left at the origin
            if (moved && !duplicated && (ev.altKey || ev.ctrlKey)) {
                duplicated = true
                // the copies stay where the drag began, so they keep the
                // membership from then — pointed at the copied frame when
                // their frame was duplicated along with them
                const copies = new Map<number, number>()
                starts
                    .filter((s) => isFrame(s.it))
                    .forEach((s) => copies.set(s.it.id, duplicateItem(s.it, s.x, s.y).id))
                starts
                    .filter((s) => isText(s.it))
                    .forEach((s) => {
                        const c = duplicateItem(s.it, s.x, s.y) as TextItem
                        c.parent = s.parent == null ? null : copies.get(s.parent) ?? s.parent
                    })
                emit()
                markDragging(true) // the re-render dropped the class
            }
            starts.forEach((s) => {
                s.it.x = Math.round(s.x + dx)
                s.it.y = Math.round(s.y + dy)
            })
            if (moved && freeTexts.length) {
                const under = frameAt(toWorld(ev.clientX, ev.clientY), draggedFrames)
                freeTexts.forEach((s) => (s.it.parent = under ? under.id : null))
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
            renderSelectionOverlay()
            updateProps() // X/Y readouts follow the drag in real time
        }
        function up() {
            markDragging(false)
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            if (moved) {
                // dragging a frame carries its contents along for the ride —
                // that's not a content edit, so don't let the position diff
                // below bump the frame's timestamp for text that just came along
                const draggedFrame = starts.some((s) => isFrame(s.it))
                if (draggedFrame) carryingFrameDrag = true
                emit()
                carryingFrameDrag = false
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
        const s = toWorld(e.clientX, e.clientY)
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
                name.textContent = "Frame " + (frameCount + 1) // the name it will get
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
            r = {
                x: Math.min(s.x, p.x),
                y: Math.min(s.y, p.y),
                w: Math.abs(p.x - s.x),
                h: Math.abs(p.y - s.y),
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
            adoptLooseText(f)
            selection.clear()
            selection.add(f.id)
            setTool("move")
            emit()
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    /* canvas: pan, frame tool, or marquee drag-select on empty space */
    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
        if (spaceDown || e.button === 1) {
            e.preventDefault()
            startPan(e)
            return
        }
        if (e.button !== 0) return
        if (tool === "frame") {
            startFrameDraw(e)
            return
        }
        const t = e.target as HTMLElement
        if (t !== canvas && t !== world && !t.classList.contains("frame")) return
        // clicking away from text being edited: drop the selection now, before
        // the blur commits the edit — otherwise the regular selection box (with
        // handles) flashes for the span between mousedown and mouseup
        if (editingEl && selection.size) selection.clear()
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
                const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
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
        if (settingsOpen) {
            if (e.key === "Escape") {
                e.preventDefault()
                closeSettings()
            }
            return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === ",") {
            e.preventDefault()
            openSettings()
            return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
            e.preventDefault()
            toggleSidebars()
            return
        }
        const a = document.activeElement as HTMLElement | null
        // an active text edit counts as typing even if focus is elsewhere
        const typing =
            !!editingEl ||
            (a &&
                (a.tagName === "INPUT" ||
                    a.tagName === "SELECT" ||
                    a.isContentEditable))
        if (e.code === "Space" && !typing) {
            if (!spaceDown) setSpaceDown(true)
            e.preventDefault()
            return
        }
        if (e.key === "Alt") {
            setAltDown(true)
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
            toggleTimes()
            return
        }
        if (e.shiftKey && (e.key === "H" || e.key === "h")) {
            e.preventDefault()
            toggleHeat()
            return
        }
        if (e.key === "v" || e.key === "V") {
            setTool("move")
            return
        }
        if (e.key === "f" || e.key === "F") {
            setTool("frame")
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
            if (tool !== "move") setTool("move")
            else if (selection.size) {
                selection.clear()
                emit()
            }
            return
        }
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (!selection.size) return
        e.preventDefault()
        pushHistory()
        // a frame takes the text inside it along
        const doomed = new Set(selection)
        items.filter(isFrame).forEach((f) => {
            if (!doomed.has(f.id)) return
            items.filter(isText).forEach((t) => {
                if (frameHolds(f, t)) doomed.add(t.id)
            })
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
        if (e.key === "Alt") setAltDown(false)
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
    const CANVAS_DEFAULT = "#ededed"
    let bg = { hex: CANVAS_DEFAULT, alpha: 100 }
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
        dark: { name: "#1c1c1c", time: "#5a5a5a", grid: "rgba(0,0,0,.11)" },
        pale: { name: "#f4f4f4", time: "#a8a8a8", grid: "rgba(255,255,255,.13)" },
    }
    /* One light/dark call for the whole canvas, decided from the background's
       overall luminance (via two opposite grays' contrast — hue-independent,
       so a light pastel background still reads as "light"). Both the label
       palette and the frame-name accent switch together on it. */
    function canvasIsDark(seen: [number, number, number]) {
        const timeContrast = (p: { time: string }) => contrastRatio(hexToRgb(p.time), seen)
        return timeContrast(LABEL_PALETTES.pale) > timeContrast(LABEL_PALETTES.dark)
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
        if (heat) {
            // thermal view: near-black purple ground, light labels
            canvas.style.backgroundColor = HEAT_BG
            canvas.style.setProperty("--fname", "#efe4ff")
            canvas.style.setProperty("--ftime", "#b9a6d9")
            canvas.style.setProperty("--grid", "rgba(255,255,255,.08)")
            canvas.style.setProperty("--accent", accentColor(hexToRgb(HEAT_BG)))
            applyGrid()
            return
        }
        canvas.style.backgroundColor = rgbaCss(bg.hex, bg.alpha)
        const seen = compositeOver(hexToRgb(bg.hex), bg.alpha, surfaceRgb())
        const p = labelPalette(seen)
        canvas.style.setProperty("--fname", p.name)
        canvas.style.setProperty("--ftime", p.time)
        canvas.style.setProperty("--grid", p.grid)
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
            hooks.onFillOpen(fillRow.getBoundingClientRect(), { ...bg }, mode)
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
            if (bg.hex === hex && bg.alpha === alpha) return
            bg = { hex, alpha }
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
        frames.forEach((f) =>
            items.forEach((it) => {
                if (frameHolds(f, it)) inside.add(it.id)
            })
        )
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
            .forEach((f) =>
                items.filter(isText).forEach((t) => {
                    if (frameHolds(f, t)) moving.set(t.id, t)
                })
            )
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
        if (Array.from(moving.values()).some(isFrame)) carryingFrameDrag = true
        emit()
        carryingFrameDrag = false
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
            hoverWash = color ? { id, color } : null
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

    function buildPanel() {
        const fontDD = makeSelect(
            ["Inter", "PP Mondwest", "PP NeueBit", "Helvetica Neue", "Georgia"],
            (font) => {
                const sel = selectedTextItems()
                if (!sel.length || sel.every((it) => it.font === font)) return
                pushHistory()
                sel.forEach((it) => (it.font = font))
                emit()
            }
        )
        const fontSel = fontDD.querySelector<HTMLSelectElement>("select")
        const mixedOpt = document.createElement("option")
        mixedOpt.value = "__mixed"
        mixedOpt.textContent = "Mixed"
        mixedOpt.disabled = true
        mixedOpt.hidden = true
        fontSel.appendChild(mixedOpt)
        function updateFontDD() {
            const sel = selectedTextItems()
            fontSel.disabled = !sel.length
            if (!sel.length) return
            const same = sel.every((it) => it.font === sel[0].font)
            fontSel.value = same ? sel[0].font : "__mixed"
        }

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
        weightDD.classList.add("grow")
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

        panelGroup.append(fontDD, row, drawer, spacingRow)
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

    /* ================= preferences, theme, settings ================= */
    type Theme = "light" | "dark" | "system"
    const PREFS_KEY = "canvas.prefs.v1"
    // sidebar widths: each drags between its default and a cap
    const LEFT_W = { min: 200, max: 450 },
        RIGHT_W = { min: 230, max: 350 }
    const prefs: {
        theme: Theme
        name: string
        grid: boolean
        leftPanel: boolean
        rightPanel: boolean
        leftWidth: number
        rightWidth: number
    } = {
        theme: "system",
        name: "",
        grid: true,
        leftPanel: true,
        rightPanel: true,
        leftWidth: LEFT_W.min,
        rightWidth: RIGHT_W.min,
    }
    const clampW = (v: number, r: { min: number; max: number }) => Math.round(Math.max(r.min, Math.min(r.max, v)))
    try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (raw) {
            const p = JSON.parse(raw)
            if (p.theme === "light" || p.theme === "dark" || p.theme === "system") prefs.theme = p.theme
            if (typeof p.name === "string") prefs.name = p.name.slice(0, 40)
            if (typeof p.grid === "boolean") prefs.grid = p.grid
            if (typeof p.leftPanel === "boolean") prefs.leftPanel = p.leftPanel
            if (typeof p.rightPanel === "boolean") prefs.rightPanel = p.rightPanel
            if (typeof p.leftWidth === "number") prefs.leftWidth = clampW(p.leftWidth, LEFT_W)
            if (typeof p.rightWidth === "number") prefs.rightWidth = clampW(p.rightWidth, RIGHT_W)
        }
    } catch (_) {
        /* defaults */
    }
    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
        } catch (_) {
            /* ignore */
        }
    }
    const systemDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null
    function isDark() {
        return prefs.theme === "dark" || (prefs.theme === "system" && !!systemDark?.matches)
    }
    /* Theme drives the UI tokens on :root only. The canvas (background,
       frame labels, selection blue) is left alone — those already adapt to
       the canvas background color, whatever the theme. */
    function applyTheme() {
        document.documentElement.classList.toggle("dark", isDark())
        root.querySelectorAll<HTMLElement>("#prefTheme button").forEach((b) =>
            b.classList.toggle("active", b.dataset.theme === prefs.theme)
        )
    }
    const onSystemTheme = () => {
        if (prefs.theme === "system") applyTheme()
    }
    systemDark?.addEventListener("change", onSystemTheme)
    function setTheme(t: Theme) {
        if (t === prefs.theme) return
        prefs.theme = t
        savePrefs()
        applyTheme()
    }

    // profile picture: initials of the display name, or a silhouette
    const userIcon = (px: number) =>
        `<svg width="${px}" height="${px}" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5.2" r="3"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0z"/></svg>`
    function initials(name: string) {
        const parts = name.trim().split(/\s+/).filter(Boolean)
        if (!parts.length) return ""
        const a = parts[0][0] ?? ""
        const b = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : ""
        return (a + b).toUpperCase()
    }
    function renderAvatar() {
        const ini = initials(prefs.name)
        root.querySelectorAll<HTMLElement>(".avatar").forEach((el) => {
            if (ini) el.textContent = ini
            else el.innerHTML = userIcon(el.classList.contains("lg") ? 28 : 16)
        })
    }

    const settingsEl = root.querySelector<HTMLElement>("#settings")
    let settingsOpen = false
    let settingsSec = "account"
    function showSettingsSection(sec: string) {
        settingsSec = sec
        root.querySelectorAll<HTMLElement>(".snav").forEach((b) => b.classList.toggle("active", b.dataset.sec === sec))
        root.querySelectorAll<HTMLElement>(".ssec").forEach((s) => s.classList.toggle("active", s.dataset.sec === sec))
    }
    function openSettings() {
        if (!settingsEl || settingsOpen) return
        settingsOpen = true
        settingsEl.classList.add("open")
        showSettingsSection(settingsSec)
        ;(root.querySelector<HTMLElement>(".snav.active") ?? settingsEl).focus?.()
    }
    function closeSettings() {
        if (!settingsEl || !settingsOpen) return
        settingsOpen = false
        settingsEl.classList.remove("open")
        root.querySelector<HTMLElement>("#avatarBtn")?.focus()
    }
    root.querySelector<HTMLElement>("#avatarBtn")?.addEventListener("click", openSettings)
    root.querySelector<HTMLElement>("#settingsClose")?.addEventListener("click", closeSettings)
    settingsEl?.addEventListener("pointerdown", (e) => {
        if (e.target === settingsEl) closeSettings() // the backdrop
    })
    root.querySelectorAll<HTMLElement>(".snav").forEach((b) =>
        b.addEventListener("click", () => showSettingsSection(b.dataset.sec))
    )
    const nameInput = root.querySelector<HTMLInputElement>("#prefName")
    if (nameInput) {
        nameInput.value = prefs.name
        nameInput.addEventListener("input", () => {
            prefs.name = nameInput.value.slice(0, 40)
            savePrefs()
            renderAvatar()
        })
        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameInput.blur()
        })
    }
    root.querySelectorAll<HTMLElement>("#prefTheme button").forEach((b) =>
        b.addEventListener("click", () => setTheme(b.dataset.theme as Theme))
    )
    root.querySelector<HTMLInputElement>("#prefTimes")?.addEventListener("change", (e) =>
        setShowTimes((e.target as HTMLInputElement).checked, false)
    )
    const gridSwitch = root.querySelector<HTMLInputElement>("#prefGrid")
    if (gridSwitch) {
        gridSwitch.checked = prefs.grid
        gridSwitch.addEventListener("change", () => {
            prefs.grid = gridSwitch.checked
            savePrefs()
            applyGrid()
        })
    }
    root.querySelector<HTMLElement>("#prefResetBg")?.addEventListener("click", () => {
        bg = { hex: CANVAS_DEFAULT, alpha: 100 }
        applyBg()
        updateFill()
        scheduleSave()
    })
    root.querySelector<HTMLElement>("#prefResetView")?.addEventListener("click", resetView)

    /* ---- sidebars: each hides from its own header button and comes back
       from a floating button at that edge of the canvas; ⌘\ toggles both ---- */
    // widths go on the mount's parent so the host's color picker (a sibling
    // of the engine root, anchored to the right sidebar) can read them too
    const varHost = root.parentElement ?? root
    function applyPanels() {
        app.classList.toggle("left-hidden", !prefs.leftPanel)
        app.classList.toggle("right-hidden", !prefs.rightPanel)
        varHost.style.setProperty("--left-w", prefs.leftWidth + "px")
        varHost.style.setProperty("--right-w", prefs.rightWidth + "px")
        // the canvas just changed size; its ResizeObserver redraws the chrome
    }
    /* drag a sidebar's inner edge to resize it; the width persists with prefs */
    function wireResizer(el: HTMLElement | null, side: "leftWidth" | "rightWidth") {
        if (!el) return
        el.addEventListener("pointerdown", (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            const startX = e.clientX
            const startW = prefs[side]
            const range = side === "leftWidth" ? LEFT_W : RIGHT_W
            el.classList.add("active")
            app.classList.add("resizing")
            const mv = (ev: PointerEvent) => {
                // the left sidebar grows as the pointer moves right; the right one as it moves left
                const dx = side === "leftWidth" ? ev.clientX - startX : startX - ev.clientX
                const w = clampW(startW + dx, range)
                if (w !== prefs[side]) {
                    prefs[side] = w
                    applyPanels()
                }
            }
            const up = () => {
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", up)
                el.classList.remove("active")
                app.classList.remove("resizing")
                savePrefs()
            }
            document.addEventListener("pointermove", mv)
            document.addEventListener("pointerup", up)
        })
    }
    wireResizer(root.querySelector<HTMLElement>("#resizeLeft"), "leftWidth")
    wireResizer(root.querySelector<HTMLElement>("#resizeRight"), "rightWidth")
    function setPanel(side: "leftPanel" | "rightPanel", on: boolean) {
        if (prefs[side] === on) return
        prefs[side] = on
        savePrefs()
        applyPanels()
    }
    function toggleSidebars() {
        const anyOn = prefs.leftPanel || prefs.rightPanel
        prefs.leftPanel = prefs.rightPanel = !anyOn
        savePrefs()
        applyPanels()
    }
    root.querySelector<HTMLElement>("#hideLeft")?.addEventListener("click", () => setPanel("leftPanel", false))
    root.querySelector<HTMLElement>("#showLeft")?.addEventListener("click", () => setPanel("leftPanel", true))
    root.querySelector<HTMLElement>("#hideRight")?.addEventListener("click", () => setPanel("rightPanel", false))
    root.querySelector<HTMLElement>("#showRight")?.addEventListener("click", () => setPanel("rightPanel", true))
    applyPanels()

    /* ================= wire up ================= */
    subscribe(renderCanvas)

    let lastSelSig = ""
    subscribe(() => {
        updateProps()
        updateAlignButtons()
        updateFill()
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
        seedDemoText()
        renderCanvas()
        centerDefaultItems() // needs real measurements from the render above
        seedDemoFrame()
    }
    applyView()
    applyTheme()
    applyBg()
    renderAvatar()
    restoring = true
    touchParentFrames() // prime lastText without bumping anything
    restoring = false
    renderCanvas() // re-render with the centered positions
    buildPanel()
    updateProps()
    updateAlignButtons()
    updateFill()
    updateVariantButtons()

    const destroy = () => {
        docListeners.forEach(([t, f]) => document.removeEventListener(t, f))
        window.removeEventListener("blur", onWindowBlur)
        clearInterval(timesTimer)
        clearInterval(heatTimer)
        clearTimeout(heatTransTimer)
        clearTimeout(toastTimer)
        clearTimeout(nudgeTimer)
        clearTimeout(saveTimer)
        window.removeEventListener("pagehide", onPageHide)
        canvasRO?.disconnect()
        systemDark?.removeEventListener("change", onSystemTheme)
        document.documentElement.classList.remove("dark")
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
        destroy,
    }
}
