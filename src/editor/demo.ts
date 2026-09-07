// First-run content: what a fresh document shows before the user has drawn
// anything. Only runs when localStorage has no saved document.
import type { EditorContext } from "./core/context"
import { isText } from "./core/types"

export function seedDemoText(ctx: EditorContext) {
    const { addItem } = ctx.store
    addItem({ x: 60, y: 70, text: "select multiple", size: 32, weight: 400 })
    addItem({ x: 60, y: 130, text: "lines of text", size: 20, weight: 400 })
    addItem({ x: 60, y: 180, text: "and use the drop down", size: 16, weight: 400 })
    addItem({ x: 60, y: 220, text: "to edit them", size: 14, weight: 400 })
}

// One-time initial layout for the default demo lines: each line is
// horizontally centered on its own (a centered text block, not
// left-margin-aligned), and the whole stack is shifted so it sits
// vertically centered in the canvas — the original relative gaps
// between lines (60/50/40px) are preserved, only re-centered as a
// group. Requires a render pass first so offsetWidth/offsetHeight
// are real measurements, not guesses.
export function centerDefaultItems(ctx: EditorContext) {
    const items = ctx.doc.items
    const { canvas } = ctx.dom
    if (!items.length) return
    const canvasW = canvas.clientWidth
    const canvasH = canvas.clientHeight
    const rects = items.map((it) => ctx.geo.nodeSize(it))
    const firstY = items[0].y
    const lastIdx = items.length - 1
    const blockTop = firstY
    const blockBottom = items[lastIdx].y + rects[lastIdx].h
    const shiftY = canvasH / 2 - (blockTop + blockBottom) / 2
    items.forEach((it, i) => {
        it.x = Math.round(canvasW / 2 - rects[i].w / 2) // center each line horizontally
        it.y = Math.round(it.y + shiftY) // recenter the whole stack vertically
    })
}

// Wrap the demo text in a frame so frames + timestamps are visible on load.
export function seedDemoFrame(ctx: EditorContext) {
    const b = ctx.geo.boundsOf(ctx.doc.items.filter(isText))
    if (!b) return
    const PAD = 48
    const f = ctx.store.addFrame({
        x: Math.round(b.x - PAD),
        y: Math.round(b.y - PAD),
        w: Math.round(b.w + PAD * 2),
        h: Math.round(b.h + PAD * 2),
    })
    ctx.store.adoptLooseText(f)
}
