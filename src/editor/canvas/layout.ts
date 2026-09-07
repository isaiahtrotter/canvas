// Smart layout (auto layout) and clipping — the two post-render passes that
// walk the frame tree.
import type { EditorContext, Disposable } from "../core/context"
import { type FrameItem, type FrameLayout, type TextItem, isFrame, isText } from "../core/types"

export interface LayoutAPI {
    /** Lay out every frame that has a layout; returns whether anything moved or resized. */
    applyLayouts(): boolean
    setLayout(f: FrameItem, layout: FrameLayout | null): void
    /** Wrap the selected text in a new layout frame; false if the selection isn't wrappable. */
    wrapSelectionInLayout(): boolean
    /** Shift+A */
    toggleLayout(): void
    /** Clip every layer to its ancestor frames (suspended while editing or dragging). */
    applyClips(): void
}

export const DEFAULT_LAYOUT: FrameLayout = { direction: "vertical", gap: 12, padding: 24, align: "start", sizing: "hug" }

export function installLayout(ctx: EditorContext): LayoutAPI & Disposable {
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    /* ---- smart layout engine ----
       For every frame with a layout: its text children are ordered by where
       they currently sit along the main axis (so dragging one to a new spot
       and releasing reorders it), then stacked from the padding edge with
       the gap between them, aligned on the cross axis. A hugging frame takes
       the size of that stack. Runs inside renderCanvas() once the nodes are
       current, since text sizes come from the DOM. Positions written here are
       layout, not edits, so the timestamp baseline is updated to match and
       nothing lights up because of them. Returns whether anything changed. */
    function applyLayouts(): boolean {
        let changed = false
        items.filter(isFrame).forEach((f) => {
            const L = f.layout
            if (!L) return
            const kids = items.filter((t): t is TextItem => isText(t) && t.parent === f.id)
            const vertical = L.direction === "vertical"
            const sized = kids.map((k) => ({ k, ...ctx.geo.nodeSize(k) }))
            sized.sort((a, b) => (vertical ? a.k.y - b.k.y : a.k.x - b.k.x) || a.k.id - b.k.id)
            const mainOf = (s: { w: number; h: number }) => (vertical ? s.h : s.w)
            const crossOf = (s: { w: number; h: number }) => (vertical ? s.w : s.h)
            const mainTotal = sized.reduce((sum, s) => sum + mainOf(s), 0) + L.gap * Math.max(0, sized.length - 1)
            const crossMax = sized.reduce((m, s) => Math.max(m, crossOf(s)), 0)
            if (L.sizing === "hug") {
                // exact, not rounded: content sizes are fractional, and a hug
                // that's off by any fraction leaves either the content poking
                // out or a sliver of frame past the last item
                const w = Math.max(1, (vertical ? crossMax : mainTotal) + L.padding * 2)
                const h = Math.max(1, (vertical ? mainTotal : crossMax) + L.padding * 2)
                if (w !== f.w || h !== f.h) {
                    f.w = w
                    f.h = h
                    changed = true
                }
            }
            const innerCross = (vertical ? f.w : f.h) - L.padding * 2
            let cursor = L.padding
            sized.forEach((s) => {
                const cross = crossOf(s)
                const off = L.align === "start" ? 0 : L.align === "center" ? (innerCross - cross) / 2 : innerCross - cross
                // exact, not rounded: text heights are fractional (size × line
                // height), so rounding each child's position onto the grid left
                // up to half a unit between neighbours even at gap 0
                const x = vertical ? f.x + L.padding + off : f.x + cursor
                const y = vertical ? f.y + cursor : f.y + L.padding + off
                if (x !== s.k.x || y !== s.k.y) {
                    s.k.x = x
                    s.k.y = y
                    changed = true
                    // a layout move isn't an edit: keep the timestamp baseline in step
                    ctx.store.lastText.set(s.k.id, { sig: ctx.store.textSig(s.k), parent: s.k.parent ?? null })
                }
                cursor += mainOf(s) + L.gap
            })
        })
        return changed
    }
    function setLayout(f: FrameItem, layout: FrameLayout | null) {
        ctx.store.pushHistory()
        f.layout = layout
        f.updatedAt = Date.now()
        emit()
    }
    /* Selected text (one or more, no frames) gets wrapped in a new frame that
       has a layout, like Figma's "add auto layout" on a selection. Direction
       and gap are inferred from how the items already sit — spread more
       sideways than downward reads as a row, and the average clear space
       between neighbours becomes the gap — so the frame closes around them
       without visibly rearranging anything. Returns false if the selection
       isn't wrappable (empty, or includes a frame). */
    function wrapSelectionInLayout(): boolean {
        const sel = ctx.store.selectedItems()
        const texts = sel.filter(isText)
        if (!texts.length || texts.length !== sel.length) return false
        const b = ctx.geo.boundsOf(texts)
        if (!b) return false
        const sizes = new Map(texts.map((t) => [t.id, ctx.geo.nodeSize(t)]))
        const cx = texts.map((t) => t.x + sizes.get(t.id).w / 2)
        const cy = texts.map((t) => t.y + sizes.get(t.id).h / 2)
        const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
        const direction: FrameLayout["direction"] = spread(cx) > spread(cy) ? "horizontal" : "vertical"
        const vertical = direction === "vertical"
        const sorted = [...texts].sort((a, b2) => (vertical ? a.y - b2.y : a.x - b2.x))
        const gaps: number[] = []
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1],
                next = sorted[i]
            const prevEnd = vertical ? prev.y + sizes.get(prev.id).h : prev.x + sizes.get(prev.id).w
            gaps.push((vertical ? next.y : next.x) - prevEnd)
        }
        const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)) : DEFAULT_LAYOUT.gap
        const padding = DEFAULT_LAYOUT.padding
        ctx.store.pushHistory()
        const f = ctx.store.addFrame({
            x: Math.round(b.x - padding),
            y: Math.round(b.y - padding),
            w: Math.round(b.w + padding * 2),
            h: Math.round(b.h + padding * 2),
            layout: { ...DEFAULT_LAYOUT, direction, gap, padding },
        })
        // the new frame takes the texts' place in the tree, if they shared one
        const parents = new Set(texts.map((t) => t.parent ?? null))
        f.parent = parents.size === 1 ? [...parents][0] : null
        texts.forEach((t) => (t.parent = f.id))
        selection.clear()
        selection.add(f.id)
        emit()
        return true
    }
    // Shift+A: add a smart layout to the selected frame (or remove the one it
    // has); with text selected, wrap it in a new layout frame
    function toggleLayout() {
        const f = ctx.store.singleSelectedFrame()
        if (f) {
            setLayout(f, f.layout ? null : { ...DEFAULT_LAYOUT })
            ctx.tools.showToast(f.layout ? "Smart layout added" : "Smart layout removed")
            return
        }
        if (wrapSelectionInLayout()) ctx.tools.showToast("Smart layout added")
    }

    /* Text belongs to the frame recorded in its `parent` (set by where the
       pointer is when it's dropped, or by the frame drawn around it), so a
       line that runs past the frame's edge still belongs to it and the part
       poking out is clipped. Frames nest only when fully contained. */
    // clip every text layer to the frame it belongs to; text being edited is
    // left unclipped so the caret and what's typed stay visible
    function applyClips() {
        items.forEach((it) => {
            const node = ctx.nodeFor(it.id)
            if (!node) return
            // A node holding a clip-path — even one that's the empty string,
            // just from having had one before — appears to get promoted to
            // its own compositing layer in at least some browsers, and
            // repositioning that layer via raw style.left/top on every
            // pointermove (not a transform the compositor can interpolate)
            // can make its paint region briefly lag behind the new position,
            // clipping content right at the layer's edge for a frame or two —
            // on text, that reads as the descenders flickering off. Standalone
            // text never has a clip-path at all, so it never hits this; text
            // in a frame does, which matches: it only happens there, and only
            // while actually moving. Suspending the clip for the duration of
            // the drag sidesteps it; applyClips() reinstates the real one the
            // moment the drag ends and the layer settles.
            if (node === ctx.ui.editingEl || node.classList.contains("dragging") || !ctx.store.containingFrame(it)) {
                node.style.clipPath = ""
                return
            }
            const { w, h } = ctx.geo.nodeSize(it)
            const vis = ctx.geo.visibleRect(it, w, h)
            const top = vis.y - it.y,
                left = vis.x - it.x,
                right = it.x + w - (vis.x + vis.w),
                bottom = it.y + h - (vis.y + vis.h)
            node.style.clipPath =
                top > 0 || left > 0 || right > 0 || bottom > 0
                    ? `inset(${Math.max(0, top)}px ${Math.max(0, right)}px ${Math.max(0, bottom)}px ${Math.max(0, left)}px)`
                    : ""
        })
    }

    return { applyLayouts, setLayout, wrapSelectionInLayout, toggleLayout, applyClips }
}
