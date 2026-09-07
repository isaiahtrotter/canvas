// The screen-space selection chrome in #overlay: text underlines (hover,
// multi-select, marquee touch), nested-frame hover outlines, the selection
// box with its resize handles and size badge, and the smart-guide lines.
// Everything here is rebuilt from scratch on each call — it is cheap, and
// unlike #world nothing in it carries a transition or an edit in progress.
import type { EditorContext, Disposable } from "../core/context"
import { DEFAULT_LINE_HEIGHT, isFrame, isText } from "../core/types"
import type { SnapGuide } from "./snap"

export interface OverlayAPI {
    renderUnderlines(): void
    /** Frame labels, underlines, then the selection box (or the editing box). */
    renderSelectionOverlay(): void
    renderSnapGuides(guides: SnapGuide[]): void
}

export function installOverlay(ctx: EditorContext): OverlayAPI & Disposable {
    const { canvas, overlay } = ctx.dom
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const view = ctx.doc.view
    const containingFrame = (it) => ctx.store.containingFrame(it)

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
        const hoveredItem = lastHover && lastHover.isConnected ? ctx.store.itemById(Number(lastHover.dataset.id)) ?? null : null
        const hoverTarget = hoveredItem ? ctx.drill.selectTargetFor(hoveredItem) : null
        items.filter(isText).forEach((it) => {
            const node = ctx.nodeFor(it.id)
            if (!node || node === ctx.ui.editingEl) return
            if (!(node.classList.contains("sel-underline") || hoverTarget === it)) return
            let { w, h } = ctx.geo.nodeSize(it)
            if (!w) return
            const f = containingFrame(it)
            if (f) w = Math.max(0, Math.min(w, f.x + f.w - it.x)) // the clipped part has no underline
            const naturalH = it.size * DEFAULT_LINE_HEIGHT
            const y = it.y + (h + naturalH) / 2 - it.size * 0.22
            const a = ctx.geo.toScreen(it.x, y)
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
            ctx.geo.placeScreenRect(box, ctx.geo.itemBounds(hoverTarget))
            overlay.appendChild(box)
            // and a dotted box around each thing directly inside it, so you can
            // see what you'd be getting into before you double-click
            const f = hoverTarget
            const fb = ctx.geo.itemBounds(f)
            items
                .filter((it) => (isText(it) ? it.parent === f.id : it.id !== f.id && containingFrame(it)?.id === f.id))
                .forEach((it) => {
                    // clipped to the frame, like the content itself is, so every
                    // dotted box sits inside the frame's own outline
                    const b = ctx.geo.itemBounds(it)
                    const x1 = Math.max(b.x, fb.x),
                        y1 = Math.max(b.y, fb.y)
                    const x2 = Math.min(b.x + b.w, fb.x + fb.w),
                        y2 = Math.min(b.y + b.h, fb.y + fb.h)
                    if (x2 <= x1 || y2 <= y1) return
                    const dot = document.createElement("div")
                    dot.className = "childitem-hover"
                    ctx.geo.placeScreenRect(dot, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
                    overlay.appendChild(dot)
                })
        }
    }
    function renderSnapGuides(guides: SnapGuide[]) {
        overlay.querySelectorAll<HTMLElement>(".snapline").forEach((n) => n.remove())
        guides.forEach((g) => {
            const el = document.createElement("div")
            el.className = "snapline"
            if (g.axis === "x") {
                const a = ctx.geo.toScreen(g.at, g.from),
                    b = ctx.geo.toScreen(g.at, g.to)
                el.style.left = Math.round(a.x) + "px"
                el.style.top = Math.round(a.y) + "px"
                el.style.width = "1px"
                el.style.height = Math.round(b.y) - Math.round(a.y) + "px"
            } else {
                const a = ctx.geo.toScreen(g.from, g.at),
                    b = ctx.geo.toScreen(g.to, g.at)
                el.style.left = Math.round(a.x) + "px"
                el.style.top = Math.round(a.y) + "px"
                el.style.width = Math.round(b.x) - Math.round(a.x) + "px"
                el.style.height = "1px"
            }
            overlay.appendChild(el)
        })
    }

    function renderSelectionOverlay() {
        canvas.querySelectorAll<HTMLElement>(".selbox").forEach((n) => n.remove())
        ctx.canvas.renderFrameLabels()
        renderUnderlines()
        if (ctx.ui.editingEl) {
            // while typing: the same 1px box, sized to the live text, no handles
            const it = items.find((i) => i.id === Number(ctx.ui.editingEl.dataset.id))
            if (!it) return
            const box = document.createElement("div")
            box.className = "selbox editing"
            ctx.geo.placeScreenRect(box, ctx.geo.itemBounds(it))
            overlay.appendChild(box)
            return
        }
        const b = ctx.geo.selectionBounds() // one combined box around everything selected
        // while a frame is being dragged inside another frame, its selection box is
        // hidden so the drop reads cleanly; it comes back on release (see the drag)
        if (!b || ctx.ui.hideSelBoxWhileNesting) return
        const box = document.createElement("div")
        box.className = "selbox"
        ctx.geo.placeScreenRect(box, b)
        const frame = ctx.store.singleSelectedFrame() // a lone frame gets live resize handles
        ;["tl", "tr", "bl", "br"].forEach((c) => {
            const h = document.createElement("div")
            h.className = "selhandle " + c
            if (frame) {
                h.classList.add("resizable")
                h.addEventListener("pointerdown", (e) => ctx.gestures.startResize(e, frame, c))
            }
            box.appendChild(h)
        })
        if (frame) {
            // edge handles: drag any side to resize from that side alone
            ;["t", "r", "b", "l"].forEach((edge) => {
                const h = document.createElement("div")
                h.className = "seledge " + edge
                h.addEventListener("pointerdown", (e) => ctx.gestures.startResize(e, frame, edge))
                box.appendChild(h)
            })
        }
        const size = document.createElement("div")
        size.className = "selsize"
        size.textContent = Math.round(b.w) + " × " + Math.round(b.h)
        box.appendChild(size)
        overlay.appendChild(box)
    }

    return { renderUnderlines, renderSelectionOverlay, renderSnapGuides }
}
