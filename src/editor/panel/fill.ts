// The Fill row: swatch + hex + alpha for the selection; with nothing
// selected the same row controls the canvas background instead. The host
// renders the picker either way (setFill routes to whichever applies at
// call time). Also owns the canvas background's contrast-driven label and
// accent colors.
import type { EditorContext } from "../core/context"
import { type Fill, type FillMode, isFrame } from "../core/types"
import { compositeOver, contrastRatio, hexToRgb, isHex, rgbaCss } from "../color"
import { HEAT_BG } from "../times/times"

export interface FillAPI {
    /** paint the canvas background and pick the frame-label / accent palette for it */
    applyBg(): void
    /** refresh the Fill row (and the sidebar's empty state) from the selection */
    updateFill(): void
    /** apply a fill to the selection, or to the background when nothing is selected */
    setFill(hex: string, alpha: number): void
    /** a picker session: one undo step, pushed on the first change */
    beginGesture(): void
    endGesture(): void
}

export function installFill(ctx: EditorContext): FillAPI {
    const { root, hooks } = ctx
    const { canvas } = ctx.dom
    const selection = ctx.doc.selection
    const { emit } = ctx.bus
    const selectedItems = () => ctx.store.selectedItems()

    const sidepanel = root.querySelector<HTMLElement>(".sidepanel")
    const fillRow = root.querySelector<HTMLElement>("#fillRow")
    const fillLabel = root.querySelector<HTMLElement>("#fillLabel")
    const fillSwatch = fillRow.querySelector<HTMLElement>(".swatch")
    const fillHex = fillRow.querySelector<HTMLElement>(".hex")
    const fillPct = fillRow.querySelector<HTMLElement>(".pct")
    // the canvas background is document data: ctx.doc.bg (saved with the doc, reset from settings)
    // The canvas is independent of the UI theme: its background is whatever
    // the user set, and the label / selection colors derive from that color
    // alone (composited over white, as before) — never from light/dark mode.
    const surfaceRgb = (): [number, number, number] => [255, 255, 255]
    /* Frame labels (name + timestamp) sit directly on the canvas background,
       so fixed grays stop reading as the background approaches them. Two
       palettes, one switch: dark grays on light and mid-tone backgrounds,
       pale grays once the background is dark enough that a light label reads
       better than a dark one. (A softer third tier for very light
       backgrounds was tried and dropped — the timestamp washed out.) */
    const LABEL_PALETTES = {
        dark: { name: "#1c1c1c", time: "#707070" },
        pale: { name: "#f4f4f4", time: "#a8a8a8" },
    }
    /* One light/dark call for the whole canvas, decided from the background's
       overall luminance (via two opposite grays' contrast — hue-independent,
       so a light pastel background still reads as "light"). Both the label
       palette and the frame-name accent switch together on it. */
    function canvasIsDark(seen: [number, number, number]) {
        // decided from the frame *name* colors, not the timestamp — the name
        // stays a near-black/near-white pair regardless of how light or dark
        // the timestamp itself is tuned to be, so this switch point doesn't
        // move whenever the timestamp color is adjusted
        const nameContrast = (p: { name: string }) => contrastRatio(hexToRgb(p.name), seen)
        return nameContrast(LABEL_PALETTES.pale) > nameContrast(LABEL_PALETTES.dark)
    }
    /* The frame name (selected/hovered) normally matches the fixed selection
       blue (--sel-blue) — only on a genuinely dark canvas does it switch to a
       paler blue for legibility. Set as --accent on #canvas, so only canvas
       chrome adapts; the panels keep the brand color regardless. */
    const ACCENTS = { base: "#0c8ce9", pale: "#a6d4ff" }
    function accentColor(seen: [number, number, number]) {
        return canvasIsDark(seen) ? ACCENTS.pale : ACCENTS.base
    }
    function labelPalette(seen: [number, number, number]) {
        return canvasIsDark(seen) ? LABEL_PALETTES.pale : LABEL_PALETTES.dark
    }
    function applyBg() {
        if (ctx.ui.heat) {
            // thermal view: near-black purple ground, light labels
            canvas.style.backgroundColor = HEAT_BG
            canvas.style.setProperty("--fname", "#efe4ff")
            canvas.style.setProperty("--ftime", "#b9a6d9")
            canvas.style.setProperty("--accent", accentColor(hexToRgb(HEAT_BG)))
            ctx.view.applyGrid()
            return
        }
        const bg = ctx.doc.bg
        canvas.style.backgroundColor = rgbaCss(bg.hex, bg.alpha)
        const seen = compositeOver(hexToRgb(bg.hex), bg.alpha, surfaceRgb())
        const p = labelPalette(seen)
        canvas.style.setProperty("--fname", p.name)
        canvas.style.setProperty("--ftime", p.time)
        canvas.style.setProperty("--accent", accentColor(seen))
        ctx.view.applyGrid()
    }
    // shared fill of the selection, or null when empty / mixed
    function selectionFill(): { fill: Fill | null; mixed: boolean } {
        const sel = selectedItems()
        if (!sel.length) return { fill: null, mixed: false }
        const f = { hex: sel[0].fill, alpha: sel[0].alpha }
        const mixed = sel.some((it) => it.fill !== f.hex || it.alpha !== f.alpha)
        return { fill: mixed ? null : f, mixed }
    }
    function fillMode(): FillMode {
        return selection.size ? "selection" : "background"
    }
    function updateFill() {
        const mode = fillMode()
        fillLabel.textContent = mode === "background" ? "Background" : "Fill"
        // with nothing selected the sidebar collapses to just this section
        const wasEmpty = sidepanel.classList.contains("empty")
        sidepanel.classList.toggle("empty", mode === "background")
        // the Versions indicator is measured from layout, which is all zeros
        // while its section is display:none — re-measure once it's back
        if (wasEmpty && mode !== "background") ctx.panel.variants.updateButtons()
        fillRow.classList.toggle("disabled", false) // always actionable now — selection fill, or the background
        if (mode === "background") {
            fillRow.classList.remove("mixed")
            const bg = ctx.doc.bg
            fillSwatch.style.background = rgbaCss(bg.hex, bg.alpha)
            fillHex.textContent = bg.hex.replace("#", "").toUpperCase()
            fillPct.textContent = bg.alpha + "%"
            if (hooks.onFillChange) hooks.onFillChange({ ...bg }, mode)
            return
        }
        const { fill, mixed } = selectionFill()
        fillRow.classList.toggle("mixed", mixed)
        if (fill) {
            fillSwatch.style.background = rgbaCss(fill.hex, fill.alpha)
            fillHex.textContent = fill.hex.replace("#", "").toUpperCase()
            fillPct.textContent = fill.alpha + "%"
        } else {
            fillSwatch.style.background = mixed
                ? "linear-gradient(135deg,#1c1c1c 50%,#fff 50%)"
                : "#1c1c1c"
            fillHex.textContent = mixed ? "Mixed" : "–"
            fillPct.textContent = ""
        }
        // a different selection under an open picker starts a fresh undo step
        const sig = Array.from(selection).sort((a, b) => a - b).join(",")
        if (sig !== fillSelSig) {
            fillSelSig = sig
            if (fillGesture) fillPre = ctx.store.snapshot()
        }
        if (hooks.onFillChange) hooks.onFillChange(fill ?? { hex: sel0Fill(), alpha: 100 }, mode)
    }
    function sel0Fill() {
        const sel = selectedItems()
        return sel.length ? sel[0].fill : "#1c1c1c"
    }
    fillRow.addEventListener("click", () => {
        if (!hooks.onFillOpen) return
        const mode = fillMode()
        if (mode === "background") {
            hooks.onFillOpen(fillRow.getBoundingClientRect(), { ...ctx.doc.bg }, mode)
            return
        }
        const { fill } = selectionFill()
        hooks.onFillOpen(fillRow.getBoundingClientRect(), fill ?? { hex: sel0Fill(), alpha: 100 }, mode)
    })
    // A picker session is one gesture: the snapshot taken when it opens (or
    // when the selection changes under it) is pushed once, on the first change.
    // (The background isn't part of item history, so it has no gesture of its own.)
    let fillPre = null
    let fillGesture = false
    let fillSelSig = ""
    function setFill(hex: string, alpha: number) {
        if (!isHex(hex)) return
        hex = (hex.startsWith("#") ? hex : "#" + hex).toLowerCase()
        alpha = Math.max(0, Math.min(100, Math.round(alpha)))
        if (fillMode() === "background") {
            if (ctx.doc.bg.hex === hex && ctx.doc.bg.alpha === alpha) return
            ctx.doc.bg = { hex, alpha }
            applyBg()
            updateFill()
            ctx.persist.scheduleSave()
            return
        }
        const sel = selectedItems()
        if (!sel.length) return
        if (sel.every((it) => it.fill === hex && it.alpha === alpha)) return
        if (fillPre) {
            ctx.store.pushHistory(fillPre)
            fillPre = null
        } else if (!fillGesture) ctx.store.pushHistory()
        const now = Date.now()
        sel.forEach((it) => {
            it.fill = hex
            it.alpha = alpha
            if (isFrame(it)) it.updatedAt = now
        })
        emit()
    }

    return {
        applyBg,
        updateFill,
        setFill,
        beginGesture() {
            fillGesture = true
            fillPre = ctx.store.snapshot()
        },
        endGesture() {
            fillGesture = false
            fillPre = null
        },
    }
}
