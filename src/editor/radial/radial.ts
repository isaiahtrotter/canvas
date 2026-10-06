// Right-click a frame: a radial menu with three wedges.
//   Fill     — swaps the menu for a round color picker (hue/saturation disc,
//              with brightness and opacity arcs around it)
//   Opacity  — press the wedge and drag sideways to scrub
//   Radius   — four corner tiles, each scrubbed on its own (Shift, or the
//              wedge behind the tiles, moves all four together)
// One undo step per gesture. The menu stays up so several properties can be
// adjusted in a row; Escape or a click outside closes it.
import type { EditorContext, Disposable } from "../core/context"
import { type FrameItem, isFrame } from "../core/types"
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, rgbaCss } from "../color"

export interface RadialAPI {
    open(it: FrameItem, x: number, y: number): void
    close(): void
}

const SIZE = 272,
    C = SIZE / 2,
    R_IN = 46,
    R_OUT = 130,
    GAP = 0.04 // radians trimmed from each wedge edge
const NS = "http://www.w3.org/2000/svg"
const WEDGES = ["fill", "opacity", "radius"] as const
type Wedge = (typeof WEDGES)[number]
const LABEL: Record<Wedge, string> = { fill: "Fill", opacity: "Opacity", radius: "Radius" }
const SCRUB_PX_PER_UNIT = 2 // screen px of horizontal drag per opacity point
// radius tiles in display order (rows of two), as indices into [tl, tr, br, bl]
const TILES = [0, 1, 3, 2]
type Corners = [number, number, number, number]

// color view geometry
const DISC = 92 // hue/saturation disc radius
const ARC_R = 116 // brightness / opacity arc radius
const ARC_W = 14
const ARC_SPAN = (75 * Math.PI) / 180 // each arc reaches this far above and below the horizontal

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
    const el = document.createElementNS(NS, tag)
    for (const k in attrs) el.setAttribute(k, attrs[k])
    return el
}

export function installRadial(ctx: EditorContext): RadialAPI & Disposable {
    const { canvas } = ctx.dom
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    let menu: HTMLDivElement | null = null
    let target: FrameItem | null = null
    let refresh: () => void = () => {}

    const opacityOf = (f: FrameItem) => f.opacity ?? 100
    const cornersOf = (f: FrameItem): Corners => {
        const r = f.radius ?? 0
        return typeof r === "number" ? [r, r, r, r] : [...r]
    }
    const maxRadius = (f: FrameItem) => Math.floor(Math.min(f.w, f.h) / 2)

    const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`
    function wedgePath(a0: number, a1: number) {
        // the angular gap shrinks with radius so the visible gap stays even
        const i0 = a0 + GAP * (R_OUT / R_IN) * 0.5,
            i1 = a1 - GAP * (R_OUT / R_IN) * 0.5
        const o0 = a0 + GAP,
            o1 = a1 - GAP
        return `M ${pt(R_OUT, o0)} A ${R_OUT} ${R_OUT} 0 0 1 ${pt(R_OUT, o1)} L ${pt(R_IN, i1)} A ${R_IN} ${R_IN} 0 0 0 ${pt(R_IN, i0)} Z`
    }

    function close() {
        if (!menu) return
        menu.remove()
        menu = null
        target = null
        document.removeEventListener("pointerdown", onOutside, true)
        document.removeEventListener("keydown", onKey, true)
    }
    function onOutside(e: PointerEvent) {
        if (menu && menu.contains(e.target as Node)) return
        close()
    }
    function onKey(e: KeyboardEvent) {
        if (e.key !== "Escape") return
        e.stopPropagation()
        close()
    }

    /** run a drag: `move` gets the horizontal distance in screen px; `up` runs on release */
    function drag(e: PointerEvent, move: (dx: number, ev: PointerEvent) => void, up?: () => void) {
        const startX = e.clientX
        const mv = (ev: PointerEvent) => move(ev.clientX - startX, ev)
        const end = () => {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", end)
            up?.()
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", end)
    }

    function open(it: FrameItem, x: number, y: number) {
        close()
        target = it
        menu = document.createElement("div")
        menu.className = "radial"
        const half = SIZE / 2
        const cx = Math.max(half, Math.min(window.innerWidth - half, x))
        const cy = Math.max(half, Math.min(window.innerHeight - half, y))
        menu.style.left = cx - half + "px"
        menu.style.top = cy - half + "px"
        menu.style.width = menu.style.height = SIZE + "px"

        const svg = svgEl("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, class: "rd-wedges" })
        const slice = (Math.PI * 2) / WEDGES.length
        const els = {} as Record<Wedge, { g: SVGGElement; value?: SVGTextElement; swatch?: SVGCircleElement }>
        let tileEls: Array<{ rect: SVGRectElement; text: SVGTextElement }> = []
        WEDGES.forEach((w, i) => {
            const a0 = -Math.PI / 2 - slice / 2 + i * slice
            const a1 = a0 + slice
            const g = svgEl("g", { class: "rd-wedge" })
            g.dataset.wedge = w
            g.appendChild(svgEl("path", { d: wedgePath(a0, a1) }))
            const mid = (a0 + a1) / 2
            const rm = (R_IN + R_OUT) / 2 + 2
            const mx = C + rm * Math.cos(mid),
                my = C + rm * Math.sin(mid)
            const label = svgEl("text", { class: "rd-label", x: String(mx), y: String(my - (w === "radius" ? 27 : 5)) })
            label.textContent = LABEL[w]
            g.appendChild(label)
            els[w] = { g }
            if (w === "radius") {
                const TW = 30,
                    TH = 17
                tileEls = []
                TILES.forEach((corner, n) => {
                    const col = n % 2,
                        row = Math.floor(n / 2)
                    const tx = mx - TW - 1 + col * (TW + 2),
                        ty = my - 19 + row * (TH + 2)
                    const tile = svgEl("g", { class: "rd-tile" })
                    const rect = svgEl("rect", { x: String(tx), y: String(ty), width: String(TW), height: String(TH), rx: "3" })
                    const text = svgEl("text", { class: "rd-tilevalue", x: String(tx + TW / 2), y: String(ty + TH / 2 + 4) })
                    tile.append(rect, text)
                    tile.addEventListener("pointerdown", (e) => onRadiusDown(e as PointerEvent, corner))
                    g.appendChild(tile)
                    tileEls[corner] = { rect, text }
                })
                g.addEventListener("pointerdown", (e) => onRadiusDown(e as PointerEvent, -1))
            } else if (w === "opacity") {
                const value = svgEl("text", { class: "rd-value", x: String(mx), y: String(my + 11) })
                g.appendChild(value)
                els[w].value = value
                g.addEventListener("pointerdown", (e) => onOpacityDown(e as PointerEvent))
            } else {
                const swatch = svgEl("circle", { class: "rd-swatch", cx: String(mx), cy: String(my + 12), r: "10" })
                g.appendChild(swatch)
                els.fill.swatch = swatch
                g.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    showColor()
                })
            }
            svg.appendChild(g)
        })
        const hub = svgEl("text", { class: "rd-hub", x: String(C), y: String(C + 4) })
        svg.appendChild(hub)
        menu.appendChild(svg)

        const color = buildColorView()
        menu.appendChild(color.el)

        refresh = () => {
            if (!target) return
            els.opacity.value!.textContent = opacityOf(target) + "%"
            const c = cornersOf(target)
            tileEls.forEach((t, corner) => (t.text.textContent = String(Math.round(c[corner]))))
            els.fill.swatch!.style.fill = rgbaCss(target.fill, target.alpha)
        }
        refresh()
        ctx.root.appendChild(menu)
        document.addEventListener("pointerdown", onOutside, true)
        document.addEventListener("keydown", onKey, true)

        function showColor() {
            color.load(target!)
            menu!.classList.add("color")
        }

        function flash(text: string) {
            hub.textContent = text
        }

        function onOpacityDown(e: PointerEvent) {
            if (e.button !== 0 || !target) return
            e.preventDefault()
            e.stopPropagation()
            const f = target
            const start = opacityOf(f)
            const pre = ctx.store.snapshot()
            let moved = false
            els.opacity.g.classList.add("active")
            drag(
                e,
                (dx) => {
                    const v = Math.max(0, Math.min(100, Math.round(start + dx / SCRUB_PX_PER_UNIT)))
                    if (v === opacityOf(f)) return
                    if (!moved) {
                        moved = true
                        ctx.store.pushHistory(pre)
                    }
                    f.opacity = v
                    f.updatedAt = Date.now()
                    flash(v + "%")
                    refresh()
                    emit()
                },
                () => {
                    els.opacity.g.classList.remove("active")
                    flash("")
                }
            )
        }

        /** corner -1 = all four (each keeps its own offset from the others) */
        function onRadiusDown(e: PointerEvent, corner: number) {
            if (e.button !== 0 || !target) return
            e.preventDefault()
            e.stopPropagation()
            const f = target
            const all = corner < 0 || e.shiftKey
            const start = cornersOf(f)
            const pre = ctx.store.snapshot()
            let moved = false
            const hot = all ? tileEls.map((t) => t.rect) : [tileEls[corner].rect]
            hot.forEach((r) => r.classList.add("active"))
            els.radius.g.classList.add("active")
            const max = maxRadius(f)
            drag(
                e,
                (dx) => {
                    const d = dx / ctx.doc.view.z
                    const next = start.map((s, i) =>
                        all || i === corner ? Math.max(0, Math.min(max, Math.round(s + d))) : s
                    ) as Corners
                    const cur = cornersOf(f)
                    if (next.every((v, i) => v === cur[i])) return
                    if (!moved) {
                        moved = true
                        ctx.store.pushHistory(pre)
                    }
                    // stored as one number again while all four agree
                    f.radius = next.every((v) => v === next[0]) ? next[0] : next
                    f.updatedAt = Date.now()
                    flash(String(all ? next[0] : next[corner]))
                    refresh()
                    emit()
                },
                () => {
                    hot.forEach((r) => r.classList.remove("active"))
                    els.radius.g.classList.remove("active")
                    flash("")
                }
            )
        }
    }

    /* ---- the round color picker ---- */
    function buildColorView() {
        const el = document.createElement("div")
        el.className = "rd-color"
        el.innerHTML = `
          <div class="rd-disc"><div class="rd-disc-dark"></div><div class="rd-knob"></div></div>
          <svg viewBox="0 0 ${SIZE} ${SIZE}">
            <defs>
              <linearGradient id="rdVal" gradientUnits="userSpaceOnUse" x1="0" y1="${C - ARC_R}" x2="0" y2="${C + ARC_R}"><stop offset="0" class="rd-v1"/><stop offset="1" stop-color="#000"/></linearGradient>
              <linearGradient id="rdAlpha" gradientUnits="userSpaceOnUse" x1="0" y1="${C - ARC_R}" x2="0" y2="${C + ARC_R}"><stop offset="0" class="rd-a1"/><stop offset="1" class="rd-a0"/></linearGradient>
              <pattern id="rdChecker" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#fff"/><rect width="4" height="4" fill="#cfcfcf"/><rect x="4" y="4" width="4" height="4" fill="#cfcfcf"/></pattern>
            </defs>
            <path class="rd-track rd-checker" d="" data-arc="alpha"/>
            <path class="rd-track" d="" data-arc="alpha" stroke="url(#rdAlpha)"/>
            <path class="rd-track" d="" data-arc="val" stroke="url(#rdVal)"/>
            <circle class="rd-thumb" data-thumb="val" r="9"/>
            <circle class="rd-thumb" data-thumb="alpha" r="9"/>
          </svg>
          <button class="rd-back" type="button" aria-label="Back to menu"><span class="rd-chip"></span><span class="rd-hex"></span></button>`
        const $ = <T extends Element>(s: string) => el.querySelector<T>(s)!
        const disc = $<HTMLElement>(".rd-disc")
        const dark = $<HTMLElement>(".rd-disc-dark")
        const knob = $<HTMLElement>(".rd-knob")
        const chip = $<HTMLElement>(".rd-chip")
        const hexEl = $<HTMLElement>(".rd-hex")
        const thumbV = $<SVGCircleElement>('[data-thumb="val"]')
        const thumbA = $<SVGCircleElement>('[data-thumb="alpha"]')
        // right arc (opacity) runs top→bottom on the right, left arc (brightness) top→bottom on the left
        const arcPath = (side: 1 | -1) => {
            const a0 = -ARC_SPAN,
                a1 = ARC_SPAN
            const p = (a: number) => `${(C + side * ARC_R * Math.cos(a)).toFixed(2)} ${(C + ARC_R * Math.sin(a)).toFixed(2)}`
            return `M ${p(a0)} A ${ARC_R} ${ARC_R} 0 0 ${side === 1 ? 1 : 0} ${p(a1)}`
        }
        el.querySelectorAll<SVGPathElement>('[data-arc="alpha"]').forEach((p) => p.setAttribute("d", arcPath(1)))
        $('[data-arc="val"]').setAttribute("d", arcPath(-1))
        $<SVGPathElement>(".rd-checker").setAttribute("stroke", "url(#rdChecker)")
        $(".rd-hex").parentElement!.addEventListener("pointerdown", (e) => e.stopPropagation())

        let h = 0,
            s = 0,
            v = 100,
            a = 100
        const hex = () => rgbToHex(...hsvToRgb(h, s, v))
        function paint() {
            const rgb = hsvToRgb(h, s, v)
            const full = rgbToHex(...rgb)
            // disc: hue around, saturation outward, darkened by (1 - brightness)
            dark.style.opacity = String(1 - v / 100)
            const ang = (h * Math.PI) / 180,
                r = (s / 100) * DISC
            knob.style.left = DISC + r * Math.cos(ang) + "px"
            knob.style.top = DISC + r * Math.sin(ang) + "px"
            knob.style.background = full
            chip.style.background = rgbaCss(full, a)
            hexEl.textContent = full.slice(1).toUpperCase()
            const bright = hsvToRgb(h, s, 100)
            el.querySelector(".rd-v1")!.setAttribute("stop-color", rgbToHex(...bright))
            el.querySelector(".rd-a1")!.setAttribute("stop-color", full)
            el.querySelector(".rd-a0")!.setAttribute("stop-color", full)
            el.querySelector(".rd-a0")!.setAttribute("stop-opacity", "0")
            const place = (th: SVGCircleElement, side: 1 | -1, t: number) => {
                const ang2 = -ARC_SPAN + t * 2 * ARC_SPAN // t: 0 top … 1 bottom
                th.setAttribute("cx", String(C + side * ARC_R * Math.cos(ang2)))
                th.setAttribute("cy", String(C + ARC_R * Math.sin(ang2)))
            }
            place(thumbV, -1, 1 - v / 100)
            place(thumbA, 1, 1 - a / 100)
            thumbA.style.fill = rgbaCss(full, a)
            thumbV.style.fill = full
        }
        /** write the current color to the frame, as one undo step per gesture */
        function commit() {
            ctx.panel.fill.setFill(hex(), a)
            if (target) refresh()
        }
        function gesture(e: PointerEvent, apply: (ev: PointerEvent) => void) {
            e.preventDefault()
            e.stopPropagation()
            ctx.panel.fill.beginGesture()
            const mv = (ev: PointerEvent) => {
                apply(ev)
                paint()
                commit()
            }
            mv(e)
            const end = () => {
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", end)
                ctx.panel.fill.endGesture()
            }
            document.addEventListener("pointermove", mv)
            document.addEventListener("pointerup", end)
        }
        disc.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return
            const place = (ev: PointerEvent) => {
                const b = disc.getBoundingClientRect()
                const dx = ev.clientX - (b.left + b.width / 2),
                    dy = ev.clientY - (b.top + b.height / 2)
                h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
                s = Math.min(100, (Math.hypot(dx, dy) / DISC) * 100)
            }
            gesture(e, place)
        })
        // the arcs: angle of the pointer around the menu center, clamped to the arc
        const arcDrag = (side: 1 | -1, set: (t: number) => void) => (e: PointerEvent) => {
            if (e.button !== 0) return
            gesture(e, (ev) => {
                const b = el.getBoundingClientRect()
                const dx = (ev.clientX - (b.left + b.width / 2)) * side,
                    dy = ev.clientY - (b.top + b.height / 2)
                const ang = Math.max(-ARC_SPAN, Math.min(ARC_SPAN, Math.atan2(dy, dx)))
                set((ang + ARC_SPAN) / (2 * ARC_SPAN))
            })
        }
        const setV = (t: number) => (v = Math.round((1 - t) * 100))
        const setA = (t: number) => (a = Math.round((1 - t) * 100))
        el.querySelector('[data-arc="val"]')!.addEventListener("pointerdown", arcDrag(-1, setV) as EventListener)
        thumbV.addEventListener("pointerdown", arcDrag(-1, setV) as EventListener)
        el.querySelectorAll('[data-arc="alpha"]').forEach((p) => p.addEventListener("pointerdown", arcDrag(1, setA) as EventListener))
        thumbA.addEventListener("pointerdown", arcDrag(1, setA) as EventListener)
        $(".rd-back").addEventListener("click", () => menu?.classList.remove("color"))

        return {
            el,
            load(f: FrameItem) {
                const [hh, ss, vv] = rgbToHsv(...hexToRgb(f.fill))
                h = hh
                s = ss
                v = vv
                a = f.alpha
                paint()
            },
        }
    }

    // right-click a frame (its body, or its name label) to open the menu
    function onContextMenu(e: MouseEvent) {
        const node = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")
        const it = node ? ctx.store.itemById(Number(node.dataset.id)) : null
        if (!it || !isFrame(it)) return
        e.preventDefault()
        if (!selection.has(it.id) || selection.size !== 1) {
            selection.clear()
            selection.add(it.id)
            emit()
        }
        open(it, e.clientX, e.clientY)
    }
    canvas.addEventListener("contextmenu", onContextMenu)

    return {
        open,
        close,
        dispose() {
            close()
            canvas.removeEventListener("contextmenu", onContextMenu)
        },
    }
}
