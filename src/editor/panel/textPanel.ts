// The Text section of the side panel: font row (opens the host's floating
// list), weight select, size field with its drawer and widget, and the line
// height / letter spacing fields. Built once, in the boot sequence.
import type { EditorContext } from "../core/context"
import { lineHeightOf, letterSpacingOf } from "../core/types"
import { arrowStep, makeSelect, numField } from "./fields"
import type { SizeAdapter } from "./sizeAdapter"
import { VARIANTS, makeWidget, type SizeWidget } from "./sizeWidget"

export interface TextPanelAPI {
    updateField(force?: boolean): void
    /** refresh the size tooltip if it is showing */
    updateTooltip(): void
    /** (re)create the size widget inside the drawer for the active variant */
    mountWidget(): void
}

// shared by the font row's button and the host's floating list
export const FONTS = ["Inter", "PP Mondwest", "PP NeueBit", "Helvetica Neue", "Georgia"]
export function currentFontValue(ctx: EditorContext): string {
    const sel = ctx.store.selectedTextItems()
    if (!sel.length) return FONTS[0]
    const same = sel.every((it) => it.font === sel[0].font)
    return same ? sel[0].font : "__mixed"
}
export function setFont(ctx: EditorContext, font: string) {
    const sel = ctx.store.selectedTextItems()
    if (!sel.length || sel.every((it) => it.font === font)) return
    ctx.store.pushHistory()
    sel.forEach((it) => (it.font = font))
    ctx.bus.emit()
}

export function buildTextPanel(ctx: EditorContext, adapter: SizeAdapter, widget: { active: SizeWidget | null }): TextPanelAPI {
    const { root, hooks } = ctx
    const { emit } = ctx.bus
    const selectedTextItems = () => ctx.store.selectedTextItems()
    const panelGroup = root.querySelector<HTMLElement>("#panelGroup")

    // the font row opens a floating list next to the sidebar (see
    // onFontOpen/onFontChange), like the fill swatch opens the color
    // picker — not a native <select>, so each option can render in its
    // own typeface. The button shows the current font in that font too.
    const fontWrap = document.createElement("div")
    fontWrap.className = "dd-wrap"
    const fontBtn = document.createElement("button")
    fontBtn.type = "button"
    fontBtn.className = "dd"
    fontBtn.id = "fontRow"
    fontBtn.tabIndex = -1
    fontWrap.appendChild(fontBtn)
    function updateFontDD() {
        const sel = selectedTextItems()
        fontBtn.disabled = !sel.length
        const v = currentFontValue(ctx)
        fontBtn.textContent = v === "__mixed" ? "Mixed" : v
        fontBtn.style.fontFamily = v === "__mixed" ? "" : v
        if (hooks.onFontChange) hooks.onFontChange(v)
    }
    fontBtn.addEventListener("click", () => {
        if (!hooks.onFontOpen || fontBtn.disabled) return
        hooks.onFontOpen(fontBtn.getBoundingClientRect(), FONTS, currentFontValue(ctx))
    })

    const row = document.createElement("div")
    row.className = "proprow"
    const weightDD = makeSelect(
        [
            { label: "Light", value: 300 },
            { label: "Regular", value: 400 },
            { label: "Medium", value: 500 },
            { label: "Semibold", value: 600 },
            { label: "Bold", value: 700 },
        ],
        (v) => {
            const weight = Number(v)
            const sel = selectedTextItems()
            if (!sel.length || sel.every((it) => it.weight === weight)) return
            ctx.store.pushHistory()
            sel.forEach((it) => (it.weight = weight))
            emit()
        }
    )
    const weightSel = weightDD.querySelector<HTMLSelectElement>("select")
    const mixedWeight = document.createElement("option")
    mixedWeight.value = "__mixed"
    mixedWeight.textContent = "Mixed"
    mixedWeight.disabled = true
    mixedWeight.hidden = true
    weightSel.appendChild(mixedWeight)
    function updateWeightDD() {
        const sel = selectedTextItems()
        weightSel.disabled = !sel.length
        if (!sel.length) {
            weightSel.value = "400"
            return
        }
        const same = sel.every((it) => it.weight === sel[0].weight)
        weightSel.value = same ? String(sel[0].weight) : "__mixed"
    }

    /* line height (unitless, e.g. 1.2) and letter spacing (px). Each field
       applies live as you type; a typing session is one undo step. */
    const spacingRow = document.createElement("div")
    spacingRow.className = "proprow"
    const lineHeightField = numField(
        ctx,
        "LH",
        "Line height",
        lineHeightOf,
        (it, v) => (it.lineHeight = Math.max(0, v)),
        0.1,
        2
    )
    const letterSpacingField = numField(
        ctx,
        "LS",
        "Letter spacing (px)",
        letterSpacingOf,
        (it, v) => (it.letterSpacing = v),
        0.5,
        2
    )
    spacingRow.append(lineHeightField.el, letterSpacingField.el)

    const sizewrap = document.createElement("div")
    sizewrap.className = "sizewrap"
    const field = document.createElement("div")
    field.className = "sizefield"
    const input = document.createElement("input")
    input.type = "text"
    input.className = "sizeinput"
    input.setAttribute("inputmode", "numeric")
    input.setAttribute("aria-label", "Font size")
    const chevronBtn = document.createElement("button")
    chevronBtn.type = "button"
    chevronBtn.className = "sizechevron"
    chevronBtn.tabIndex = -1
    chevronBtn.setAttribute("aria-label", "Show size controls")
    chevronBtn.innerHTML = '<span class="chev"></span>'
    field.append(input, chevronBtn)
    sizewrap.appendChild(field)

    const tooltip = document.createElement("div")
    tooltip.className = "tooltip-summary"
    const dotsRow = document.createElement("div")
    dotsRow.className = "dots-row"
    const summaryText = document.createElement("div")
    summaryText.className = "summary-text"
    tooltip.append(dotsRow, summaryText)
    sizewrap.appendChild(tooltip)

    row.append(weightDD, sizewrap)

    const drawer = document.createElement("div")
    drawer.className = "sizedrawer"

    let open = false
    function setOpen(v) {
        if (selectedTextItems().length === 0) v = false
        open = v
        drawer.classList.toggle("open", v)
        if (v) tooltip.classList.remove("visible")
    }

    function mountWidget() {
        drawer.innerHTML = ""
        widget.active = makeWidget(VARIANTS[ctx.ui.activeVariant], adapter)
        drawer.appendChild(widget.active.el)
        // keep open state exactly as it was — swapping the version must not reset the panel
    }

    function updateField(force?: boolean) {
        updateFontDD()
        updateWeightDD()
        lineHeightField.update(force)
        letterSpacingField.update(force)
        const sel = selectedTextItems()
        if (sel.length === 0) {
            input.value = ""
            input.placeholder = "–"
            input.disabled = true
            chevronBtn.disabled = true
            setOpen(false)
            return
        }
        input.disabled = false
        chevronBtn.disabled = false
        if (document.activeElement === input && !force) return // don't clobber what the user is typing
        const vals = sel.map((it) => it.size)
        const allEqual = vals.every((v) => v === vals[0])
        if (allEqual) {
            input.value = String(vals[0])
            input.classList.remove("mixed")
        } else {
            input.value = "Mixed"
            input.classList.add("mixed")
        }
    }
    function updateTooltip() {
        const sel = selectedTextItems()
        dotsRow.innerHTML = ""
        sel.forEach((it) => {
            const dot = document.createElement("span")
            dot.className = "dot"
            dot.style.background = ctx.store.selColor(it.id)
            dotsRow.appendChild(dot)
        })
        const vals = sel.map((it) => it.size)
        if (!vals.length) {
            summaryText.textContent = "No layers selected"
            return
        }
        const min = Math.min(...vals),
            max = Math.max(...vals)
        const distinct = new Set(vals).size
        summaryText.innerHTML =
            min === max
                ? "<b>" + min + "px</b>"
                : "<b>" +
                  min +
                  "–" +
                  max +
                  "px</b> · " +
                  distinct +
                  " distinct layers"
    }

    chevronBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        setOpen(!open)
    })
    input.addEventListener("focus", () => {
        input.select()
        adapter.beginGesture()
    })
    input.addEventListener("input", () => {
        const v = parseFloat(input.value)
        if (!isNaN(v)) adapter.setAll(v) // applies live as you type
    })
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            input.blur()
            return
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            adapter.nudge(arrowStep(e))
            updateField(true) // force: this is a real value change, not mid-typing
        }
    })
    input.addEventListener("blur", () => {
        adapter.cancelGesture()
        updateField()
    })
    sizewrap.addEventListener("mouseenter", () => {
        if (!open && selectedTextItems().length > 1) {
            updateTooltip()
            tooltip.classList.add("visible")
        }
    })
    sizewrap.addEventListener("mouseleave", () =>
        tooltip.classList.remove("visible")
    )
    ctx.onDoc("click", (e) => {
        if (
            open &&
            !sizewrap.contains(e.target as Node) &&
            !drawer.contains(e.target as Node)
        )
            setOpen(false)
    })

    panelGroup.append(fontWrap, row, drawer, spacingRow)
    mountWidget()
    updateField()
    setOpen(true)

    return {
        updateField,
        updateTooltip: () => {
            if (tooltip.classList.contains("visible")) updateTooltip()
        },
        mountWidget,
    }
}
