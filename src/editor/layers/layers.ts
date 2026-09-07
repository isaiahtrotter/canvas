// Layers panel (left sidebar): top-most first. Loose text sits above every
// frame; each frame lists the text it holds beneath it.
//
// Parked for now: the markup has no #layerList, so renderLayers() returns
// early. The code is kept so the panel can come back without a rewrite.
import type { EditorContext, Disposable } from "../core/context"
import { type Item, type TextItem, isFrame, isText } from "../core/types"

export interface LayersAPI {
    renderLayers(): void
}

export function installLayers(ctx: EditorContext): LayersAPI & Disposable {
    const { root } = ctx
    const items = ctx.doc.items
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    const layerList = root.querySelector<HTMLElement>("#layerList")
    const TEXT_ICON =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1.5 1.5h9v2.2H9.3V3H6.9v7h1.3v1.5H3.8V10h1.3V3H2.7v.7H1.5z"/></svg>'
    const FRAME_ICON =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3.8 1v10M8.2 1v10M1 3.8h10M1 8.2h10"/></svg>'
    function layerRow(it: Item, child: boolean) {
        const row = document.createElement("div")
        row.className =
            "layerrow " + (isFrame(it) ? "frame" : "text") + (child ? " child" : "") + (selection.has(it.id) ? " selected" : "")
        row.dataset.id = String(it.id)
        row.innerHTML = isFrame(it) ? FRAME_ICON : TEXT_ICON
        const name = document.createElement("span")
        name.className = "lname"
        name.textContent = isFrame(it) ? it.name : it.text
        row.appendChild(name)
        row.addEventListener("click", (e) => {
            if (name.getAttribute("contenteditable") === "true") return
            if (e.shiftKey) {
                if (selection.has(it.id)) selection.delete(it.id)
                else selection.add(it.id)
            } else {
                selection.clear()
                selection.add(it.id)
            }
            emit()
        })
        // hovering a text row underlines it on the canvas, like hovering the text itself
        row.addEventListener("mouseenter", () => {
            const node = ctx.nodeFor(it.id)
            if (isText(it) && node) {
                ctx.ui.lastHover = node
                ctx.overlay.renderUnderlines()
            }
        })
        row.addEventListener("mouseleave", () => {
            if (ctx.ui.lastHover && ctx.ui.lastHover.dataset.id === String(it.id)) {
                ctx.ui.lastHover = null
                ctx.overlay.renderUnderlines()
            }
        })
        if (isFrame(it))
            name.addEventListener("dblclick", (e) => {
                e.stopPropagation()
                ctx.gestures.startRenaming(name, it)
            })
        return row
    }
    function renderLayers() {
        if (!layerList) return
        layerList.innerHTML = ""
        if (!items.length) {
            const empty = document.createElement("div")
            empty.className = "empty"
            empty.textContent = "No layers yet"
            layerList.appendChild(empty)
            return
        }
        const frames = items.filter(isFrame)
        const texts = items.filter(isText)
        const held = new Set<number>()
        const byFrame = new Map<number, TextItem[]>()
        texts.forEach((t) => {
            const f = ctx.store.containingFrame(t)
            if (!f) return
            held.add(t.id)
            if (!byFrame.has(f.id)) byFrame.set(f.id, [])
            byFrame.get(f.id).push(t)
        })
        texts
            .filter((t) => !held.has(t.id))
            .reverse()
            .forEach((t) => layerList.appendChild(layerRow(t, false)))
        frames
            .slice()
            .reverse()
            .forEach((f) => {
                layerList.appendChild(layerRow(f, false))
                ;(byFrame.get(f.id) ?? [])
                    .slice()
                    .reverse()
                    .forEach((t) => layerList.appendChild(layerRow(t, true)))
            })
    }

    return { renderLayers }
}
