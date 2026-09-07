// Smart guides while dragging: pull the moving box's edges/centers onto a
// sibling's matching edge/center within a small screen-pixel radius.
import type { EditorContext, Rect } from "../core/context"
import type { FrameItem, Item } from "../core/types"

export type SnapGuide = { axis: "x" | "y"; at: number; from: number; to: number }

export interface SnapAPI {
    snapToGuides(
        base: Rect,
        dx: number,
        dy: number,
        moving: Set<number>,
        locked: "x" | "y" | null,
        context: FrameItem | null
    ): { dx: number; dy: number; guides: SnapGuide[] } | null
}

export function createSnap(ctx: EditorContext): SnapAPI {
    const items = ctx.doc.items
    const view = ctx.doc.view

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
        const targets = items.filter((it) => !moving.has(it.id) && sibling(it)).map((it) => ctx.geo.itemBounds(it))
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

    return { snapToGuides }
}
