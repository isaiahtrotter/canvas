// Right-click a frame: a ring of capsules, one per property. Fill and Stroke
// color open a round color picker in place of the ring; Stroke width, Opacity
// and Radius (all four corners at once) are scrubbed by pressing the capsule
// and dragging sideways — the capsule's length follows the value. One undo
// step per gesture. Escape or a click outside closes it.
import type { EditorContext, Disposable } from "../core/context"
import { type FrameItem, isFrame } from "../core/types"
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, rgbaCss, relativeLuminance } from "../color"

export interface RadialAPI {
    open(it: FrameItem, x: number, y: number): void
    close(): void
}

const SIZE = 300,
    C = SIZE / 2,
    RING_R = 100, // centerline of the capsules
    CAP_W = 58 // capsule thickness
const NS = "http://www.w3.org/2000/svg"
const SLOT = (Math.PI * 2) / 5
const CAP_ANG = CAP_W / 2 / RING_R // what a round cap adds at each end, in radians
const MAX_HALF = SLOT / 2 - CAP_ANG - 0.05 // path half-length of a full capsule
const MIN_SCALE = 0.04
const MAX_STROKE = 40
const DEFAULT_STROKE = "#1c1c1c"

type Prop = "fill" | "strokeColor" | "strokeWidth" | "opacity" | "radius"
const PROPS: Array<{ id: Prop; label: string; tone: string; icon: string }> = [
    { id: "fill", label: "Fill", tone: "#ffffff", icon: '<path d="M10 2.8C10 2.8 4.6 8.7 4.6 12.3a5.4 5.4 0 0 0 10.8 0C15.4 8.7 10 2.8 10 2.8Z"/>' },
    { id: "strokeColor", label: "Stroke color", tone: "#1c1c1c", icon: '<rect x="3.5" y="3.5" width="13" height="13" rx="4"/><rect x="7" y="7" width="6" height="6" rx="2" opacity=".45"/>' },
    { id: "strokeWidth", label: "Stroke width", tone: "#5b78c7", icon: '<path d="M3.5 5h13M3.5 10h13M3.5 15.5h13" stroke-width="1"/><path d="M3.5 10h13" stroke-width="2.2"/><path d="M3.5 15.5h13" stroke-width="3.4"/>' },
    { id: "opacity", label: "Opacity", tone: "#8e6bbf", icon: '<circle cx="10" cy="10" r="6.6"/><path d="M10 3.4v13.2a6.6 6.6 0 0 1 0-13.2Z" fill="currentColor" stroke="none"/>' },
    { id: "radius", label: "Radius", tone: "#e8793c", icon: '<path d="M4 16.5V10a6 6 0 0 1 6-6h6.5"/>' },
]

// color view geometry
const DISC = 92 // hue/saturation disc radius
const ARC_R = 116 // brightness / opacity arc radius
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
    const radiusOf = (f: FrameItem) => (typeof f.radius === "number" ? f.radius : f.radius ? Math.max(...f.radius) : 0)
    const strokeOf = (f: FrameItem) => f.stroke ?? DEFAULT_STROKE
    const strokeWidthOf = (f: FrameItem) => f.strokeWidth ?? 0
    const maxRadius = (f: FrameItem) => Math.max(1, Math.floor(Math.min(f.w, f.h) / 2))

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
    function drag(e: PointerEvent, move: (dx: number) => void, up?: () => void) {
        const startX = e.clientX
        const mv = (ev: PointerEvent) => move(ev.clientX - startX)
        const end = () => {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", end)
            up?.()
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", end)
    }

    const capPath = (i: number, scale: number) => {
        const mid = -Math.PI / 2 + i * SLOT
        const half = MAX_HALF * Math.max(MIN_SCALE, Math.min(1, scale))
        const p = (a: number) => `${(C + RING_R * Math.cos(a)).toFixed(2)} ${(C + RING_R * Math.sin(a)).toFixed(2)}`
        return `M ${p(mid - half)} A ${RING_R} ${RING_R} 0 0 1 ${p(mid + half)}`
    }

    function open(it: FrameItem, x: number, y: number) {
        close()
        target = it
        const f = it
        menu = document.createElement("div")
        menu.className = "radial"
        const half = SIZE / 2 + 12
        const cx = Math.max(half, Math.min(window.innerWidth - half, x))
        const cy = Math.max(half, Math.min(window.innerHeight - half, y))
        menu.style.left = cx - SIZE / 2 + "px"
        menu.style.top = cy - SIZE / 2 + "px"
        menu.style.width = menu.style.height = SIZE + "px"

        const svg = svgEl("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, class: "rd-ring" })
        const caps = {} as Record<Prop, { path: SVGPathElement; icon: SVGGElement; g: SVGGElement }>
        PROPS.forEach((p, i) => {
            const g = svgEl("g", { class: "rd-cap" })
            g.dataset.prop = p.id
            const path = svgEl("path", { d: capPath(i, 1), "stroke-width": String(CAP_W), class: "rd-capsule" })
            const mid = -Math.PI / 2 + i * SLOT
            const icon = svgEl("g", { class: "rd-icon", transform: `translate(${C + RING_R * Math.cos(mid) - 10} ${C + RING_R * Math.sin(mid) - 10})` })
            icon.innerHTML = p.icon
            const title = svgEl("title")
            title.textContent = p.label
            g.append(path, icon, title)
            svg.appendChild(g)
            caps[p.id] = { path, icon, g }
            g.addEventListener("pointerdown", (e) => onCapDown(e as PointerEvent, p.id, i))
        })
        menu.appendChild(svg)
        const tip = document.createElement("div")
        tip.className = "rd-tip"
        menu.appendChild(tip)

        const color = buildColorView()
        menu.appendChild(color.el)
        color.onBack = () => menu!.classList.remove("color")

        refresh = () => {
            const tint = (id: Prop, hex: string, scale: number, i: number) => {
                const c = caps[id]
                c.path.style.stroke = hex
                if (scale >= 0) c.path.setAttribute("d", capPath(i, scale))
                c.icon.style.color = relativeLuminance(hexToRgb(hex)) > 0.55 ? "#1c1c1c" : "#fff"
            }
            // fill & stroke show their real color; the rest keep their own tones and grow with the value
            const fillTone = rgbaCss(f.fill, 100)
            tint("fill", f.fill, 1, 0)
            caps.fill.path.style.stroke = fillTone
            tint("strokeColor", strokeOf(f), 1, 1)
            tint("strokeWidth", PROPS[2].tone, strokeWidthOf(f) / MAX_STROKE, 2)
            tint("opacity", PROPS[3].tone, opacityOf(f) / 100, 3)
            tint("radius", PROPS[4].tone, radiusOf(f) / maxRadius(f), 4)
        }
        refresh()

        // the dark value pill (like the unit pill in the reference), just outside the capsule
        function showTip(i: number, text: string) {
            const mid = -Math.PI / 2 + i * SLOT
            const r = RING_R + CAP_W / 2 + 14
            tip.style.left = C + r * Math.cos(mid) + "px"
            tip.style.top = C + r * Math.sin(mid) + "px"
            tip.textContent = text
            tip.classList.add("on")
        }

        function scrub(e: PointerEvent, id: Prop, i: number, get: () => number, set: (dx: number, start: number) => number | null, text: (v: number) => string) {
            const start = get()
            const pre = ctx.store.snapshot()
            let moved = false
            caps[id].g.classList.add("active")
            showTip(i, text(start))
            drag(
                e,
                (dx) => {
                    const v = set(dx, start)
                    if (v === null) return
                    if (!moved) {
                        moved = true
                        ctx.store.pushHistory(pre)
                    }
                    f.updatedAt = Date.now()
                    showTip(i, text(v))
                    refresh()
                    emit()
                },
                () => {
                    caps[id].g.classList.remove("active")
                    tip.classList.remove("on")
                }
            )
        }

        function onCapDown(e: PointerEvent, id: Prop, i: number) {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            if (id === "fill") {
                color.load(f.fill, f.alpha, true, {
                    apply: (hex, a) => ctx.panel.fill.setFill(hex, a),
                    begin: () => ctx.panel.fill.beginGesture(),
                    end: () => ctx.panel.fill.endGesture(),
                })
                menu!.classList.add("color")
                return
            }
            if (id === "strokeColor") {
                let pre: ReturnType<typeof ctx.store.snapshot> | null = null
                color.load(strokeOf(f), 100, false, {
                    apply: (hex) => {
                        if (hex === f.stroke) return
                        if (pre) {
                            ctx.store.pushHistory(pre)
                            pre = null
                        }
                        f.stroke = hex
                        if (!f.strokeWidth) f.strokeWidth = 1 // a color with no width would show nothing
                        f.updatedAt = Date.now()
                        emit()
                    },
                    begin: () => (pre = ctx.store.snapshot()),
                    end: () => (pre = null),
                })
                menu!.classList.add("color")
                return
            }
            if (id === "opacity")
                scrub(e, id, i, () => opacityOf(f), (dx, s) => {
                    const v = Math.max(0, Math.min(100, Math.round(s + dx / 2)))
                    if (v === opacityOf(f)) return null
                    f.opacity = v
                    return v
                }, (v) => v + "%")
            else if (id === "strokeWidth")
                scrub(e, id, i, () => strokeWidthOf(f), (dx, s) => {
                    const v = Math.max(0, Math.min(MAX_STROKE, Math.round(s + dx / 6)))
                    if (v === strokeWidthOf(f)) return null
                    f.strokeWidth = v
                    return v
                }, (v) => v + " px")
            else
                scrub(e, id, i, () => radiusOf(f), (dx, s) => {
                    const v = Math.max(0, Math.min(maxRadius(f), Math.round(s + dx / ctx.doc.view.z)))
                    if (v === radiusOf(f) && typeof f.radius === "number") return null
                    f.radius = v // all four corners together
                    return v
                }, (v) => v + " px")
        }

        ctx.root.appendChild(menu)
        document.addEventListener("pointerdown", onOutside, true)
        document.addEventListener("keydown", onKey, true)
    }

    /* ---- the round color picker ---- */
    function buildColorView() {
        // what the picker is currently editing: set by load()
        const session = { apply: (_hex: string, _a: number) => {}, begin: () => {}, end: () => {}, hasAlpha: true }
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
            session.apply(hex(), a)
            refresh()
        }
        function gesture(e: PointerEvent, apply: (ev: PointerEvent) => void) {
            e.preventDefault()
            e.stopPropagation()
            session.begin()
            const mv = (ev: PointerEvent) => {
                apply(ev)
                paint()
                commit()
            }
            mv(e)
            const end = () => {
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", end)
                session.end()
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
        $(".rd-back").addEventListener("click", () => api.onBack())

        const api = {
            el,
            onBack: () => {},
            load(hex: string, alpha: number, hasAlpha: boolean, hooks: Pick<typeof session, "apply" | "begin" | "end">) {
                Object.assign(session, hooks, { hasAlpha })
                el.classList.toggle("no-alpha", !hasAlpha)
                const [hh, ss, vv] = rgbToHsv(...hexToRgb(hex))
                h = hh
                s = ss
                v = vv
                a = alpha
                paint()
            },
        }
        return api
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
