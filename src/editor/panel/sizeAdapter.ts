// What the size controls (field, pills, ± steppers, slider widget) talk to.
// Gesture-scoped history: a handle drag or a typing session logs ONE undo
// entry, captured before its first change; discrete actions (a pill click,
// a +/- press) log one entry each.
//
// Pass this object whole — never destructure its methods off it.
import type { EditorContext } from "../core/context"
import { MIN, MAX, SIZE_MIN, isText } from "../core/types"

export interface SizeAdapter {
    beginGesture(): void
    cancelGesture(): void
    /** tint the text whose handle is hovered (null clears) */
    highlight(id: number | null, color: string | null): void
    list(): Array<{ id: number; color: string; value: number }>
    /** one layer's size, clamped to the slider range */
    set(id: number, v: number): void
    /** every selected layer, clamped, consuming the pending gesture snapshot once */
    setAllLive(v: number): void
    /** every selected layer; typed sizes have no ceiling */
    setAll(v: number): void
    nudge(s: number): void
}

export function createSizeAdapter(ctx: EditorContext): SizeAdapter {
    const items = ctx.doc.items
    const { emit } = ctx.bus
    const selectedTextItems = () => ctx.store.selectedTextItems()

    let pendingPre = null
    function consumeOrPush() {
        if (pendingPre) {
            ctx.store.pushHistory(pendingPre)
            pendingPre = null
        } else ctx.store.pushHistory()
    }
    return {
        beginGesture() {
            pendingPre = ctx.store.snapshot()
        },
        cancelGesture() {
            pendingPre = null
        },
        highlight(id, color) {
            ctx.ui.hoverWash = color ? { id, color } : null
            ctx.canvas.applyWash()
        },
        list() {
            return selectedTextItems().map((it) => ({
                id: it.id,
                color: ctx.store.selColor(it.id),
                value: it.size,
            }))
        },
        set(id, v) {
            const it = items.find((i) => i.id === id)
            if (!it || !isText(it)) return
            v = Math.max(MIN, Math.min(MAX, Math.round(v)))
            if (v === it.size) return
            if (pendingPre) {
                ctx.store.pushHistory(pendingPre)
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
                ctx.store.pushHistory(pendingPre)
                pendingPre = null
            }
            selectedTextItems().forEach((it) => (it.size = v))
            emit()
        },
        // typed sizes (field, pills, +/-) have no ceiling — only slider drags are bounded
        setAll(v) {
            v = Math.max(SIZE_MIN, Math.round(v))
            if (selectedTextItems().every((it) => it.size === v)) return
            consumeOrPush()
            selectedTextItems().forEach((it) => (it.size = v))
            emit()
        },
        nudge(s) {
            consumeOrPush()
            selectedTextItems().forEach((it) => (it.size = Math.max(SIZE_MIN, it.size + s)))
            emit()
        },
    }
}
