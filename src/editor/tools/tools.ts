// Tools (V = move/select, F = draw a frame, T = place text) and the toast.
// The active tool is on ctx.ui.tool because pointer handlers and the keymap
// read it on every event.
import type { EditorContext, Disposable } from "../core/context"
import type { Tool } from "../core/types"

export interface ToolsAPI {
    setTool(t: Tool): void
    showToast(msg: string): void
}

export function installTools(ctx: EditorContext): ToolsAPI & Disposable {
    const { root } = ctx
    const { canvas } = ctx.dom

    function setTool(t: Tool) {
        ctx.ui.tool = t
        canvas.classList.toggle("tool-frame", t === "frame")
        canvas.classList.toggle("tool-text", t === "text")
        root.querySelectorAll<HTMLElement>(".toolpill [data-tool]").forEach(
            (b) => b.classList.toggle("active", b.dataset.tool === t)
        )
    }
    root.querySelectorAll<HTMLElement>(".toolpill [data-tool]").forEach((b) =>
        b.addEventListener("click", () => setTool(b.dataset.tool as Tool))
    )

    /* ---- toast ---- */
    const toastEl = root.querySelector<HTMLElement>("#toast")
    let toastTimer = null
    function showToast(msg: string) {
        toastEl.textContent = msg
        toastEl.classList.add("show")
        clearTimeout(toastTimer)
        toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800)
    }

    return {
        setTool,
        showToast,
        dispose() {
            clearTimeout(toastTimer)
        },
    }
}
