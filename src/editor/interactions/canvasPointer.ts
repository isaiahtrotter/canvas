// Pointer-down on the canvas itself (not on an item): pan, draw a frame,
// place a text, or marquee-select on empty space.
import type { EditorContext, Disposable, Rect } from "../core/context"
import { isFrame } from "../core/types"
import { relTime } from "../time"

export interface CanvasPointerAPI {
    /** frame tool: drag to draw; a plain click drops a default-sized frame */
    startFrameDraw(e: PointerEvent): void
}

export function installCanvasPointer(ctx: EditorContext): CanvasPointerAPI & Disposable {
    const { canvas, world, overlay } = ctx.dom
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const view = ctx.doc.view
    const { emit } = ctx.bus

    /* frame tool: drag to draw; a plain click drops a default-sized frame.
       While drawing, the draft looks like the frame it's about to become:
       its name and timestamp above it, and the selection box with the live
       size badge around it. */
    function startFrameDraw(e: PointerEvent) {
        // frames live on integer coordinates, so the draft snaps to the grid as
        // it's drawn: the anchor and every edge round to whole units, and the
        // final frame is exactly what the preview showed
        const s0 = ctx.geo.toWorld(e.clientX, e.clientY)
        const s = { x: Math.round(s0.x), y: Math.round(s0.y) }
        let draft: HTMLDivElement | null = null
        let draftBox: HTMLDivElement | null = null
        let draftSize: HTMLDivElement | null = null
        let draftLabel: HTMLDivElement | null = null
        let r: Rect | null = null
        function mv(ev: PointerEvent) {
            const p = ctx.geo.toWorld(ev.clientX, ev.clientY)
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
                ctx.canvas.labelLayer.appendChild(draftLabel)
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
                ctx.geo.placeScreenRect(draftBox, r)
                if (draftSize) draftSize.textContent = Math.round(r.w) + " × " + Math.round(r.h)
            }
            if (draftLabel) ctx.canvas.placeLabel(draftLabel, r.x, r.y, r.w)
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            if (draft) draft.remove()
            if (draftBox) draftBox.remove()
            if (draftLabel) draftLabel.remove()
            const box =
                r && r.w >= 8 && r.h >= 8 ? r : { x: s.x, y: s.y, w: 200, h: 150 }
            ctx.store.pushHistory()
            const f = ctx.store.addFrame({
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.w),
                h: Math.round(box.h),
            })
            const enclosing = ctx.geo.frameEnclosing(f, f.id)
            f.parent = enclosing ? enclosing.id : null
            ctx.store.adoptLooseText(f)
            selection.clear()
            selection.add(f.id)
            ctx.tools.setTool("move")
            emit()
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    /* canvas: pan, frame tool, or marquee drag-select on empty space */
    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
        if (ctx.ui.spaceDown || e.button === 1) {
            e.preventDefault()
            ctx.view.startPan(e)
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
            ctx.gestures.placeTextAt(e)
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
        const s = ctx.geo.toWorld(e.clientX, e.clientY)
        let marquee: HTMLDivElement | null = null,
            marqueeRect: Rect | null = null,
            moved = false

        function hits(r) {
            const out = new Set<number>()
            items.forEach((it) => {
                const { w: iw, h: ih } = ctx.geo.nodeSize(it)
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
            const p = ctx.geo.toWorld(cx, cy)
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
            ctx.geo.placeScreenRect(marquee, marqueeRect)
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
                    ctx.geo.placeScreenRect(b, it)
                    overlay.appendChild(b)
                    return
                }
                const node = ctx.nodeFor(it.id)
                if (node) node.classList.toggle("sel-underline", touched.has(it.id))
            })
            ctx.overlay.renderUnderlines()
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

    return { startFrameDraw }
}
