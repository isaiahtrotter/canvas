// Right-click a frame: a box menu. A miniature of the frame sits on top with
// a handle in each corner — drag one inward and a circle grows in the corner
// to show the radius (Shift moves all four together). Below it: an opacity
// slider, and a Fill row that swaps the box for a round color picker (hue /
// saturation disc, with brightness and opacity arcs around it).
// One undo step per gesture. Escape or a click outside closes it.
import type { EditorContext, Disposable } from "../core/context"
import { type FrameItem, isFrame } from "../core/types"
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, rgbaCss } from "../color"

export interface BoxMenuAPI {
    open(it: FrameItem, x: number, y: number): void
    close(): void
}

const W = 280, // menu width
    SIZE = 272, // the color picker's square
    C = SIZE / 2
const PREVIEW_W = 240,
    PREVIEW_H = 150
type Corners = [number, number, number, number] // [tl, tr, br, bl]
const CORNERS = ["tl", "tr", "br", "bl"] as const

// color view geometry
const DISC = 92 // hue/saturation disc radius
const ARC_R = 116 // brightness / opacity arc radius
const ARC_SPAN = (75 * Math.PI) / 180 // each arc reaches this far above and below the horizontal

export function installBoxMenu(ctx: EditorContext): BoxMenuAPI & Disposable {
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
    function track(e: PointerEvent, move: (ev: PointerEvent) => void, up?: () => void) {
        const mv = (ev: PointerEvent) => move(ev)
        const end = () => {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", end)
            up?.()
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", end)
        move(e)
    }

    function open(it: FrameItem, x: number, y: number) {
        close()
        target = it
        menu = document.createElement("div")
        menu.className = "bm"
        menu.style.width = W + "px"
        menu.innerHTML = `
          <div class="bm-main">
            <div class="bm-stage">
              <div class="bm-checker"></div>
              <div class="bm-box"></div>
              <div class="bm-readout"></div>
            </div>
            <div class="bm-row"><span class="bm-key">Opacity</span>
              <div class="bm-slider"><div class="bm-slider-fill"></div><div class="bm-slider-thumb"></div></div>
              <span class="bm-val bm-opval"></span></div>
            <button class="bm-row bm-fill" type="button"><span class="bm-key">Fill</span>
              <span class="bm-chip"></span><span class="bm-hex"></span><span class="bm-val bm-alval"></span></button>
          </div>`
        const q = <T extends Element>(sel: string) => menu!.querySelector<T>(sel)!
        const stage = q<HTMLElement>(".bm-stage")
        const box = q<HTMLElement>(".bm-box")
        const readout = q<HTMLElement>(".bm-readout")
        const slider = q<HTMLElement>(".bm-slider")
        const f = it

        // the miniature: scaled to fit, corner handles + circles drawn over it
        const s = Math.min(PREVIEW_W / f.w, PREVIEW_H / f.h)
        const pw = f.w * s,
            ph = f.h * s
        box.style.width = pw + "px"
        box.style.height = ph + "px"
        const circles: HTMLElement[] = [],
            handles: HTMLElement[] = []
        CORNERS.forEach((c, i) => {
            const circle = document.createElement("div")
            circle.className = "bm-circle"
            const h = document.createElement("div")
            h.className = "bm-handle"
            h.style.cursor = i % 2 === 0 ? "nwse-resize" : "nesw-resize"
            h.title = "Drag to round this corner (Shift: all corners)"
            h.addEventListener("pointerdown", (e) => onHandleDown(e, i))
            box.append(circle, h)
            circles.push(circle)
            handles.push(h)
        })

        refresh = () => {
            const c = cornersOf(f)
            // opacity goes into the background alpha so the handles stay fully visible
            box.style.background = rgbaCss(f.fill, (f.alpha * opacityOf(f)) / 100)
            box.style.borderRadius = c.map((r) => r * s + "px").join(" ")
            c.forEach((r, i) => {
                const rp = r * s
                const left = i === 0 || i === 3,
                    top = i === 0 || i === 1
                // circle of radius r tucked into the corner; its center is where the handle sits
                const set = (el: HTMLElement, size: number) => {
                    el.style.left = left ? "" : "auto"
                    el.style.top = top ? "" : "auto"
                    el.style.right = left ? "auto" : "0"
                    el.style.bottom = top ? "auto" : "0"
                    if (left) el.style.left = "0"
                    if (top) el.style.top = "0"
                    el.style.width = el.style.height = size + "px"
                }
                set(circles[i], rp * 2)
                circles[i].style.display = r > 0 ? "" : "none"
                const hs = handles[i]
                hs.style.left = hs.style.top = hs.style.right = hs.style.bottom = "auto"
                if (left) hs.style.left = rp + "px"
                else hs.style.right = rp + "px"
                if (top) hs.style.top = rp + "px"
                else hs.style.bottom = rp + "px"
            })
            q(".bm-opval").textContent = opacityOf(f) + "%"
            q<HTMLElement>(".bm-slider-fill").style.width = opacityOf(f) + "%"
            q<HTMLElement>(".bm-slider-thumb").style.left = opacityOf(f) + "%"
            q<HTMLElement>(".bm-chip").style.background = rgbaCss(f.fill, f.alpha)
            q(".bm-hex").textContent = f.fill.replace("#", "").toUpperCase()
            q(".bm-alval").textContent = f.alpha + "%"
        }
        refresh()

        function onHandleDown(e: PointerEvent, corner: number) {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            const all = e.shiftKey
            const start = cornersOf(f)
            const pre = ctx.store.snapshot()
            let moved = false
            const max = maxRadius(f)
            const sel = all ? circles : [circles[corner]]
            sel.forEach((c) => c.classList.add("active"))
            const left = corner === 0 || corner === 3,
                top = corner === 0 || corner === 1
            track(
                e,
                (ev) => {
                    // inward distance from the grabbed corner, along the diagonal
                    const b = box.getBoundingClientRect()
                    const ix = left ? ev.clientX - b.left : b.right - ev.clientX
                    const iy = top ? ev.clientY - b.top : b.bottom - ev.clientY
                    const r = Math.max(0, Math.min(max, Math.round((ix + iy) / 2 / s)))
                    const next = start.map((v, i) => (all || i === corner ? r : v)) as Corners
                    readout.textContent = String(r)
                    const cur = cornersOf(f)
                    if (next.every((v, i) => v === cur[i])) return
                    if (!moved) {
                        moved = true
                        ctx.store.pushHistory(pre)
                    }
                    f.radius = next.every((v) => v === next[0]) ? next[0] : next
                    f.updatedAt = Date.now()
                    refresh()
                    emit()
                },
                () => {
                    sel.forEach((c) => c.classList.remove("active"))
                    readout.textContent = ""
                }
            )
        }

        // opacity slider
        slider.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            const pre = ctx.store.snapshot()
            let moved = false
            track(e, (ev) => {
                const b = slider.getBoundingClientRect()
                const v = Math.max(0, Math.min(100, Math.round(((ev.clientX - b.left) / b.width) * 100)))
                if (v === opacityOf(f)) return
                if (!moved) {
                    moved = true
                    ctx.store.pushHistory(pre)
                }
                f.opacity = v
                f.updatedAt = Date.now()
                refresh()
                emit()
            })
        })

        // fill: the round picker takes over the box
        const color = buildColorView()
        menu.appendChild(color.el)
        q(".bm-fill").addEventListener("click", () => {
            color.load(f)
            menu!.classList.add("color")
            clamp()
        })

        ctx.root.appendChild(menu)
        // keep the whole menu on screen (it grows when the color picker is showing)
        let px = x,
            py = y
        const clamp = () => {
            const mb = menu!.getBoundingClientRect()
            menu!.style.left = Math.max(8, Math.min(window.innerWidth - mb.width - 8, px)) + "px"
            menu!.style.top = Math.max(8, Math.min(window.innerHeight - mb.height - 8, py)) + "px"
        }
        clamp()
        color.onBack = () => {
            menu!.classList.remove("color")
            clamp()
        }
        document.addEventListener("pointerdown", onOutside, true)
        document.addEventListener("keydown", onKey, true)
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
        $(".rd-back").addEventListener("click", () => api.onBack())

        const api = {
            el,
            onBack: () => {},
            load(f: FrameItem) {
                const [hh, ss, vv] = rgbToHsv(...hexToRgb(f.fill))
                h = hh
                s = ss
                v = vv
                a = f.alpha
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
