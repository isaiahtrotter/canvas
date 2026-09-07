// The view: pan + zoom + the pixel grid. Items live in world coords; #world
// carries translate(x,y) scale(z). --inv is 1/z so chrome that should stay
// a constant size on screen (frame labels, handles) can counter-scale.
import type { EditorContext, Disposable, Rect } from "../core/context"

export interface ViewAPI {
    applyGrid(): void
    /** Write the view transform and refresh everything that follows it (grid, minimap, overlay, measurement). */
    applyView(): void
    zoomAt(factor: number, cx: number, cy: number): void
    zoomCenter(factor: number): void
    resetView(): void
    /** The visible part of the world, in world coords. */
    viewportWorldRect(): Rect
    setSpaceDown(v: boolean): void
    startPan(e: PointerEvent): void
}

export function installView(ctx: EditorContext): ViewAPI & Disposable {
    const { root } = ctx
    const { canvas, world } = ctx.dom
    const view = ctx.doc.view

    const ZOOM_MIN = 0.1,
        ZOOM_MAX = 20 // 2000%
    const GRID_FROM = 10 // the pixel grid appears from 1000%
    const zoomVal = root.querySelector<HTMLElement>("#zoomVal")
    const grid = root.querySelector<HTMLCanvasElement>("#grid")
    /* One line per integer world coordinate, each placed at its exact screen
       position (rounded to a device pixel) so frame edges — which sit on
       integer coordinates — land on grid lines at any zoom, with no drift.

       Color: the layer composites with mix-blend-mode:difference (CSS), so a
       faint white line pushes whatever is under it — canvas, frame, text —
       toward its opposite: about 12% darker on white, 12% lighter on black,
       with no rim. One honest limit: any neutral overlay that lightens black
       and darkens white has to cross zero somewhere between, and for white
       that's exactly 50% gray, where the line fades out over a narrow band.
       (Two layers with different tones were tried; their shifts oppose each
       other between their zero points and only move the dead tone around.) */
    const GRID_LINE = "rgba(255,255,255,.12)"
    function applyGrid() {
        if (!grid) return
        const on = ctx.prefs.grid && view.z >= GRID_FROM
        grid.classList.toggle("on", on)
        if (!on) return
        const dpr = window.devicePixelRatio || 1
        const W = canvas.clientWidth,
            H = canvas.clientHeight
        const pw = Math.round(W * dpr),
            ph = Math.round(H * dpr)
        if (grid.width !== pw || grid.height !== ph) {
            grid.width = pw
            grid.height = ph
        }
        const g = grid.getContext("2d") // the 2D context — not the editor ctx
        if (!g) return
        g.clearRect(0, 0, pw, ph)
        g.fillStyle = GRID_LINE
        const z = view.z
        for (let k = Math.ceil(-view.x / z); k <= Math.floor((W - view.x) / z); k++)
            g.fillRect(Math.round((view.x + k * z) * dpr), 0, 1, ph)
        for (let k = Math.ceil(-view.y / z); k <= Math.floor((H - view.y) / z); k++)
            g.fillRect(0, Math.round((view.y + k * z) * dpr), pw, 1)
    }
    function applyView() {
        world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`
        world.style.setProperty("--inv", String(1 / view.z))
        if (zoomVal) zoomVal.textContent = Math.round(view.z * 100) + "%"
        applyGrid()
        ctx.minimap.update()
        // screen-space chrome has to follow the view
        ctx.overlay.renderSelectionOverlay()
        ctx.measure.refreshMeasure()
        ctx.persist.scheduleSave()
    }

    // the viewport rectangle is sized from canvas.clientWidth/Height, so a
    // browser resize has to redraw it too
    const canvasRO =
        typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => {
                  ctx.minimap.update()
                  ctx.overlay.renderSelectionOverlay()
                  applyGrid() // the bitmap is sized to the canvas
              })
            : null
    canvasRO?.observe(canvas)

    // zoom so the world point under canvas-relative (cx, cy) stays put
    function zoomAt(factor: number, cx: number, cy: number) {
        const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.z * factor))
        if (z === view.z) return
        view.x = cx - (cx - view.x) * (z / view.z)
        view.y = cy - (cy - view.y) * (z / view.z)
        view.z = z
        applyView()
    }
    function zoomCenter(factor: number) {
        zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2)
    }
    function resetView() {
        view.x = 0
        view.y = 0
        view.z = 1
        applyView()
    }
    // the visible part of the world, in world coords
    function viewportWorldRect() {
        return {
            x: -view.x / view.z,
            y: -view.y / view.z,
            w: canvas.clientWidth / view.z,
            h: canvas.clientHeight / view.z,
        }
    }
    canvas.addEventListener(
        "wheel",
        (e: WheelEvent) => {
            e.preventDefault()
            const r = canvas.getBoundingClientRect()
            // a pinch (ctrlKey) reports smaller deltas than a wheel notch
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
            zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
        },
        { passive: false }
    )
    /* Panning is always done through view.x/y + the #world transform — #canvas
       itself never scrolls under our own code. But while editing text near an
       edge, the browser's native "keep the caret in view" behavior scrolls
       #canvas directly, and everything our own render pipeline draws (the
       selection box, handles, and size tooltip in #overlay) is positioned
       from view.x/y alone, with no idea that #canvas has scrolled — so it
       stops tracking the text and is left stranded at its pre-scroll spot.
       Fold that scroll straight into our own pan instead of fighting it: the
       browser still decides when and how far to scroll to keep the caret
       visible, we just absorb the result into view.x/y and re-render through
       the normal path, so everything — including the selection box — moves
       together and stays in sync. */
    canvas.addEventListener("scroll", () => {
        if (!canvas.scrollLeft && !canvas.scrollTop) return
        view.x -= canvas.scrollLeft
        view.y -= canvas.scrollTop
        canvas.scrollLeft = 0
        canvas.scrollTop = 0
        applyView()
    })
    root.querySelectorAll<HTMLElement>(".zoompill [data-z]").forEach((b) => {
        b.addEventListener("click", () => {
            if (b.dataset.z === "reset") resetView()
            else zoomCenter(b.dataset.z === "+" ? 1.25 : 1 / 1.25)
        })
    })

    /* ---- panning: hold Space and drag, or drag with the middle button ---- */
    function setSpaceDown(v: boolean) {
        ctx.ui.spaceDown = v
        canvas.classList.toggle("pan-ready", v)
    }
    function startPan(e: PointerEvent) {
        canvas.classList.add("panning")
        let lx = e.clientX,
            ly = e.clientY
        function mv(ev: PointerEvent) {
            view.x += ev.clientX - lx
            view.y += ev.clientY - ly
            lx = ev.clientX
            ly = ev.clientY
            applyView()
        }
        function up() {
            canvas.classList.remove("panning")
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }
    const onWindowBlur = () => {
        setSpaceDown(false)
        ctx.measure.setAltDown(false)
    }
    window.addEventListener("blur", onWindowBlur)

    return {
        applyGrid,
        applyView,
        zoomAt,
        zoomCenter,
        resetView,
        viewportWorldRect,
        setSpaceDown,
        startPan,
        dispose() {
            window.removeEventListener("blur", onWindowBlur)
            canvasRO?.disconnect()
        },
    }
}
