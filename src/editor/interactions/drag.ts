// Pointer-down on an item: select it, then drag the whole selection — with
// Shift axis-lock, smart-guide snapping, Option/Ctrl live duplication, and
// frame membership following the pointer.
import type { EditorContext, Disposable, Rect } from "../core/context"
import { type Item, type TextItem, isFrame, isText } from "../core/types"

export interface DragAPI {
    onItemPointerDown(e: PointerEvent, it: Item, el: HTMLElement): void
}

/** One entry per moving item: the item and where it started. */
interface Start {
    it: Item
    x: number
    y: number
    parent: number | null
}
interface DragSet {
    starts: Start[]
    /** ids of the frames being dragged (their contents ride along) */
    draggedFrames: Set<number>
    /** whatever moves on its own — not riding inside a dragged frame — follows the pointer's membership */
    freeItems: Start[]
    /** the moving set's combined box at drag start */
    baseBounds: Rect | null
    movingIds: Set<number>
}

export function installDrag(ctx: EditorContext): DragAPI & Disposable {
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const view = ctx.doc.view
    const { emit } = ctx.bus

    function onItemPointerDown(e: PointerEvent, it: Item, el: HTMLElement) {
        // panning and the frame tool are handled by the canvas — let it bubble
        if (ctx.ui.spaceDown || e.button === 1 || ctx.ui.tool === "frame") return
        if (e.button !== 0) return
        if (el.getAttribute("contenteditable") === "true") return
        e.stopPropagation()
        // inside a nested frame you haven't entered, the click lands on the frame
        ctx.drill.leaveUnlessInside(it)
        const target = ctx.drill.selectTargetFor(it)
        if (target !== it) {
            it = target
            el = ctx.nodeFor(target.id) ?? el
        }

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

        beginDrag(e)
    }

    // Everything that moves with the selection: the selected items, plus — for
    // a selected frame — everything inside it at any depth, selected or not.
    function collectDragSet(): DragSet {
        const starts: Start[] = ctx.store.selectedItems().map((s) => ({
            it: s,
            x: s.x,
            y: s.y,
            parent: isText(s) ? s.parent ?? null : null,
        }))
        // a frame carries everything inside it — its text, the frames nested
        // in it, and their text — selected or not
        const carried = new Set(starts.map((s) => s.it.id))
        ctx.store
            .selectedItems()
            .filter(isFrame)
            .forEach((f) => {
                ctx.store.descendantsOf(f).forEach((d) => {
                    if (carried.has(d.id)) return
                    carried.add(d.id)
                    starts.push({ it: d, x: d.x, y: d.y, parent: isText(d) ? d.parent ?? null : null })
                })
            })
        const draggedFrames = new Set(starts.filter((s) => isFrame(s.it)).map((s) => s.it.id))
        // Text moving on its own (not riding along inside a dragged frame)
        // follows the pointer's membership: while the pointer is over a frame
        // the text belongs to it (and is clipped by it); the moment the pointer
        // leaves, the text leaves too.
        // whatever is moving on its own — not riding along inside a dragged
        // frame — follows the pointer's membership, text and frames alike
        const freeItems = starts.filter((s) => !(s.it.parent != null && draggedFrames.has(s.it.parent)))
        // the moving set's combined box at drag start; the live box is this
        // shifted by (dx, dy), so snapping never has to re-measure mid-drag
        const baseBounds = ctx.geo.boundsOf(starts.map((s) => s.it))
        const movingIds = new Set(starts.map((s) => s.it.id))
        return { starts, draggedFrames, freeItems, baseBounds, movingIds }
    }

    /* Option (mac) / ctrl (windows) is a live modifier, not a one-shot
       trigger. While it's held, a copy of what's being dragged sits at the
       origin and the item under the pointer is the duplicate. Let go of it
       mid-drag and the copy is withdrawn — you're just moving the original
       again. Press it again and the copy is back. Nothing about frame
       timestamps happens here; the frame the item is dropped in is stamped
       at release, and only that one. */
    function createDuplicator(set: DragSet, hasMoved: () => boolean, markDragging: (on: boolean) => void) {
        let duplicated = false
        let copyIds: number[] = [] // the copies left at the origin while option is held
        // a mid-gesture re-render: shows/hides the copies without any frame
        // timestamp moving — those settle once, at release
        function rerenderQuiet() {
            ctx.flags.skipTouch = true
            emit()
            ctx.flags.skipTouch = false
            markDragging(true) // the re-render dropped the class
        }
        function sync(alt: boolean) {
            if (!hasMoved()) return
            if (alt && !duplicated) {
                duplicated = true
                // the copies stay where the drag began, so they keep the
                // membership from then — pointed at the copied frame when
                // their frame was duplicated along with them
                const copies = new Map<number, number>()
                set.starts
                    .filter((s) => isFrame(s.it))
                    .forEach((s) => {
                        const c = ctx.store.duplicateItem(s.it, s.x, s.y)
                        copies.set(s.it.id, c.id)
                        copyIds.push(c.id)
                    })
                // a copied frame that sat in a copied frame points at the copy
                copies.forEach((copyId, origId) => {
                    const c = ctx.store.itemById(copyId)
                    const o = ctx.store.itemById(origId)
                    if (c && o && o.parent != null) c.parent = copies.get(o.parent) ?? o.parent
                })
                set.starts
                    .filter((s) => isText(s.it))
                    .forEach((s) => {
                        const c = ctx.store.duplicateItem(s.it, s.x, s.y) as TextItem
                        c.parent = s.parent == null ? null : copies.get(s.parent) ?? s.parent
                        copyIds.push(c.id)
                        // the copy left behind isn't a content change — it's
                        // exactly what was already there — so it's tracked as
                        // already-settled and never stamps its frame. (A real
                        // future edit to this layer still tracks normally.)
                        ctx.store.lastText.set(c.id, { sig: ctx.store.textSig(c), parent: c.parent ?? null })
                    })
                rerenderQuiet()
            } else if (!alt && duplicated) {
                duplicated = false
                const gone = new Set(copyIds)
                copyIds = []
                for (let i = items.length - 1; i >= 0; i--) if (gone.has(items[i].id)) items.splice(i, 1)
                gone.forEach((id) => ctx.store.lastText.delete(id))
                rerenderQuiet()
            }
        }
        return {
            sync,
            get duplicated() {
                return duplicated
            },
        }
    }

    function beginDrag(e: PointerEvent) {
        const startX = e.clientX,
            startY = e.clientY
        const startWorld = ctx.geo.toWorld(startX, startY) // for the shift-lock's frame-under check
        const set = collectDragSet()
        const { starts, draggedFrames, freeItems, baseBounds, movingIds } = set
        const preDrag = ctx.store.snapshot() // pre-state: pushed once if the gesture actually moves anything
        let moved = false
        let shiftAxis: "x" | "y" | null = null // sticks once chosen; see mv()
        // .dragging lifts the moving frame above other frames and its carried
        // text above the frame (see CSS). emit() re-renders the DOM, so this
        // is re-applied after a mid-drag duplicate, not just at the start.
        const markDragging = (on: boolean) =>
            starts.forEach((s) => {
                const node = ctx.nodeFor(s.it.id)
                if (node) node.classList.toggle("dragging", on)
            })
        markDragging(true)
        const dup = createDuplicator(set, () => moved, markDragging)
        // the modifier can change without the pointer moving
        const onModKey = (e: KeyboardEvent) => {
            if (e.key === "Alt" || e.key === "Control") dup.sync(e.type === "keydown")
        }
        document.addEventListener("keydown", onModKey)
        document.addEventListener("keyup", onModKey)
        function mv(ev: PointerEvent) {
            let dx = (ev.clientX - startX) / view.z,
                dy = (ev.clientY - startY) / view.z
            if (!moved && (Math.abs(dx) * view.z > 2 || Math.abs(dy) * view.z > 2)) {
                moved = true
                ctx.store.pushHistory(preDrag)
            }
            // Shift locks the drag to a straight line, horizontal or vertical.
            // dx/dy are always the pointer's total distance from the ORIGINAL
            // start (never accumulated), so the lock never drifts from where
            // the item actually started. Which axis wins is sticky, not just
            // "whichever is bigger right now": a path that trends horizontal
            // still drifts exactly through the point where |dx| equals |dy| at
            // some moment (jitter, or simply crossing that line on the way
            // through), and re-deciding from scratch every frame flips the
            // lock there for an instant before "trending" wins it back. Once
            // an axis is chosen it keeps its grip until the other one clears
            // it by a real margin — a few screen pixels, scaled for zoom — so
            // a momentary near-tie can't flip it.
            if (ev.shiftKey) {
                const HYSTERESIS = 30 / view.z // screen px worth of "clear lead" needed to flip
                if (shiftAxis === null) shiftAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
                else if (shiftAxis === "x" && Math.abs(dy) > Math.abs(dx) + HYSTERESIS) shiftAxis = "y"
                else if (shiftAxis === "y" && Math.abs(dx) > Math.abs(dy) + HYSTERESIS) shiftAxis = "x"
                if (shiftAxis === "x") dy = 0
                else dx = 0
            } else {
                shiftAxis = null // released — the next press re-decides fresh
            }
            /* Smart guides: within a few screen px, the moving box's left /
               center / right (and top / center / bottom) pull onto any other
               layer's matching edge or center, and a guide line spans the two
               while the snap holds. The nearest candidate wins per axis; an
               axis Shift has locked to zero is left alone. */
            // frames are top-level, so a drag that includes one aligns at the
            // root; a text-only drag aligns within whichever frame the pointer
            // is over right now (membership follows the pointer the same way)
            const snapContext = ctx.geo.frameAt({ x: startWorld.x + dx, y: startWorld.y + dy }, draggedFrames)
            const snapped =
                moved && baseBounds ? ctx.snap.snapToGuides(baseBounds, dx, dy, movingIds, shiftAxis, snapContext) : null
            if (snapped) {
                dx = snapped.dx
                dy = snapped.dy
            }
            ctx.overlay.renderSnapGuides(snapped ? snapped.guides : [])
            dup.sync(ev.altKey || ev.ctrlKey)
            starts.forEach((s) => {
                s.it.x = Math.round(s.x + dx)
                s.it.y = Math.round(s.y + dy)
            })
            if (moved && freeItems.length) {
                // use the same (possibly axis-locked) point the item is actually
                // drawn at, not the raw cursor — otherwise membership could pick
                // a frame the item doesn't visually appear to be over. While the
                // pointer is inside the parent the child stays in it; once the
                // pointer leaves, so does the child.
                const under = ctx.geo.frameAt({ x: startWorld.x + dx, y: startWorld.y + dy }, draggedFrames)
                freeItems.forEach((s) => (s.it.parent = under ? under.id : null))
            }
            items.forEach((i2) => {
                const node = ctx.nodeFor(i2.id)
                if (node) {
                    node.style.left = i2.x + "px"
                    node.style.top = i2.y + "px"
                }
            })
            ctx.layout.applyClips()
            // a dragged frame that's currently inside another frame loses its
            // selection box for the duration — it's back the moment you release
            ctx.ui.hideSelBoxWhileNesting = starts.some((s) => isFrame(s.it) && ctx.store.containingFrame(s.it) !== null)
            ctx.overlay.renderSelectionOverlay()
            ctx.panel.updateProps() // X/Y readouts follow the drag in real time
        }
        function up() {
            markDragging(false)
            ctx.ui.hideSelBoxWhileNesting = false
            ctx.overlay.renderSnapGuides([])
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            document.removeEventListener("keydown", onModKey)
            document.removeEventListener("keyup", onModKey)
            if (moved) {
                // dragging a frame carries its contents along for the ride —
                // that's not a content edit, so don't let the position diff
                // below bump the frame's timestamp for text that just came along
                const draggedFrame = starts.some((s) => isFrame(s.it))
                if (draggedFrame) ctx.flags.carryingFrameDrag = true
                // the dragged item can only land in one frame — if a copy was
                // left behind along the way, don't also light up whatever it left
                if (dup.duplicated) ctx.flags.suppressLeaveBump = true
                emit()
                ctx.flags.carryingFrameDrag = false
                ctx.flags.suppressLeaveBump = false
            }
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    return { onItemPointerDown }
}
