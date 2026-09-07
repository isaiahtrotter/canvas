// The document store: items + selection live on ctx.doc; this module owns
// every mutation helper around them — creation, the parent/child tree,
// selection queries, undo history, and the per-emit timestamp diff.
import type { EditorContext, Disposable } from "./context"
import { type FrameItem, type Item, type TextItem, PALETTE, isFrame, isText, lineHeightOf, letterSpacingOf } from "./types"

export interface Snapshot {
    items: Item[]
    selection: number[]
}

export interface StoreAPI {
    /** run on every emit: stamp updatedAt on changed text and the frames it touched */
    touchParentFrames(): void
    itemById(id: number): Item | undefined
    frameById(id: number | null | undefined): FrameItem | null
    /** the frame holding the item — its recorded parent, text or frame alike */
    containingFrame(it: Item): FrameItem | null
    isInside(it: Item, f: FrameItem): boolean
    /** everything inside a frame at any depth — what moves, deletes and ⌘A-selects with it */
    descendantsOf(f: FrameItem): Item[]
    selectedItems(): Item[]
    selectedTextItems(): TextItem[]
    singleSelectedFrame(): FrameItem | null
    /** the palette color assigned to a text layer for the size widget's handles */
    selColor(id: number): string
    addItem(props: Partial<TextItem>): TextItem
    addFrame(props: Partial<FrameItem>): FrameItem
    /** a freshly drawn frame takes in the loose items that sit fully inside it */
    adoptLooseText(f: FrameItem): void
    /** copy of `it` placed at (x, y); a copied frame keeps its timestamps */
    duplicateItem(it: Item, x: number, y: number): Item
    snapshot(): Snapshot
    /** log an undo step — the current state, or `pre` taken before a gesture began */
    pushHistory(pre?: Snapshot): void
    undo(): void
    redo(): void
    /** the per-text signature/parent seen at the last emit; layout moves update it so they don't count as edits */
    lastText: Map<number, { sig: string; parent: number | null }>
    textSig(it: TextItem): string
}

export function installStore(ctx: EditorContext): StoreAPI & Disposable {
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    /* A frame's "edited" time also moves when anything inside it changes.
       Rather than sprinkling bumps through every mutation path, each emit
       diffs text layers against the last emit: a text that changed (moved,
       retyped, restyled, or newly added) bumps the frame that contains it now
       and, if it moved, the one it came from. Undo/redo set `restoring` so a
       restored snapshot keeps the timestamps it was saved with. The switches
       (restoring, carryingFrameDrag, suppressLeaveBump, skipTouch) live in
       ctx.flags, since drags and the side panel flip them too. */
    const lastText = new Map<number, { sig: string; parent: number | null }>()
    function textSig(it: TextItem) {
        return [it.x, it.y, it.text, it.size, it.font, it.weight, it.fill, it.alpha, lineHeightOf(it), letterSpacingOf(it)].join("|")
    }
    function touchParentFrames() {
        if (ctx.flags.skipTouch) return
        const now = Date.now()
        const seen = new Set<number>()
        items.filter(isText).forEach((t) => {
            seen.add(t.id)
            const sig = textSig(t)
            const parent = t.parent ?? null
            const prev = lastText.get(t.id)
            if (!prev || prev.sig !== sig || prev.parent !== parent) {
                if (!ctx.flags.restoring && !ctx.flags.carryingFrameDrag) {
                    t.updatedAt = now
                    const bump = (f: FrameItem | null) => {
                        if (f) f.updatedAt = now
                    }
                    bump(containingFrame(t))
                    if (prev && prev.parent !== parent && !ctx.flags.suppressLeaveBump)
                        bump(frameById(prev.parent)) // the frame it left
                }
                lastText.set(t.id, { sig, parent })
            }
        })
        lastText.forEach((_, id) => {
            if (!seen.has(id)) lastText.delete(id)
        })
    }

    /* ---- undo history: up to 20 steps ---- */
    const HISTORY_MAX = 20
    const history: Snapshot[] = []
    const redoStack: Snapshot[] = []
    function snapshot(): Snapshot {
        return {
            items: items.map((it) => Object.assign({}, it)),
            selection: Array.from(selection),
        }
    }
    function pushHistory(pre?: Snapshot) {
        history.push(pre || snapshot())
        if (history.length > HISTORY_MAX) history.shift()
        redoStack.length = 0 // a new action invalidates the redo timeline
    }
    function restore(st: Snapshot) {
        items.length = 0
        st.items.forEach((it) => items.push(Object.assign({}, it)))
        selection.clear()
        st.selection.forEach((id) => selection.add(id))
        ctx.doc.nextId = items.reduce((m, it) => Math.max(m, it.id), 0) + 1
        ctx.flags.restoring = true
        emit()
        ctx.flags.restoring = false
    }
    function undo() {
        if (!history.length) return
        redoStack.push(snapshot())
        if (redoStack.length > HISTORY_MAX) redoStack.shift()
        restore(history.pop())
    }
    function redo() {
        if (!redoStack.length) return
        history.push(snapshot())
        if (history.length > HISTORY_MAX) history.shift()
        restore(redoStack.pop())
    }
    ctx.onDoc("keydown", (e) => {
        if (ctx.ui.settingsOpen) return
        if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
            const a = document.activeElement as HTMLElement | null
            if (a && a.isContentEditable) return // let native undo run inside text editing
            e.preventDefault()
            if (e.shiftKey) redo()
            else undo()
        }
    })

    function addItem(props: Partial<TextItem>): TextItem {
        const it: TextItem = Object.assign(
            {
                kind: "text" as const,
                id: ctx.doc.nextId++,
                x: 60,
                y: 60,
                text: "Text",
                size: 16,
                font: "Inter",
                weight: 400,
                opacity: 100,
                fill: "#1c1c1c",
                alpha: 100,
                parent: null,
                updatedAt: Date.now(),
            },
            props
        )
        items.push(it)
        return it
    }
    function frameById(id: number | null | undefined): FrameItem | null {
        if (id == null) return null
        const f = items.find((it) => it.id === id)
        return f && isFrame(f) ? f : null
    }
    // a freshly drawn frame takes in the loose text that sits fully inside it
    function adoptLooseText(f: FrameItem) {
        // top-level text and frames sitting fully inside the new frame join it
        items.forEach((it) => {
            if (it.id !== f.id && it.parent == null && ctx.geo.rectContains(f, it)) it.parent = f.id
        })
    }

    function addFrame(props: Partial<FrameItem>): FrameItem {
        const now = Date.now()
        ctx.doc.frameCount++
        const f: FrameItem = Object.assign(
            {
                kind: "frame" as const,
                id: ctx.doc.nextId++,
                x: 0,
                y: 0,
                w: 200,
                h: 150,
                name: "Frame " + ctx.doc.frameCount,
                createdAt: now,
                updatedAt: now,
                fill: "#ffffff",
                alpha: 100,
                parent: null,
            },
            props
        )
        items.push(f)
        return f
    }

    // copy of `it` placed at (x, y); a copied frame gets fresh timestamps
    function duplicateItem(it: Item, x: number, y: number) {
        const { id: _id, ...rest } = it
        if (isFrame(it)) return addFrame({ ...(rest as FrameItem), x, y }) // a copy keeps its timestamps
        return addItem({ ...(rest as TextItem), x, y })
    }

    function selectedItems(): Item[] {
        return items.filter((it) => selection.has(it.id))
    }
    // the text layers in the selection — what the Text panel and size widget bind to
    function selectedTextItems(): TextItem[] {
        return items.filter((it): it is TextItem => isText(it) && selection.has(it.id))
    }
    function selColor(id) {
        const sel = selectedTextItems()
        const idx = sel.findIndex((it) => it.id === id)
        return PALETTE[idx % PALETTE.length]
    }

    // handlers look their item up by id at event time, since undo/redo replaces the item objects
    function itemById(id: number): Item | undefined {
        return items.find((i) => i.id === id)
    }
    // the frame holding the item — its recorded parent, text or frame alike
    function containingFrame(it: Item): FrameItem | null {
        return frameById(it.parent)
    }
    /* Everything inside a frame, at any depth: the text it holds directly, the
       frames fully inside it, and the text inside those. This is what moves
       with it, is deleted with it, and is selected by ⌘A inside it. */
    function isInside(it: Item, f: FrameItem): boolean {
        if (it.id === f.id) return false
        for (let p = frameById(it.parent); p; p = containingFrame(p)) if (p.id === f.id) return true
        return false
    }
    function descendantsOf(f: FrameItem): Item[] {
        return items.filter((it) => isInside(it, f))
    }
    function singleSelectedFrame(): FrameItem | null {
        const sel = selectedItems()
        return sel.length === 1 && isFrame(sel[0]) ? sel[0] : null
    }

    return {
        touchParentFrames,
        itemById,
        frameById,
        containingFrame,
        isInside,
        descendantsOf,
        selectedItems,
        selectedTextItems,
        singleSelectedFrame,
        selColor,
        addItem,
        addFrame,
        adoptLooseText,
        duplicateItem,
        snapshot,
        pushHistory,
        undo,
        redo,
        lastText,
        textSig,
    }
}
