import { useEffect, useRef } from "react"
import { mountEditor } from "../editor/engine"
import "../editor/editor.css"

interface EditorProps {
    canvasColor?: string
    cornerRadius?: number
    borderColor?: string
}

/**
 * React shell around the vanilla-DOM editor engine. The engine mounts once
 * (empty dep array) so items, selection, and undo history survive re-renders;
 * the second effect only paints the cosmetic props onto the mounted DOM.
 */
export function Editor({
    canvasColor = "#fafaf9",
    cornerRadius = 10,
    borderColor = "#dedede",
}: EditorProps) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const root = ref.current
        if (!root) return
        return mountEditor(root)
    }, [])

    useEffect(() => {
        const root = ref.current
        if (!root) return
        const appEl = root.querySelector<HTMLElement>(".app")
        if (appEl) {
            appEl.style.borderRadius = cornerRadius + "px"
            appEl.style.borderColor = borderColor
        }
        // backgroundColor only (not the `background` shorthand) so any
        // background-image from the CSS class survives untouched.
        const canvasEl = root.querySelector<HTMLElement>("#canvas")
        if (canvasEl) canvasEl.style.backgroundColor = canvasColor
    }, [canvasColor, cornerRadius, borderColor])

    return <div ref={ref} style={{ width: "100%", height: "100%" }} />
}
