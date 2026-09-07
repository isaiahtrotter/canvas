// The right sidebar, composed from its sections. Alignment, position and
// fill are wired at install; the Layout section's controls are built at
// install too; the Text section (fonts, size, spacing, the size widget) is
// built once by the boot sequence via buildTextPanel(), after the first
// render, since it measures the DOM.
import type { EditorContext, Disposable } from "../core/context"
import { installFill, type FillAPI } from "./fill"
import { buildLayoutPanel } from "./layoutPanel"
import { createSizeAdapter, type SizeAdapter } from "./sizeAdapter"
import { installVariants, type SizeWidget, type VariantsAPI } from "./sizeWidget"
import { buildTextPanel, setFont as applyFont, type TextPanelAPI } from "./textPanel"
import { arrowStep } from "./fields"

export interface PanelAPI {
    /** refresh the X/Y/W/H fields from the selection */
    updateProps(): void
    updateAlignButtons(): void
    fill: FillAPI
    updateLayoutPanel(): void
    adapter: SizeAdapter
    /** the mounted size widget, once the Text section exists */
    widget: { active: SizeWidget | null }
    variants: VariantsAPI
    /** the Text section, null until buildTextPanel() runs in boot */
    text: TextPanelAPI | null
    buildTextPanel(): void
    setFont(font: string): void
    /** everything the panel refreshes on emit — the second subscriber */
    update(): void
}

export function installPanel(ctx: EditorContext): PanelAPI & Disposable {
    const { root } = ctx
    const selection = ctx.doc.selection
    const { emit } = ctx.bus
    const selectedItems = () => ctx.store.selectedItems()
    const singleSelectedFrame = () => ctx.store.singleSelectedFrame()

    /* ---- alignment: single item aligns within the canvas, multi aligns within the selection bounds ---- */
    const alignBtns = []
    ;(function () {
        const row = root.querySelector<HTMLElement>("#alignRow")
        const defs = [
            {
                kind: "left",
                icon: '<rect x="1" y="2" width="2" height="10"/><rect x="5" y="4" width="8" height="2"/><rect x="5" y="8" width="5" height="2"/>',
            },
            {
                kind: "centerH",
                icon: '<rect x="6" y="2" width="2" height="10"/><rect x="2" y="4" width="10" height="2"/><rect x="3.5" y="8" width="7" height="2"/>',
            },
            {
                kind: "right",
                icon: '<rect x="11" y="2" width="2" height="10"/><rect x="1" y="4" width="8" height="2"/><rect x="4" y="8" width="5" height="2"/>',
            },
            {
                kind: "top",
                icon: '<rect x="2" y="1" width="10" height="2"/><rect x="4" y="5" width="2" height="8"/><rect x="8" y="5" width="2" height="5"/>',
            },
            {
                kind: "centerV",
                icon: '<rect x="2" y="6" width="10" height="2"/><rect x="4" y="2" width="2" height="10"/><rect x="8" y="3.5" width="2" height="7"/>',
            },
            {
                kind: "bottom",
                icon: '<rect x="2" y="11" width="10" height="2"/><rect x="4" y="1" width="2" height="8"/><rect x="8" y="4" width="2" height="5"/>',
            },
        ]
        defs.forEach((d) => {
            const b = document.createElement("button")
            b.className = "alignbtn"
            b.tabIndex = -1
            b.title = "Align " + d.kind
            b.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">' +
                d.icon +
                "</svg>"
            b.addEventListener("click", () => alignSelection(d.kind))
            row.appendChild(b)
            alignBtns.push(b)
        })
    })()

    function alignSelection(kind) {
        const sel = selectedItems()
        if (!sel.length) return
        // target: the selection's own bounds for multi; for a single item, the
        // frame it sits in, or the visible viewport if it isn't in one
        let frame
        if (sel.length > 1) {
            const b = ctx.geo.selectionBounds()
            if (!b) return
            frame = { x: b.x, y: b.y, w: b.w, h: b.h }
        } else {
            const parent = ctx.store.containingFrame(sel[0])
            frame = parent
                ? { x: parent.x, y: parent.y, w: parent.w, h: parent.h }
                : ctx.view.viewportWorldRect()
        }
        ctx.store.pushHistory()
        sel.forEach((it) => {
            const { w: iw, h: ih } = ctx.geo.nodeSize(it)
            if (kind === "left") it.x = frame.x
            if (kind === "centerH") it.x = frame.x + (frame.w - iw) / 2
            if (kind === "right") it.x = frame.x + frame.w - iw
            if (kind === "top") it.y = frame.y
            if (kind === "centerV") it.y = frame.y + (frame.h - ih) / 2
            if (kind === "bottom") it.y = frame.y + frame.h - ih
        })
        emit()
    }

    function updateAlignButtons() {
        const none = selection.size === 0
        alignBtns.forEach((b) => (b.disabled = none))
    }

    /* ---- fill / background ---- */
    const fill = installFill(ctx)

    /* ---- position / dimensions fields, live-bound to the selection ---- */
    const posX = root.querySelector<HTMLInputElement>("#posX")
    const posY = root.querySelector<HTMLInputElement>("#posY")
    const dimW = root.querySelector<HTMLInputElement>("#dimW")
    const dimH = root.querySelector<HTMLInputElement>("#dimH")

    function updateProps() {
        const sel = selectedItems()
        const none = sel.length === 0
        ;[posX, posY].forEach((i) => {
            i.disabled = none
            if (none) {
                i.value = ""
                i.placeholder = "–"
            }
        })
        // W/H are readouts, except for a lone frame where they're editable
        const frame = singleSelectedFrame()
        dimW.disabled = dimH.disabled = !frame
        if (none) {
            dimW.value = ""
            dimH.value = ""
            return
        }

        const b = ctx.geo.selectionBounds()
        if (b) {
            if (document.activeElement !== posX)
                posX.value = String(Math.round(b.x))
            if (document.activeElement !== posY)
                posY.value = String(Math.round(b.y))
            if (document.activeElement !== dimW)
                dimW.value = String(Math.round(b.w))
            if (document.activeElement !== dimH)
                dimH.value = String(Math.round(b.h))
        }
    }

    let posPre = null
    function armPos() {
        posPre = ctx.store.snapshot()
    }
    function consumePos() {
        if (posPre) {
            ctx.store.pushHistory(posPre)
            posPre = null
        }
    }

    posX.addEventListener("focus", armPos)
    posY.addEventListener("focus", armPos)

    posX.addEventListener("input", () => {
        const v = parseFloat(posX.value)
        if (isNaN(v)) return
        const b = ctx.geo.selectionBounds()
        if (!b) return
        const dx = v - b.x
        if (dx === 0) return
        consumePos()
        ctx.keymap.moveSelection(dx, 0)
        emit()
    })
    posY.addEventListener("input", () => {
        const v = parseFloat(posY.value)
        if (isNaN(v)) return
        const b = ctx.geo.selectionBounds()
        if (!b) return
        const dy = v - b.y
        if (dy === 0) return
        consumePos()
        ctx.keymap.moveSelection(0, dy)
        emit()
    })
    dimW.addEventListener("focus", armPos)
    dimH.addEventListener("focus", armPos)
    ;([
        [dimW, "w"],
        [dimH, "h"],
    ] as Array<[HTMLInputElement, "w" | "h"]>).forEach(([input, key]) => {
        input.addEventListener("input", () => {
            const frame = singleSelectedFrame()
            const v = parseFloat(input.value)
            if (!frame || isNaN(v)) return
            const next = Math.max(1, Math.round(v))
            if (next === frame[key]) return
            consumePos()
            frame[key] = next
            frame.updatedAt = Date.now()
            if (frame.layout?.sizing === "hug") frame.layout = { ...frame.layout, sizing: "fixed" }
            emit()
        })
    })
    ;[posX, posY, dimW, dimH].forEach((i) => {
        i.addEventListener("blur", () => {
            posPre = null
            updateProps()
        })
        i.addEventListener("keydown", (e) => {
            if (e.key === "Enter") i.blur()
            // arrows step the value (Shift ×10) and apply it like typing would
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault()
                if (i.disabled) return
                const cur = parseFloat(i.value)
                if (isNaN(cur)) return
                i.value = String(Math.round(cur + arrowStep(e)))
                i.dispatchEvent(new Event("input"))
            }
        })
    })

    /* ---- size controls' shared adapter, the Layout section, the Versions buttons ---- */
    const adapter = createSizeAdapter(ctx)
    const updateLayoutPanel = buildLayoutPanel(ctx)
    const widget = { active: null as SizeWidget | null }
    const variants = installVariants(ctx)

    let lastSelSig = ""
    const api: PanelAPI & Disposable = {
        updateProps,
        updateAlignButtons,
        fill,
        updateLayoutPanel,
        adapter,
        widget,
        variants,
        text: null,
        buildTextPanel() {
            api.text = buildTextPanel(ctx, adapter, widget)
        },
        setFont: (font) => applyFont(ctx, font),
        update() {
            updateProps()
            updateAlignButtons()
            fill.updateFill()
            updateLayoutPanel()
            if (api.text) {
                api.text.updateField()
                api.text.updateTooltip()
            }
            if (!widget.active) return
            const sig = Array.from(selection)
                .sort((a, b) => a - b)
                .join(",")
            if (sig !== lastSelSig) {
                lastSelSig = sig
                widget.active.rebuild()
            } else {
                widget.active.refresh()
            }
        },
    }
    return api
}
