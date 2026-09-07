// Frame timestamps (Shift+T) and the heatmap (Shift+H).
import type { EditorContext, Disposable } from "../core/context"
import { isFrame } from "../core/types"
import { relTime } from "../time"

export interface TimesAPI {
    setShowTimes(v: boolean, toast?: boolean): void
    toggleTimes(): void
    applyHeat(): void
    toggleHeat(): void
}

/** The canvas background while the heatmap is on; the fill module reads it for label contrast. */
export const HEAT_BG = "#0a0218"

export function installTimes(ctx: EditorContext): TimesAPI & Disposable {
    const { root } = ctx
    const { app, canvas } = ctx.dom
    const items = ctx.doc.items

    /* ---- frame timestamps: shown beside the name; Shift+T toggles, and
       the choice sticks in localStorage ---- */
    const TIMES_KEY = "canvas.showTimestamps"
    let showTimes = true
    try {
        showTimes = localStorage.getItem(TIMES_KEY) !== "0"
    } catch (_) {
        /* storage unavailable — default to shown */
    }
    function applyShowTimes() {
        app.classList.toggle("hide-times", !showTimes)
        const sw = root.querySelector<HTMLInputElement>("#prefTimes")
        if (sw) sw.checked = showTimes
    }
    function setShowTimes(v: boolean, toast = true) {
        if (v === showTimes) return
        showTimes = v
        try {
            localStorage.setItem(TIMES_KEY, showTimes ? "1" : "0")
        } catch (_) {
            /* ignore */
        }
        applyShowTimes()
        if (toast) ctx.tools.showToast(showTimes ? "Timestamps shown" : "Timestamps hidden")
    }
    function toggleTimes() {
        setShowTimes(!showTimes)
    }
    applyShowTimes()
    function refreshTimes() {
        canvas.querySelectorAll<HTMLElement>(".ftime").forEach((t) => {
            t.textContent = relTime(Number(t.dataset.t))
        })
    }
    const timesTimer = setInterval(refreshTimes, 30000)

    /* ---- heatmap (Shift+H): thermal view of how recently each layer was
       edited. Heat decays on a log scale over a week — just-edited layers
       glow light yellow, untouched ones sink to dark purple. Only the canvas
       changes: the frame/text colors are overridden through CSS variables
       set per node (--heat / --heat-frame), the world gets a slight blur, and
       a key appears on the left. Toggling fades over 300ms via a temporary
       .heat-transition class so the transition never applies to ordinary
       fill edits. ---- */
    let heatTransTimer = null
    const HEAT_STOPS: [number, number, number][] = [
        [0x1a, 0x05, 0x33], // dark purple — untouched
        [0x4a, 0x0f, 0x7a],
        [0xa3, 0x21, 0x6e],
        [0xef, 0x72, 0x33],
        [0xfb, 0xea, 0x6a], // light yellow — just edited
    ]
    const HEAT_WINDOW_S = 7 * 86400 // a week and beyond is fully cold
    const HEAT_KEY: Array<[string, number]> = [
        ["Now", 0],
        ["10 min", 600],
        ["1 hr", 3600],
        ["1 day", 86400],
        ["1 wk+", HEAT_WINDOW_S],
    ]
    function heatFromAge(ageSeconds: number) {
        const a = Math.max(0, ageSeconds)
        return 1 - Math.min(1, Math.log10(1 + a / 10) / Math.log10(1 + HEAT_WINDOW_S / 10))
    }
    function heatColor(h: number): [number, number, number] {
        const t = Math.max(0, Math.min(1, h)) * (HEAT_STOPS.length - 1)
        const i = Math.min(HEAT_STOPS.length - 2, Math.floor(t))
        const f = t - i
        const a = HEAT_STOPS[i],
            b = HEAT_STOPS[i + 1]
        return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number]
    }
    const rgbCss = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`
    let heatTimer = null // 1s refresh while on; the CSS transition smooths each step
    function applyHeat() {
        const now = Date.now()
        items.forEach((it) => {
            const node = ctx.nodeFor(it.id)
            if (!node) return
            // stagger the glow so frames don't all breathe together
            node.style.setProperty("--phase", ((it.id * 0.37) % 1).toFixed(3))
            const c = heatColor(heatFromAge((now - (it.updatedAt ?? 0)) / 1000))
            // frames and text both take the full heat color, so a fresh edit is
            // the key's bright yellow; text stays legible on a same-heat frame
            // through its dark text-shadow edge and the frame's moving sheen
            node.style.setProperty(isFrame(it) ? "--heat-frame" : "--heat", rgbCss(c))
        })
    }
    // the key: a gradient bar with labels placed at their heat positions
    const heatKey = document.createElement("div")
    heatKey.className = "heatkey"
    heatKey.setAttribute("aria-hidden", "true")
    const heatBar = document.createElement("div")
    heatBar.className = "bar"
    heatBar.style.background =
        "linear-gradient(to bottom, " +
        HEAT_STOPS.slice()
            .reverse()
            .map((c, i) => `${rgbCss(c)} ${(i / (HEAT_STOPS.length - 1)) * 100}%`)
            .join(", ") +
        ")"
    const heatTicks = document.createElement("div")
    heatTicks.className = "ticks"
    HEAT_KEY.forEach(([label, age]) => {
        const t = document.createElement("div")
        t.className = "tick"
        t.textContent = label
        t.style.top = (1 - heatFromAge(age)) * 100 + "%"
        heatTicks.appendChild(t)
    })
    heatKey.append(heatBar, heatTicks)
    canvas.parentElement?.appendChild(heatKey)
    function setHeat(on: boolean) {
        if (ctx.ui.heat === on) return
        ctx.ui.heat = on
        if (on) applyHeat() // colors are in place before the class reveals them
        canvas.classList.add("heat-transition")
        canvas.classList.toggle("heat", on)
        heatKey.classList.toggle("on", on)
        ctx.panel.fill.applyBg() // canvas background + label colors for the thermal look
        clearTimeout(heatTransTimer)
        heatTransTimer = setTimeout(() => canvas.classList.remove("heat-transition"), 350)
        clearInterval(heatTimer)
        if (on) heatTimer = setInterval(applyHeat, 1000)
        ctx.tools.showToast(on ? "Heatmap on" : "Heatmap off")
    }
    function toggleHeat() {
        setHeat(!ctx.ui.heat)
    }

    return {
        setShowTimes,
        toggleTimes,
        applyHeat,
        toggleHeat,
        dispose() {
            clearInterval(timesTimer)
            clearInterval(heatTimer)
            clearTimeout(heatTransTimer)
        },
    }
}
