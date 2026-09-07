// Coordinate helpers. Items live in world units; #world carries
// translate(view.x, view.y) scale(view.z). Anything drawn in #overlay is in
// canvas-relative screen pixels.
import type { EditorContext, GeometryAPI, Rect } from "./context"

export type CoordsAPI = Pick<GeometryAPI, "toWorld" | "toScreen" | "placeScreenRect">

export function createCoords(ctx: EditorContext): CoordsAPI {
    const { canvas } = ctx.dom
    const view = ctx.doc.view

    function toWorld(clientX: number, clientY: number) {
        const r = canvas.getBoundingClientRect()
        return {
            x: (clientX - r.left - view.x) / view.z,
            y: (clientY - r.top - view.y) / view.z,
        }
    }
    // world → canvas-relative screen coords
    function toScreen(x: number, y: number) {
        return { x: view.x + x * view.z, y: view.y + y * view.z }
    }
    function placeScreenRect(el: HTMLElement, r: Rect) {
        const p = toScreen(r.x, r.y)
        // snap edges to whole pixels so the 1px strokes stay crisp
        const l = Math.round(p.x),
            t = Math.round(p.y)
        el.style.left = l + "px"
        el.style.top = t + "px"
        el.style.width = Math.round(p.x + r.w * view.z) - l + "px"
        el.style.height = Math.round(p.y + r.h * view.z) - t + "px"
    }

    return { toWorld, toScreen, placeScreenRect }
}
