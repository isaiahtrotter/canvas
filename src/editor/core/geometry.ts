// Geometry over the document: coordinate conversion, rendered sizes, bounds,
// containment and hit-testing. Items live in world units; #world carries
// translate(view.x, view.y) scale(view.z). Anything drawn in #overlay is in
// canvas-relative screen pixels.
import type { EditorContext, GeometryAPI, Rect } from "./context"
import { type FrameItem, type Item, isFrame } from "./types"

export function createGeometry(ctx: EditorContext): GeometryAPI {
    const { canvas } = ctx.dom
    const items = ctx.doc.items
    const view = ctx.doc.view

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
    function placeScreenRect(el: HTMLElement, r: Rect) {
        const p = toScreen(r.x, r.y)
        // snap edges to whole pixels so the 1px strokes stay crisp
        const l = Math.round(p.x),
            t = Math.round(p.y)
        el.style.left = l + "px"
        el.style.top = t + "px"
        el.style.width = Math.round(p.x + r.w * view.z) - l + "px"
        el.style.height = Math.round(p.y + r.h * view.z) - t + "px"
    }

    /* Rendered size of an item, in world units. Frames know their size;
       text is measured off its node (unscaled layout size inside #world). */
    function nodeSize(it: Item) {
        if (isFrame(it)) return { w: it.w, h: it.h }
        const node = ctx.nodeFor(it.id)
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
        return boundsOf(ctx.store.selectedItems())
    }
    function itemBounds(it: Item) {
        const { w, h } = nodeSize(it)
        return { x: it.x, y: it.y, w, h }
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
    // the smallest frame a box sits fully inside — for placing a newly drawn frame
    function frameEnclosing(r: Rect, exclude?: number): FrameItem | null {
        let best: FrameItem | null = null
        items.filter(isFrame).forEach((f) => {
            if (f.id === exclude) return
            if (r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h && (!best || f.w * f.h < best.w * best.h))
                best = f
        })
        return best
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
    // an item's own rect intersected with every ancestor frame's, at any
    // depth — a child frame poking past its parent clips exactly like text
    // does, and anything inside that child frame is clipped by both levels
    function visibleRect(it: Item, w: number, h: number) {
        let r = { x: it.x, y: it.y, w, h }
        for (let p = ctx.store.containingFrame(it); p; p = ctx.store.containingFrame(p)) {
            const x1 = Math.max(r.x, p.x),
                y1 = Math.max(r.y, p.y)
            const x2 = Math.min(r.x + r.w, p.x + p.w),
                y2 = Math.min(r.y + r.h, p.y + p.h)
            r = { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) }
        }
        return r
    }

    return { toWorld, toScreen, placeScreenRect, nodeSize, boundsOf, selectionBounds, itemBounds, rectContains, frameEnclosing, frameAt, visibleRect }
}
