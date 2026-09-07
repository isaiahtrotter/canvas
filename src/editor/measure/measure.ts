// Option/Alt measurement: hold the key and hover another layer to see the
// pixel gap to the current selection. Hovering a frame instead draws two
// guides — horizontal and vertical — to whichever of its edges are nearest
// the cursor, each labeled with the distance from the selection.
//
// Also owns canvas hover tracking (ctx.ui.lastHover), kept even without Alt
// so pressing the key with a still mouse can show the measurement right away.
import type { EditorContext, Disposable } from "../core/context"
import type { Item } from "../core/types"

export interface MeasureAPI {
    setAltDown(v: boolean): void
    refreshMeasure(force?: boolean): void
    clearMeasure(): void
}

export function installMeasure(ctx: EditorContext): MeasureAPI & Disposable {
    const { canvas, overlay } = ctx.dom
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const view = ctx.doc.view

    let altDown = false
    let measureBox: HTMLElement | null = null
    let measureSig = "" // what's currently drawn; skip the rebuild when nothing changed
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
        const a0 = ctx.geo.toScreen(x1, y1),
            b0 = ctx.geo.toScreen(x2, y2)
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
        label.textContent = String(Math.round(Math.abs(dist)))
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
    // the item under the pointer, if its node is still in the document
    function hoveredItem(): Item | null {
        const lastHover = ctx.ui.lastHover
        if (!lastHover || !lastHover.isConnected) return null
        return items.find((it) => it.id === Number(lastHover.dataset.id)) ?? null
    }
    // (re)draw for the current hover — cheap no-op when nothing relevant changed
    function refreshMeasure(force = false) {
        const hovered = altDown ? hoveredItem() : null
        const sel = hovered && !selection.has(hovered.id) ? ctx.geo.selectionBounds() : null
        if (!hovered || !sel) {
            clearMeasure()
            return
        }
        const hb = ctx.geo.itemBounds(hovered)
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
            e.buttons !== 0 ? ctx.ui.lastHover : (e.target as HTMLElement).closest<HTMLElement>(".titem, .frame")
        if (nowHover !== ctx.ui.lastHover) {
            ctx.ui.lastHover = nowHover
            ctx.overlay.renderUnderlines()
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
        ctx.ui.lastHover = null
        ctx.overlay.renderUnderlines()
        clearMeasure()
    })

    return { setAltDown, refreshMeasure, clearMeasure }
}
