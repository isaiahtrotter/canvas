// Minimap: fades in above the zoom pill once nothing is on screen. Frames
// are dots, the viewport is a rectangle; drag it to pan, click to jump.
import type { EditorContext, Disposable } from "../core/context"
import { isFrame } from "../core/types"

export interface MinimapAPI {
    update(): void
}

export function installMinimap(ctx: EditorContext): MinimapAPI & Disposable {
    const { root } = ctx
    const { canvas } = ctx.dom
    const items = ctx.doc.items
    const view = ctx.doc.view

    const minimap = root.querySelector<HTMLElement>("#minimap")
    // the minimap is exactly as wide as the zoom pill beneath it; MM_W is
    // re-measured from the pill each time the map is drawn
    let MM_W = 110
    const MM_H = 72,
        MM_PAD = 4
    const zoomPill = root.querySelector<HTMLElement>(".zoompill")
    const PILL_GAP = 12 // the zoom pill's distance from the canvas edge; the minimap sits the same distance above it
    function syncMinimapWidth() {
        if (!zoomPill || !minimap) return
        const w = zoomPill.offsetWidth - 2 // the map is content-box with a 1px border
        if (w > 0 && w !== MM_W) {
            MM_W = w
            minimap.style.width = MM_W + "px"
        }
        minimap.style.bottom = PILL_GAP + zoomPill.offsetHeight + PILL_GAP + "px"
    }
    let mmScale = 1,
        mmOx = 0,
        mmOy = 0 // world → minimap: (x - mmOx) * mmScale
    function intersects(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    }
    let mmDragging = false
    function positionMmView(v: HTMLElement, vp) {
        v.style.left = (vp.x - mmOx) * mmScale + "px"
        v.style.top = (vp.y - mmOy) * mmScale + "px"
        v.style.width = vp.w * mmScale + "px"
        v.style.height = vp.h * mmScale + "px"
    }
    function updateMinimap() {
        if (!minimap) return
        const vp = ctx.view.viewportWorldRect()
        // while the viewport rectangle is being dragged the map stays put
        // (no refit, no hide) — only the rectangle moves
        if (mmDragging) {
            const v = minimap.querySelector<HTMLElement>(".mm-view")
            if (v) positionMmView(v, vp)
            return
        }
        const anyVisible = items.some((it) => {
            const { w, h } = ctx.geo.nodeSize(it)
            return intersects({ x: it.x, y: it.y, w, h }, vp)
        })
        const show = items.length > 0 && !anyVisible
        minimap.classList.toggle("on", show)
        if (!show) return
        syncMinimapWidth()
        // fit everything plus the viewport
        const all = ctx.geo.boundsOf(items)
        const x1 = Math.min(all.x, vp.x),
            y1 = Math.min(all.y, vp.y)
        const x2 = Math.max(all.x + all.w, vp.x + vp.w),
            y2 = Math.max(all.y + all.h, vp.y + vp.h)
        mmScale = Math.min((MM_W - MM_PAD * 2) / (x2 - x1), (MM_H - MM_PAD * 2) / (y2 - y1))
        mmOx = x1 - (MM_W / mmScale - (x2 - x1)) / 2
        mmOy = y1 - (MM_H / mmScale - (y2 - y1)) / 2
        minimap.innerHTML = ""
        items.filter(isFrame).forEach((f) => {
            const d = document.createElement("i")
            d.className = "mm-dot"
            d.style.left = (f.x + f.w / 2 - mmOx) * mmScale + "px"
            d.style.top = (f.y + f.h / 2 - mmOy) * mmScale + "px"
            minimap.appendChild(d)
        })
        const v = document.createElement("div")
        v.className = "mm-view"
        positionMmView(v, vp)
        v.addEventListener("pointerdown", startMmDrag)
        minimap.appendChild(v)
    }
    // Drag the viewport rectangle to pan. It's clamped to the map's edges, so
    // you can't drag the view out past what the minimap shows.
    function startMmDrag(e: PointerEvent) {
        e.stopPropagation()
        e.preventDefault()
        mmDragging = true
        minimap.classList.add("dragging")
        const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        const vp0 = ctx.view.viewportWorldRect()
        // keep an 8px gutter so the rectangle never touches the map's edge
        const MM_GUTTER = 4
        const maxX = MM_W - MM_GUTTER - vp0.w * mmScale,
            maxY = MM_H - MM_GUTTER - vp0.h * mmScale
        function mv(ev: PointerEvent) {
            // desired rect position in minimap px, clamped inside the map
            let mx = (vp0.x - mmOx) * mmScale + (ev.clientX - start.x)
            let my = (vp0.y - mmOy) * mmScale + (ev.clientY - start.y)
            mx = Math.max(MM_GUTTER, Math.min(maxX, mx))
            my = Math.max(MM_GUTTER, Math.min(maxY, my))
            const wx = mx / mmScale + mmOx,
                wy = my / mmScale + mmOy
            view.x = -wx * view.z
            view.y = -wy * view.z
            ctx.view.applyView()
        }
        function up() {
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            mmDragging = false
            minimap.classList.remove("dragging")
            updateMinimap() // refit (and possibly hide) now that the drag is over
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }
    minimap?.addEventListener("click", (e: MouseEvent) => {
        if ((e.target as HTMLElement).classList.contains("mm-view")) return
        const r = minimap.getBoundingClientRect()
        const wx = (e.clientX - r.left) / mmScale + mmOx
        const wy = (e.clientY - r.top) / mmScale + mmOy
        // center the viewport on the clicked world point
        view.x = canvas.clientWidth / 2 - wx * view.z
        view.y = canvas.clientHeight / 2 - wy * view.z
        ctx.view.applyView()
    })

    return { update: updateMinimap }
}
