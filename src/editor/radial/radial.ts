// Right-click a frame: a radial menu with three wedges — Fill (opens the
// host's color picker), Opacity and Radius (press the wedge and drag
// sideways to scrub; one undo step per gesture). The menu stays up so
// several properties can be adjusted in a row; Escape or a click outside
// closes it.
import type { EditorContext, Disposable } from "../core/context"
import { type FrameItem, isFrame } from "../core/types"
import { rgbaCss } from "../color"

export interface RadialAPI {
    open(it: FrameItem, x: number, y: number): void
    close(): void
}

const SIZE = 220,
    C = SIZE / 2,
    R_IN = 42,
    R_OUT = 104,
    GAP = 0.04 // radians trimmed from each wedge edge
const NS = "http://www.w3.org/2000/svg"
const WEDGES = ["fill", "opacity", "radius"] as const
type Wedge = (typeof WEDGES)[number]
const LABEL: Record<Wedge, string> = { fill: "Fill", opacity: "Opacity", radius: "Radius" }
const SCRUB_PX_PER_UNIT = 2 // screen px of horizontal drag per opacity point

export function installRadial(ctx: EditorContext): RadialAPI & Disposable {
    const { hooks } = ctx
    const { canvas } = ctx.dom
    const selection = ctx.doc.selection
    const { emit } = ctx.bus

    let menu: HTMLDivElement | null = null
    let target: FrameItem | null = null
    let refresh: () => void = () => {}

    const opacityOf = (f: FrameItem) => f.opacity ?? 100
    const radiusOf = (f: FrameItem) => f.radius ?? 0
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

        const svg = document.createElementNS(NS, "svg")
        svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`)
        const slice = (Math.PI * 2) / WEDGES.length
        const els = {} as Record<Wedge, { g: SVGGElement; value: SVGTextElement; swatch?: SVGCircleElement }>
        WEDGES.forEach((w, i) => {
            const a0 = -Math.PI / 2 - slice / 2 + i * slice
            const a1 = a0 + slice
            const g = document.createElementNS(NS, "g")
            g.setAttribute("class", "rd-wedge")
            g.dataset.wedge = w
            const p = document.createElementNS(NS, "path")
            p.setAttribute("d", wedgePath(a0, a1))
            g.appendChild(p)
            const mid = (a0 + a1) / 2
            const rm = (R_IN + R_OUT) / 2
            const mx = C + rm * Math.cos(mid),
                my = C + rm * Math.sin(mid)
            const label = document.createElementNS(NS, "text")
            label.setAttribute("class", "rd-label")
            label.setAttribute("x", String(mx))
            label.setAttribute("y", String(my - 5))
            label.textContent = LABEL[w]
            const value = document.createElementNS(NS, "text")
            value.setAttribute("class", "rd-value")
            value.setAttribute("x", String(mx))
            value.setAttribute("y", String(my + 11))
            g.append(label, value)
            let swatch: SVGCircleElement | undefined
            if (w === "fill") {
                swatch = document.createElementNS(NS, "circle")
                swatch.setAttribute("class", "rd-swatch")
                swatch.setAttribute("cx", String(mx))
                swatch.setAttribute("cy", String(my + 10))
                swatch.setAttribute("r", "8")
                g.appendChild(swatch)
            }
            svg.appendChild(g)
            els[w] = { g, value, swatch }
            g.addEventListener("pointerdown", (e) => onWedgeDown(e as PointerEvent, w))
        })
        const hub = document.createElementNS(NS, "text")
        hub.setAttribute("class", "rd-hub")
        hub.setAttribute("x", String(C))
        hub.setAttribute("y", String(C + 4))
        svg.appendChild(hub)
        menu.appendChild(svg)

        refresh = () => {
            if (!target) return
            els.opacity.value.textContent = opacityOf(target) + "%"
            els.radius.value.textContent = String(Math.round(radiusOf(target)))
            els.fill.swatch!.style.fill = rgbaCss(target.fill, target.alpha)
            els.fill.value.textContent = ""
        }
        refresh()
        ctx.root.appendChild(menu)
        document.addEventListener("pointerdown", onOutside, true)
        document.addEventListener("keydown", onKey, true)
        ;(menu as any)._hub = hub
    }

    function onWedgeDown(e: PointerEvent, w: Wedge) {
        if (e.button !== 0 || !target) return
        e.preventDefault()
        e.stopPropagation()
        const f = target
        if (w === "fill") {
            if (!hooks.onFillOpen) return
            hooks.onFillOpen(menu!.getBoundingClientRect(), { hex: f.fill, alpha: f.alpha }, "selection")
            return
        }
        const hub = (menu as any)._hub as SVGTextElement
        const startX = e.clientX
        const start = w === "opacity" ? opacityOf(f) : radiusOf(f)
        const pre = ctx.store.snapshot()
        let moved = false
        menu!.classList.add("scrubbing")
        menu!.querySelector(`[data-wedge="${w}"]`)!.classList.add("active")
        function mv(ev: PointerEvent) {
            const dx = ev.clientX - startX
            let v: number
            if (w === "opacity") v = Math.max(0, Math.min(100, Math.round(start + dx / SCRUB_PX_PER_UNIT)))
            else v = Math.max(0, Math.min(maxRadius(f), Math.round(start + dx / ctx.doc.view.z)))
            if (v === (w === "opacity" ? opacityOf(f) : radiusOf(f))) return
            if (!moved) {
                moved = true
                ctx.store.pushHistory(pre)
            }
            if (w === "opacity") f.opacity = v
            else f.radius = v
            f.updatedAt = Date.now()
            hub.textContent = w === "opacity" ? v + "%" : String(v)
            refresh()
            emit()
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            menu?.classList.remove("scrubbing")
            menu?.querySelector(".rd-wedge.active")?.classList.remove("active")
            if (hub) hub.textContent = ""
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
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
