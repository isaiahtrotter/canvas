// User preferences: UI theme, display name, sidebar layout, pixel grid.
// Separate from the document (canvas.doc.v1) — these describe the person,
// not the drawing. Loaded once into ctx.prefs and mutated in place.

export type Theme = "light" | "dark" | "system"

export interface Prefs {
    theme: Theme
    name: string
    grid: boolean
    leftPanel: boolean
    rightPanel: boolean
    leftWidth: number
    rightWidth: number
}

export const PREFS_KEY = "canvas.prefs.v1"
// sidebar widths: each drags between its default and a cap
export const LEFT_W = { min: 200, max: 450 },
    RIGHT_W = { min: 230, max: 350 }
export const clampW = (v: number, r: { min: number; max: number }) => Math.round(Math.max(r.min, Math.min(r.max, v)))

export function loadPrefs(): Prefs {
    const prefs: Prefs = {
        theme: "system",
        name: "",
        grid: true,
        leftPanel: true,
        rightPanel: true,
        leftWidth: LEFT_W.min,
        rightWidth: RIGHT_W.min,
    }
    try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (raw) {
            const p = JSON.parse(raw)
            if (p.theme === "light" || p.theme === "dark" || p.theme === "system") prefs.theme = p.theme
            if (typeof p.name === "string") prefs.name = p.name.slice(0, 40)
            if (typeof p.grid === "boolean") prefs.grid = p.grid
            if (typeof p.leftPanel === "boolean") prefs.leftPanel = p.leftPanel
            if (typeof p.rightPanel === "boolean") prefs.rightPanel = p.rightPanel
            if (typeof p.leftWidth === "number") prefs.leftWidth = clampW(p.leftWidth, LEFT_W)
            if (typeof p.rightWidth === "number") prefs.rightWidth = clampW(p.rightWidth, RIGHT_W)
        }
    } catch (_) {
        /* defaults */
    }
    return prefs
}

export function savePrefs(prefs: Prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch (_) {
        /* ignore */
    }
}
