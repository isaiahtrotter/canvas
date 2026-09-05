import { useEffect, useRef, useState } from "react"
import { mountEditor, type EditorAPI, type Fill, type FillMode } from "../editor/engine"
import ColorPicker from "./ColorPicker"
import FontDropdown from "./FontDropdown"
import "../editor/editor.css"

interface EditorProps {
    cornerRadius?: number
}

interface PickerState extends Fill {
    mode: FillMode
    top: number
}

interface FontPickerState {
    options: string[]
    value: string
    top: number
}

/**
 * React shell around the vanilla-DOM editor engine. The engine mounts once
 * (empty dep array) so items, selection, and undo history survive re-renders;
 * a second effect only paints the cosmetic props onto the mounted DOM.
 *
 * The one piece of UI React owns is the fill color picker: the engine reports
 * swatch clicks and fill/background changes through hooks, and we push
 * colors back through the returned API. The canvas background color itself
 * is owned by the engine (via the Fill row, once nothing is selected) — not
 * a prop here.
 */
export function Editor({ cornerRadius = 0 }: EditorProps) {
    const ref = useRef<HTMLDivElement>(null)
    const wrapRef = useRef<HTMLDivElement>(null)
    const pickerRef = useRef<HTMLDivElement>(null)
    const fontPickerRef = useRef<HTMLDivElement>(null)
    const api = useRef<EditorAPI | null>(null)
    const [picker, setPicker] = useState<PickerState | null>(null)
    const [fontPicker, setFontPicker] = useState<FontPickerState | null>(null)

    useEffect(() => {
        const root = ref.current
        if (!root) return
        api.current = mountEditor(root, {
            onFillOpen: (anchor, fill, mode) => {
                const wrap = wrapRef.current!.getBoundingClientRect()
                setFontPicker(null) // only one floating panel at a time
                setPicker((p) => {
                    if (p) return null // clicking the swatch again closes it
                    if (mode === "selection") api.current?.beginFillGesture()
                    return { ...fill, mode, top: anchor.top - wrap.top }
                })
            },
            onFillChange: (fill, mode) => {
                setPicker((p) => {
                    if (!p) return p
                    // selection emptied (or filled) while open — the row now
                    // means something else, so close rather than retarget
                    if (mode !== p.mode) return null
                    return { ...p, ...fill }
                })
            },
            onFontOpen: (anchor, options, value) => {
                const wrap = wrapRef.current!.getBoundingClientRect()
                setPicker(null) // only one floating panel at a time
                setFontPicker((p) => (p ? null : { options, value, top: anchor.top - wrap.top }))
            },
            onFontChange: (value) => {
                setFontPicker((p) => (p ? { ...p, value } : p))
            },
        })
        return () => {
            api.current?.destroy()
            api.current = null
        }
    }, [])

    useEffect(() => {
        const root = ref.current
        if (!root) return
        const appEl = root.querySelector<HTMLElement>(".app")
        if (appEl) appEl.style.borderRadius = cornerRadius + "px"
    }, [cornerRadius])

    // Close on outside click / Escape; mirror open state onto the swatch row.
    useEffect(() => {
        const row = ref.current?.querySelector<HTMLElement>("#fillRow")
        row?.classList.toggle("open", !!picker)
        if (!picker) return
        const down = (e: PointerEvent) => {
            const t = e.target as Node
            if (pickerRef.current?.contains(t) || row?.contains(t)) return
            setPicker(null)
        }
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") setPicker(null)
        }
        document.addEventListener("pointerdown", down, true)
        document.addEventListener("keydown", key, true)
        return () => {
            document.removeEventListener("pointerdown", down, true)
            document.removeEventListener("keydown", key, true)
            api.current?.endFillGesture()
        }
    }, [!!picker])

    // Same, for the font list — a separate effect since it's a separate
    // floating panel with its own open state and anchor row.
    useEffect(() => {
        const row = ref.current?.querySelector<HTMLElement>("#fontRow")
        row?.classList.toggle("open", !!fontPicker)
        if (!fontPicker) return
        const down = (e: PointerEvent) => {
            const t = e.target as Node
            if (fontPickerRef.current?.contains(t) || row?.contains(t)) return
            setFontPicker(null)
        }
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") setFontPicker(null)
        }
        document.addEventListener("pointerdown", down, true)
        document.addEventListener("keydown", key, true)
        return () => {
            document.removeEventListener("pointerdown", down, true)
            document.removeEventListener("keydown", key, true)
        }
    }, [!!fontPicker])

    return (
        <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%" }}>
            <div ref={ref} style={{ width: "100%", height: "100%" }} />
            {picker && (
                <div
                    ref={pickerRef}
                    style={{
                        position: "absolute",
                        right: "calc(var(--right-w, 230px) + 8px)", // just left of the (resizable) sidebar
                        top: Math.max(8, Math.min(picker.top, (wrapRef.current?.clientHeight ?? 600) - 520)),
                        zIndex: 40,
                        fontFamily: "'Inter', system-ui, sans-serif",
                    }}
                >
                    <ColorPicker
                        hex={picker.hex}
                        alpha={picker.alpha}
                        onChange={(hex, alpha) => {
                            setPicker((p) => (p ? { ...p, hex, alpha } : p))
                            api.current?.setFill(hex, alpha)
                        }}
                    />
                </div>
            )}
            {fontPicker && (
                <div
                    ref={fontPickerRef}
                    style={{
                        position: "absolute",
                        right: "calc(var(--right-w, 230px) + 8px)", // just left of the (resizable) sidebar
                        top: Math.max(8, Math.min(fontPicker.top, (wrapRef.current?.clientHeight ?? 600) - 220)),
                        zIndex: 40,
                    }}
                >
                    <FontDropdown
                        options={fontPicker.options}
                        value={fontPicker.value}
                        onSelect={(font) => {
                            api.current?.setFont(font)
                            setFontPicker(null) // a font list closes once you pick one
                        }}
                    />
                </div>
            )}
        </div>
    )
}
