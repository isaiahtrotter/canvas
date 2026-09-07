// Document-level keyboard: tools, zoom, toggles, select-all, nudging, delete,
// Escape. (Undo/redo has its own keydown listener, registered earlier by the
// store so its position in the listener order stays where it has always been.)
import type { EditorContext, Disposable } from "../core/context"
import { type Item, isFrame } from "../core/types"

export interface KeymapAPI {
    /** ⌘A: with frames selected, select what's inside them; otherwise every layer */
    selectAll(): void
    /** arrow keys: 1px, or 10px with Shift; a quick run of presses is one undo step */
    nudgeSelection(dx: number, dy: number): void
    /** move the selected items by (dx, dy) without any history or emit — the caller owns both */
    moveSelection(dx: number, dy: number): void
}

export function installKeymap(ctx: EditorContext): KeymapAPI & Disposable {
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    // Cmd/Ctrl+A: with frames selected, select what's inside them (text, and
    // frames fully contained); otherwise select every layer
    function selectAll() {
        const frames = ctx.store.selectedItems().filter(isFrame)
        const inside = new Set<number>()
        frames.forEach((f) => ctx.store.descendantsOf(f).forEach((d) => inside.add(d.id)))
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
        ctx.store.selectedItems().forEach((it) => moving.set(it.id, it))
        ctx.store
            .selectedItems()
            .filter(isFrame)
            .forEach((f) => ctx.store.descendantsOf(f).forEach((d) => moving.set(d.id, d)))
        if (!moving.size) return
        if (!nudgePre) {
            nudgePre = ctx.store.snapshot()
            ctx.store.pushHistory(nudgePre)
        }
        clearTimeout(nudgeTimer)
        nudgeTimer = setTimeout(() => (nudgePre = null), 600)
        moving.forEach((it) => {
            it.x += dx
            it.y += dy
        })
        if (Array.from(moving.values()).some(isFrame)) ctx.flags.carryingFrameDrag = true
        emit()
        ctx.flags.carryingFrameDrag = false
    }
    // repositioning a frame (typed X/Y) isn't a content edit either
    function moveSelection(dx: number, dy: number) {
        ctx.store.selectedItems().forEach((it) => {
            it.x += dx
            it.y += dy
        })
    }

    /* keyboard: tools, zoom, timestamps, delete */
    ctx.onDoc("keydown", (e) => {
        if (ctx.ui.settingsOpen) {
            if (e.key === "Escape") {
                e.preventDefault()
                ctx.settings.closeSettings()
            }
            return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === ",") {
            e.preventDefault()
            ctx.settings.openSettings()
            return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
            e.preventDefault()
            ctx.settings.toggleSidebars()
            return
        }
        const a = document.activeElement as HTMLElement | null
        // an active text edit counts as typing even if focus is elsewhere
        const typing =
            !!ctx.ui.editingEl ||
            (a &&
                (a.tagName === "INPUT" ||
                    a.tagName === "SELECT" ||
                    a.isContentEditable))
        if (e.code === "Space" && !typing) {
            if (!ctx.ui.spaceDown) ctx.view.setSpaceDown(true)
            e.preventDefault()
            return
        }
        if (e.key === "Alt") {
            ctx.measure.setAltDown(true)
            return
        }
        const mod = e.metaKey || e.ctrlKey
        if (mod && (e.key === "=" || e.key === "+")) {
            e.preventDefault()
            ctx.view.zoomCenter(1.25)
            return
        }
        if (mod && e.key === "-") {
            e.preventDefault()
            ctx.view.zoomCenter(1 / 1.25)
            return
        }
        if (mod && e.key === "0") {
            e.preventDefault()
            ctx.view.resetView()
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
            ctx.times.toggleTimes()
            return
        }
        if (e.shiftKey && (e.key === "H" || e.key === "h")) {
            e.preventDefault()
            ctx.times.toggleHeat()
            return
        }
        if (e.shiftKey && (e.key === "A" || e.key === "a")) {
            e.preventDefault()
            ctx.layout.toggleLayout()
            return
        }
        if (e.key === "v" || e.key === "V") {
            ctx.tools.setTool("move")
            return
        }
        if (e.key === "f" || e.key === "F") {
            ctx.tools.setTool("frame")
            return
        }
        if (e.key === "t" || e.key === "T") {
            ctx.tools.setTool("text")
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
            if (ctx.ui.tool !== "move") ctx.tools.setTool("move")
            else if (ctx.ui.enteredFrame !== null) {
                // step out: the frame you were in becomes the selection, and its
                // own nested parent (if any) becomes the new context
                const was = ctx.store.frameById(ctx.ui.enteredFrame)
                const up = was ? ctx.store.containingFrame(was) : null
                ctx.ui.enteredFrame = up && ctx.store.containingFrame(up) ? up.id : null
                selection.clear()
                if (was) selection.add(was.id)
                emit()
            } else if (selection.size) {
                selection.clear()
                emit()
            }
            return
        }
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (!selection.size) return
        e.preventDefault()
        ctx.store.pushHistory()
        // a frame takes everything inside it along, nested frames included
        const doomed = new Set(selection)
        items.filter(isFrame).forEach((f) => {
            if (!doomed.has(f.id)) return
            ctx.store.descendantsOf(f).forEach((d) => doomed.add(d.id))
        })
        // a deleted item's frame counts as edited too — unless the frame is
        // being deleted along with it
        const now = Date.now()
        items.forEach((it) => {
            if (!doomed.has(it.id)) return
            const f = ctx.store.containingFrame(it)
            if (f && !doomed.has(f.id)) f.updatedAt = now
        })
        for (let i = items.length - 1; i >= 0; i--) {
            if (doomed.has(items[i].id)) items.splice(i, 1)
        }
        selection.clear()
        emit()
    })
    ctx.onDoc("keyup", (e) => {
        if (e.code === "Space") ctx.view.setSpaceDown(false)
        if (e.key === "Alt") ctx.measure.setAltDown(false)
    })

    return {
        selectAll,
        nudgeSelection,
        moveSelection,
        dispose() {
            clearTimeout(nudgeTimer)
        },
    }
}
