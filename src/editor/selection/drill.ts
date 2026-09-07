// Drilling into nested frames.
//
// Top-level frames are transparent: their contents are selectable directly.
// A frame nested inside another is opaque until you double-click into it — a
// single click anywhere on it or its contents selects the nested frame as a
// whole, so nothing can be dragged out of it by accident. Double-clicking
// enters it; then its direct children are selectable, and any frame nested
// one level deeper is the new opaque unit — double-click again to go
// further. Clicking empty canvas leaves; Escape steps back out one level.
//
// The entered frame's id is ctx.ui.enteredFrame: the keymap (Escape) and the
// canvas pointerdown (empty click) reset it, and the overlay reads it.
import type { EditorContext, Disposable } from "../core/context"
import { type Item, isFrame } from "../core/types"

export interface DrillAPI {
    /** the highest frame in `it`'s ancestry that hasn't been entered, or `it` itself */
    selectTargetFor(it: Item): Item
    /** clicking outside the entered frame's subtree leaves it */
    leaveUnlessInside(it: Item | null): void
    /** double-click: go one level deeper toward `it` and select what's there; false if nothing nested */
    drillInto(it: Item): boolean
}

export function installDrill(ctx: EditorContext): DrillAPI & Disposable {
    const selection = ctx.doc.selection
    const containingFrame = (it: Item) => ctx.store.containingFrame(it)

    function selectTargetFor(it: Item): Item {
        let cur: Item = it
        for (;;) {
            const p = containingFrame(cur)
            if (!p || p.id === ctx.ui.enteredFrame || !containingFrame(p)) return cur
            cur = p
        }
    }
    function isAncestorFrame(ancestorId: number, it: Item): boolean {
        for (let p = containingFrame(it); p; p = containingFrame(p)) if (p.id === ancestorId) return true
        return false
    }
    function leaveUnlessInside(it: Item | null) {
        const entered = ctx.ui.enteredFrame
        if (entered !== null && (!it || (it.id !== entered && !isAncestorFrame(entered, it)))) ctx.ui.enteredFrame = null
    }
    function drillInto(it: Item) {
        const target = selectTargetFor(it)
        if (!isFrame(target) || !containingFrame(target)) return false // nothing nested to enter
        ctx.ui.enteredFrame = target.id
        const next = selectTargetFor(it)
        selection.clear()
        selection.add(next.id)
        ctx.bus.emit()
        return true
    }

    return { selectTargetFor, leaveUnlessInside, drillInto }
}
