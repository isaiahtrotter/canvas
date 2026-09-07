// Gestures on a single item: resizing a frame by its handles, editing a
// text inline, renaming a frame by its label, and placing a new text with
// the text tool.
import type { EditorContext, Disposable } from "../core/context"
import type { FrameItem, TextItem } from "../core/types"

export interface GesturesAPI {
    /** drag a selection-box corner ("tl".."br") or edge ("t","r","b","l") to resize a lone frame */
    startResize(e: PointerEvent, it: FrameItem, corner: string): void
    startEditing(el: HTMLElement, it: TextItem): void
    /** double-click a frame's name to rename it inline */
    startRenaming(nameEl: HTMLElement, it: FrameItem): void
    /** text tool: drop a new text where the pointer is and start editing it */
    placeTextAt(e: PointerEvent): void
}

export function installItemGestures(ctx: EditorContext): GesturesAPI & Disposable {
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    function startResize(e: PointerEvent, it: FrameItem, corner: string) {
        e.stopPropagation()
        const start = ctx.geo.toWorld(e.clientX, e.clientY)
        const o = { x: it.x, y: it.y, w: it.w, h: it.h }
        const pre = ctx.store.snapshot()
        let moved = false
        const MIN_SIZE = 1
        // corners ("tl", "br", ...) touch both axes; an edge handle ("t",
        // "r", ...) is a single letter and only ever touches its own axis —
        // dragging the left/right edge must not also change height, and
        // top/bottom must not also change width.
        const affectsX = corner.includes("l") || corner.includes("r")
        const affectsY = corner.includes("t") || corner.includes("b")
        function mv(ev: PointerEvent) {
            const p = ctx.geo.toWorld(ev.clientX, ev.clientY)
            const dx = p.x - start.x,
                dy = p.y - start.y
            if (!moved) {
                moved = true
                ctx.store.pushHistory(pre)
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
            ctx.layout.applyClips()
            ctx.overlay.renderSelectionOverlay()
            ctx.panel.updateProps()
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
        ctx.overlay.renderSelectionOverlay()
        const preEdit = ctx.store.snapshot()
        el.setAttribute("contenteditable", "true")
        el.focus()
        selectAllText(el)
        const onInput = () => {
            ctx.canvas.relayoutLive() // a hugging frame grows and shrinks with the text as you type
            ctx.overlay.renderSelectionOverlay()
        }
        el.addEventListener("input", onInput)
        function done() {
            el.removeEventListener("input", onInput)
            el.removeAttribute("contenteditable")
            const newText = el.textContent.trim() || "Text"
            if (newText !== it.text) ctx.store.pushHistory(preEdit)
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
        const pre = ctx.store.snapshot()
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
                ctx.store.pushHistory(pre)
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

    // text tool: a click drops a new text at the pointer (parented to the
    // frame it lands in) and starts editing it right away, like double-click
    function placeTextAt(e: PointerEvent) {
        const p = ctx.geo.toWorld(e.clientX, e.clientY)
        const parent = ctx.geo.frameAt(p)
        ctx.store.pushHistory()
        const it = ctx.store.addItem({ x: Math.round(p.x), y: Math.round(p.y), parent: parent ? parent.id : null })
        selection.clear()
        selection.add(it.id)
        ctx.tools.setTool("move")
        emit()
        const el = ctx.nodeFor(it.id)
        if (el) startEditing(el, it)
    }

    return { startResize, startEditing, startRenaming, placeTextAt }
}
