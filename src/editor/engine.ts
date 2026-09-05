// Vanilla-DOM editor engine, ported from reference/multiple_text_editor.jsx.
// mountEditor(root) renders the markup into `root`, wires every interaction,
// and returns a cleanup that tears the whole thing down.
import { MARKUP } from "./markup"
import { absTime, relTime } from "./time"
import { isHex, rgbaCss } from "./color"

interface TextItem {
    kind: "text"
    id: number
    x: number
    y: number
    text: string
    size: number
    font: string
    weight: number
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

    const MIN = 8,
        MAX = 48,
        STEP = 4,
        INSET = 12
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
    }

    /* A frame's "edited" time also moves when anything inside it changes.
       Rather than sprinkling bumps through every mutation path, each emit
       diffs text layers against the last emit: a text that changed (moved,
       retyped, restyled, or newly added) bumps the frame that contains it now
       and, if it moved, the one it came from. Undo/redo set `restoring` so a
       restored snapshot keeps the timestamps it was saved with. */
    let restoring = false
    let carryingFrameDrag = false // true only while a frame-drag's own emit() is diffing
    const lastText = new Map<number, { sig: string; x: number; y: number }>()
    function textSig(it: TextItem) {
        return [it.x, it.y, it.text, it.size, it.font, it.weight, it.fill, it.alpha].join("|")
    }
    function touchParentFrames() {
        const now = Date.now()
        const seen = new Set<number>()
        items.filter(isText).forEach((t) => {
            seen.add(t.id)
            const sig = textSig(t)
            const prev = lastText.get(t.id)
            if (!prev || prev.sig !== sig) {
                if (!restoring && !carryingFrameDrag) {
                    const bump = (f: FrameItem | null) => {
                        if (f) f.updatedAt = now
                    }
                    bump(containingFrame(t))
                    if (prev && (prev.x !== t.x || prev.y !== t.y))
                        bump(containingFrame({ ...t, x: prev.x, y: prev.y }))
                }
                lastText.set(t.id, { sig, x: t.x, y: t.y })
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
            },
            props
        )
        items.push(it)
        return it
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

    addItem({
        x: 60,
        y: 70,
        text: "select multiple",
        size: 32,
        weight: 400,
    })
    addItem({ x: 60, y: 130, text: "lines of text", size: 20, weight: 400 })
    addItem({
        x: 60,
        y: 180,
        text: "and use the drop down",
        size: 16,
        weight: 400,
    })
    addItem({ x: 60, y: 220, text: "to edit them", size: 14, weight: 400 })

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
    let editingEl = null
    let hoverWash = null // {id, color} — set while a slider handle is hovered/dragged

    /* ---- view: pan + zoom. Items live in world coords; #world carries
       translate(x,y) scale(z). --inv is 1/z so chrome that should stay a
       constant size on screen (frame labels, handles) can counter-scale. ---- */
    const ZOOM_MIN = 0.1,
        ZOOM_MAX = 4
    const view = { x: 0, y: 0, z: 1 }
    const zoomVal = root.querySelector<HTMLElement>("#zoomVal")
    function applyView() {
        world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`
        world.style.setProperty("--inv", String(1 / view.z))
        if (zoomVal) zoomVal.textContent = Math.round(view.z * 100) + "%"
        updateMinimap()
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
              })
            : null
    canvasRO?.observe(canvas)
    const MM_W = 140,
        MM_H = 90,
        MM_PAD = 4
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
    function setAltDown(v: boolean) {
        if (altDown === v) return
        altDown = v
        if (!v) clearMeasure()
    }
    function clearMeasure() {
        measureBox?.remove()
        measureBox = null
    }
    function itemBounds(it: Item) {
        const { w, h } = nodeSize(it)
        return { x: it.x, y: it.y, w, h }
    }
    function addMeasureLine(
        container: HTMLElement,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        dist: number
    ) {
        const horizontal = y1 === y2
        const line = document.createElement("div")
        line.className = "measure-line"
        if (horizontal) {
            line.style.left = Math.min(x1, x2) + "px"
            line.style.top = y1 + "px"
            line.style.width = Math.abs(x2 - x1) + "px"
            line.style.height = "calc(1px * var(--inv))"
        } else {
            line.style.left = x1 + "px"
            line.style.top = Math.min(y1, y2) + "px"
            line.style.width = "calc(1px * var(--inv))"
            line.style.height = Math.abs(y2 - y1) + "px"
        }
        container.appendChild(line)
        const label = document.createElement("div")
        label.className = "measure-label"
        label.textContent = Math.round(Math.abs(dist)) + "px"
        label.style.left = (x1 + x2) / 2 + "px"
        label.style.top = (y1 + y2) / 2 + "px"
        container.appendChild(label)
    }
    // Guides run from the middle of the selection's facing side straight to
    // the hovered target — purely a function of the two boxes' positions, so
    // they hold still as the mouse moves around inside the hovered target
    // instead of tracking the cursor.
    function measureTo(container: HTMLElement, sel, target) {
        const selCx = sel.x + sel.w / 2,
            selCy = sel.y + sel.h / 2
        const overlapX = Math.max(sel.x, target.x) < Math.min(sel.x + sel.w, target.x + target.w)
        const overlapY = Math.max(sel.y, target.y) < Math.min(sel.y + sel.h, target.y + target.h)
        if (!overlapY) {
            // target sits above or below: vertical line from the selection's
            // top/bottom-center to the target's facing edge
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
        if (overlapX && overlapY) {
            // the target surrounds (or straddles) the selection, e.g. hovering
            // its containing frame: measure to whichever pair of its edges —
            // one vertical, one horizontal — sit nearest the selection's center
            const edgeV = selCx - target.x <= target.x + target.w - selCx ? "l" : "r"
            const tx = edgeV === "l" ? target.x : target.x + target.w
            addMeasureLine(container, tx, selCy, selCx, selCy, selCx - tx)
            const edgeH = selCy - target.y <= target.y + target.h - selCy ? "t" : "b"
            const ty = edgeH === "t" ? target.y : target.y + target.h
            addMeasureLine(container, selCx, ty, selCx, selCy, selCy - ty)
        }
    }
    function updateMeasure(hovered: Item | null | undefined) {
        clearMeasure()
        if (!altDown || !hovered || selection.has(hovered.id)) return
        const sel = selectionBounds()
        if (!sel) return
        measureBox = document.createElement("div")
        measureBox.className = "measure"
        measureTo(measureBox, sel, itemBounds(hovered))
        world.appendChild(measureBox)
    }
    canvas.addEventListener("pointermove", (e: PointerEvent) => {
        // e.buttons !== 0 means some other gesture (drag, resize, pan...) owns
        // this move — Alt already means "duplicate" mid-drag, so stay out of the way
        if (!altDown || e.buttons !== 0) {
            if (measureBox) clearMeasure()
            return
        }
        const t = (e.target as HTMLElement).closest<HTMLElement>(".titem, .frame")
        const hovered = t ? items.find((it) => it.id === Number(t.dataset.id)) : null
        updateMeasure(hovered)
    })
    canvas.addEventListener("pointerleave", () => clearMeasure())

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
    }
    function toggleTimes() {
        showTimes = !showTimes
        try {
            localStorage.setItem(TIMES_KEY, showTimes ? "1" : "0")
        } catch (_) {
            /* ignore */
        }
        applyShowTimes()
        showToast(showTimes ? "Timestamps shown" : "Timestamps hidden")
    }
    applyShowTimes()
    function refreshTimes() {
        canvas.querySelectorAll<HTMLElement>(".ftime").forEach((t) => {
            t.textContent = relTime(Number(t.dataset.t))
        })
    }
    const timesTimer = setInterval(refreshTimes, 30000)

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

    function renderCanvas() {
        world.innerHTML = ""
        const multi = selection.size > 1
        // frames sit under text
        const ordered = [...items.filter(isFrame), ...items.filter(isText)]
        ordered.forEach((it) => {
            if (isFrame(it)) {
                world.appendChild(renderFrame(it))
                return
            }
            const el = document.createElement("div")
            el.className =
                "titem" +
                (multi && selection.has(it.id) ? " sel-underline" : "")
            el.style.left = it.x + "px"
            el.style.top = it.y + "px"
            el.style.fontSize = it.size + "px"
            el.style.fontFamily = it.font
            el.style.fontWeight = String(it.weight)
            el.style.opacity = String((it.opacity != null ? it.opacity : 100) / 100)
            el.style.color = rgbaCss(it.fill, it.alpha)
            el.textContent = it.text
            el.dataset.id = String(it.id)
            el.addEventListener("pointerdown", (e) =>
                onItemPointerDown(e, it, el)
            )
            el.addEventListener("dblclick", (e) => {
                e.stopPropagation()
                startEditing(el, it)
            })
            world.appendChild(el)
        })
        applyWash()
        renderSelectionOverlay()
        updateMinimap()
    }

    function renderFrame(it: FrameItem) {
        const el = document.createElement("div")
        el.className = "frame" + (selection.has(it.id) ? " selected" : "")
        el.style.left = it.x + "px"
        el.style.top = it.y + "px"
        el.style.width = it.w + "px"
        el.style.height = it.h + "px"
        el.style.background = rgbaCss(it.fill, it.alpha)
        el.dataset.id = String(it.id)

        const label = document.createElement("div")
        label.className = "flabel"
        const name = document.createElement("span")
        name.className = "fname"
        name.textContent = it.name
        const time = document.createElement("span")
        time.className = "ftime"
        time.dataset.t = String(it.updatedAt)
        time.textContent = relTime(it.updatedAt)
        time.title = absTime(it.updatedAt)
        label.append(name, time)
        el.appendChild(label)

        // a frame is grabbed by its title only; its body behaves like empty canvas
        label.addEventListener("pointerdown", (e) => onItemPointerDown(e, it, el))
        name.addEventListener("dblclick", (e) => {
            e.stopPropagation()
            startRenaming(name, it)
        })
        return el
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
            it.x = canvasW / 2 - rects[i].w / 2 // center each line horizontally
            it.y = it.y + shiftY // recenter the whole stack vertically
        })
    }

    // Wrap the demo text in a frame so frames + timestamps are visible on load.
    function seedDemoFrame() {
        const b = boundsOf(items.filter(isText))
        if (!b) return
        const PAD = 48
        addFrame({
            x: Math.round(b.x - PAD),
            y: Math.round(b.y - PAD),
            w: Math.round(b.w + PAD * 2),
            h: Math.round(b.h + PAD * 2),
        })
    }

    /* Rendered size of an item, in world units. Frames know their size;
       text is measured off its node (unscaled layout size inside #world). */
    function nodeSize(it: Item) {
        if (isFrame(it)) return { w: it.w, h: it.h }
        const node = canvas.querySelector<HTMLElement>('[data-id="' + it.id + '"]')
        return node ? { w: node.offsetWidth, h: node.offsetHeight } : { w: 0, h: 0 }
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
    // smallest frame fully containing the item, if any
    function containingFrame(it: Item): FrameItem | null {
        let best: FrameItem | null = null
        items.filter(isFrame).forEach((f) => {
            if (f.id === it.id || !rectContains(f, it)) return
            if (!best || f.w * f.h < best.w * best.h) best = f
        })
        return best
    }
    function singleSelectedFrame(): FrameItem | null {
        const sel = selectedItems()
        return sel.length === 1 && isFrame(sel[0]) ? sel[0] : null
    }

    function renderSelectionOverlay() {
        canvas.querySelectorAll<HTMLElement>(".selbox").forEach((n) => n.remove())
        if (editingEl) return
        const b = selectionBounds() // one combined box around everything selected
        if (!b) return
        const box = document.createElement("div")
        box.className = "selbox"
        box.style.left = b.x + "px"
        box.style.top = b.y + "px"
        box.style.width = b.w + "px"
        box.style.height = b.h + "px"
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
        world.appendChild(box)
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
        renderSelectionOverlay()
        const preEdit = snapshot()
        el.setAttribute("contenteditable", "true")
        el.focus()
        selectAllText(el)
        function done() {
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
        }))
        // a frame carries the text sitting inside it, selected or not
        const carried = new Set(starts.map((s) => s.it.id))
        selectedItems()
            .filter(isFrame)
            .forEach((f) => {
                items.filter(isText).forEach((t) => {
                    if (carried.has(t.id) || !rectContains(f, t)) return
                    carried.add(t.id)
                    starts.push({ it: t, x: t.x, y: t.y })
                })
            })
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
                starts.forEach((s) => duplicateItem(s.it, s.x, s.y))
                emit()
                markDragging(true) // the re-render dropped the class
            }
            starts.forEach((s) => {
                s.it.x = s.x + dx
                s.it.y = s.y + dy
            })
            items.forEach((i2) => {
                const node = canvas.querySelector<HTMLElement>(
                    '[data-id="' + i2.id + '"]'
                )
                if (node) {
                    node.style.left = i2.x + "px"
                    node.style.top = i2.y + "px"
                }
            })
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

    /* frame tool: drag to draw; a plain click drops a default-sized frame */
    function startFrameDraw(e: PointerEvent) {
        const s = toWorld(e.clientX, e.clientY)
        let draft: HTMLDivElement | null = null
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
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            if (draft) draft.remove()
            const box =
                r && r.w >= 8 && r.h >= 8 ? r : { x: s.x, y: s.y, w: 200, h: 150 }
            pushHistory()
            const f = addFrame({
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.w),
                h: Math.round(box.h),
            })
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
                world.appendChild(marquee)
            }
            if (!marquee) return
            const x = Math.min(s.x, p.x),
                y = Math.min(s.y, p.y)
            const w = Math.abs(p.x - s.x),
                h = Math.abs(p.y - s.y)
            marquee.style.left = x + "px"
            marquee.style.top = y + "px"
            marquee.style.width = w + "px"
            marquee.style.height = h + "px"
            marqueeRect = { x, y, w, h }
            // live highlight: any text the rectangle currently touches gets the blue underline
            const touched = hits(marqueeRect)
            items.forEach((it) => {
                const node = canvas.querySelector<HTMLElement>(
                    '[data-id="' + it.id + '"]'
                )
                if (node)
                    node.classList.toggle(
                        isFrame(it) ? "hover" : "sel-underline",
                        touched.has(it.id)
                    )
            })
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
        const a = document.activeElement as HTMLElement | null
        const typing =
            a &&
            (a.tagName === "INPUT" ||
                a.tagName === "SELECT" ||
                a.isContentEditable)
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
        if (typing || mod) return
        if (e.shiftKey && (e.key === "T" || e.key === "t")) {
            e.preventDefault()
            toggleTimes()
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
                if (rectContains(f, t)) doomed.add(t.id)
            })
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
                    merged && list.length > 1 ? "#111" : i.color
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
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="#1c1c1c">' +
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
    let bg = { hex: "#ededed", alpha: 100 }
    function applyBg() {
        canvas.style.backgroundColor = rgbaCss(bg.hex, bg.alpha)
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
        setAll(v) {
            v = Math.max(MIN, Math.min(MAX, Math.round(v)))
            if (selectedTextItems().every((it) => it.size === v)) return
            this._consumeOrPush()
            selectedTextItems().forEach((it) => (it.size = v))
            emit()
        },
        nudge(s) {
            this._consumeOrPush()
            selectedTextItems().forEach(
                (it) =>
                    (it.size = Math.max(MIN, Math.min(MAX, it.size + s)))
            )
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
        const weightDD = makeSelect([
            { label: "Light", value: 300 },
            { label: "Regular", value: 400 },
            { label: "Medium", value: 500 },
            { label: "Semibold", value: 600 },
            { label: "Bold", value: 700 },
        ])
        weightDD.classList.add("grow")
        weightDD.querySelector<HTMLSelectElement>("select").value = "400"
        weightDD.querySelector<HTMLSelectElement>("select").disabled = true

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
                adapter.nudge(e.key === "ArrowUp" ? 1 : -1)
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

        panelGroup.append(fontDD, row, drawer)
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

    renderCanvas()
    centerDefaultItems() // needs real measurements from the render above
    seedDemoFrame()
    applyView()
    applyBg()
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
        clearTimeout(toastTimer)
        canvasRO?.disconnect()
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
