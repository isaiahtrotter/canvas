// The Layout section of the side panel: shown for any selection; controls
// appear for a single selected frame that has a smart layout, and a single
// button offers to add one (or to wrap selected text) otherwise.
import type { EditorContext } from "../core/context"
import { type FrameLayout, isText } from "../core/types"
import { DEFAULT_LAYOUT } from "../canvas/layout"
import { makeSeg, layoutNumField } from "./fields"

/** Builds the section's controls into #layoutGroup now; returns the refresh function. */
export function buildLayoutPanel(ctx: EditorContext): () => void {
    const { root } = ctx
    const { emit } = ctx.bus
    const layoutSec = root.querySelector<HTMLElement>("#layoutSec")
    const layoutDiv = root.querySelector<HTMLElement>("#layoutDiv")
    const layoutGroup = root.querySelector<HTMLElement>("#layoutGroup")
    const ICON_V =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2.5h8M2 6h8M2 9.5h8"/></svg>'
    const ICON_H =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 2v8M6 2v8M9.5 2v8"/></svg>'

    if (!layoutGroup) return () => {}
    const change = (patch: Partial<FrameLayout>) => {
        const f = ctx.store.singleSelectedFrame()
        if (!f?.layout) return
        ctx.store.pushHistory()
        f.layout = { ...f.layout, ...patch }
        f.updatedAt = Date.now()
        emit()
    }
    // --- empty state: one button
    const addBtn = document.createElement("button")
    addBtn.type = "button"
    addBtn.className = "layoutbtn"
    addBtn.tabIndex = -1
    addBtn.innerHTML = ICON_V + "<span>Add smart layout</span>"
    addBtn.addEventListener("click", () => {
        const f = ctx.store.singleSelectedFrame()
        if (f) {
            if (!f.layout) ctx.layout.setLayout(f, { ...DEFAULT_LAYOUT })
            return
        }
        ctx.layout.wrapSelectionInLayout()
    })
    // --- controls
    const controls = document.createElement("div")
    controls.className = "propgroup"
    // three compact rows: direction + alignment (icons), gap + padding
    // (icon-keyed fields), sizing + remove
    const svg = (body: string, stroke = false) =>
        `<svg width="12" height="12" viewBox="0 0 12 12" ${
            stroke ? 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"' : 'fill="currentColor"'
        }>${body}</svg>`
    const ICON_START = svg('<rect x="1" y="1.5" width="1.5" height="9"/><rect x="3.5" y="3" width="6.5" height="2"/><rect x="3.5" y="7" width="4" height="2"/>')
    const ICON_CENTER = svg('<rect x="5.25" y="1.5" width="1.5" height="9"/><rect x="1.5" y="3" width="9" height="2"/><rect x="3" y="7" width="6" height="2"/>')
    const ICON_END = svg('<rect x="9.5" y="1.5" width="1.5" height="9"/><rect x="2" y="3" width="6.5" height="2"/><rect x="4.5" y="7" width="4" height="2"/>')
    const ICON_GAP = svg('<path d="M2 2v8M10 2v8M4.5 6h3M6.5 4.5L8 6l-1.5 1.5M5.5 4.5L4 6l1.5 1.5"/>', true)
    const ICON_PAD = svg('<rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/><rect x="4.25" y="4.25" width="3.5" height="3.5" rx=".5" fill="currentColor" stroke="none"/>', true)
    const ICON_X = svg('<path d="M3 3l6 6M9 3l-6 6"/>', true)
    const row1 = document.createElement("div")
    row1.className = "proprow"
    const dirSeg = makeSeg<FrameLayout["direction"]>(
        [
            { value: "vertical", label: "", icon: ICON_V, title: "Vertical — stack top to bottom" },
            { value: "horizontal", label: "", icon: ICON_H, title: "Horizontal — stack left to right" },
        ],
        (direction) => change({ direction })
    )
    const alignSeg = makeSeg<FrameLayout["align"]>(
        [
            { value: "start", label: "", icon: ICON_START, title: "Align to the start" },
            { value: "center", label: "", icon: ICON_CENTER, title: "Align to the center" },
            { value: "end", label: "", icon: ICON_END, title: "Align to the end" },
        ],
        (align) => change({ align })
    )
    row1.append(dirSeg.el, alignSeg.el)
    const row2 = document.createElement("div")
    row2.className = "proprow"
    const gapField = layoutNumField(ctx, ICON_GAP, "Gap between items", "gap")
    const padField = layoutNumField(ctx, ICON_PAD, "Padding", "padding")
    row2.append(gapField.el, padField.el)
    const row3 = document.createElement("div")
    row3.className = "proprow"
    const sizingSeg = makeSeg<FrameLayout["sizing"]>(
        [
            { value: "hug", label: "Hug", title: "Hug — the frame sizes itself to its contents" },
            { value: "fixed", label: "Fixed", title: "Fixed — the frame keeps the size you give it" },
        ],
        (sizing) => change({ sizing })
    )
    const removeBtn = document.createElement("button")
    removeBtn.type = "button"
    removeBtn.className = "layoutbtn icon"
    removeBtn.tabIndex = -1
    removeBtn.title = "Remove smart layout"
    removeBtn.setAttribute("aria-label", "Remove smart layout")
    removeBtn.innerHTML = ICON_X
    removeBtn.addEventListener("click", () => {
        const f = ctx.store.singleSelectedFrame()
        if (f?.layout) ctx.layout.setLayout(f, null)
    })
    row3.append(sizingSeg.el, removeBtn)
    controls.append(row1, row2, row3)
    layoutGroup.append(addBtn, controls)

    return function updateLayoutPanel() {
        const sel = ctx.store.selectedItems()
        const f = ctx.store.singleSelectedFrame()
        const show = sel.length > 0
        layoutSec?.classList.toggle("on", show)
        layoutDiv?.classList.toggle("on", show)
        if (!show) return
        if (!f) {
            // text selected: the button wraps it; a frame mixed in can't be
            // wrapped (frames don't nest), so say so instead of doing nothing
            const allText = sel.every(isText)
            addBtn.style.display = ""
            controls.style.display = "none"
            addBtn.disabled = !allText
            addBtn.innerHTML = ICON_V + `<span>${allText ? (sel.length > 1 ? "Wrap in smart layout" : "Add smart layout") : "Select text, or one frame"}</span>`
            return
        }
        const has = !!f.layout
        addBtn.disabled = false
        addBtn.innerHTML = ICON_V + "<span>Add smart layout</span>"
        addBtn.style.display = has ? "none" : ""
        controls.style.display = has ? "" : "none"
        if (!f.layout) return
        dirSeg.set(f.layout.direction)
        alignSeg.set(f.layout.align)
        sizingSeg.set(f.layout.sizing)
        gapField.update()
        padField.update()
    }
}
