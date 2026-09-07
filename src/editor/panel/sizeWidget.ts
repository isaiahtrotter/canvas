// The multi-handle font-size widget that lives in the size drawer, in three
// switchable designs (VARIANTS), plus the Versions buttons that pick one.
import type { EditorContext } from "../core/context"
import { MIN, MAX, STEP, INSET } from "../core/types"
import type { SizeAdapter } from "./sizeAdapter"

export interface WidgetConfig {
    shape: "bar" | "diamond"
    ruler: "always" | "hover" | "none"
    barH: number
    numtagPos?: "above" | "below"
    segments?: boolean
    trackWidth?: number
}

export const VARIANTS: Record<number, WidgetConfig> = {
    1: { shape: "bar", ruler: "always", barH: 44 },
    2: {
        shape: "diamond",
        ruler: "hover",
        barH: 42,
        numtagPos: "above",
    },
    3: {
        shape: "bar",
        ruler: "none",
        barH: 42,
        segments: true,
        numtagPos: "below",
    },
}

export interface SizeWidget {
    el: HTMLElement
    /** reposition/recolor the existing handles */
    refresh(): void
    /** the selection changed: rebuild the handles, then refresh */
    rebuild(): void
}

export function makeWidget(cfg: WidgetConfig, adapter: SizeAdapter): SizeWidget {
    const wroot = document.createElement("div")
    wroot.className =
        "w shape-" +
        cfg.shape +
        (cfg.numtagPos ? " numtag-" + cfg.numtagPos : "")

    let segWrapEl: HTMLDivElement | null = null

    const track = document.createElement("div")
    track.className = "track"
    if (cfg.barH) track.style.height = cfg.barH + "px"
    if (cfg.segments) {
        const segWrap = document.createElement("div")
        segWrap.style.cssText =
            "position:absolute;inset:0;pointer-events:none;border-radius:10px;overflow:hidden;"
        track.appendChild(segWrap)
        segWrapEl = segWrap
    }

    const ruler = document.createElement("div")
    ruler.className = "ruler"
    let rulerChip = null
    if (cfg.ruler === "always") {
        rulerChip = document.createElement("div")
        rulerChip.className = "rulerchip"
        ruler.appendChild(rulerChip)
    }

    const pillsEl = document.createElement("div")
    pillsEl.className = "pills"

    function cw() {
        return Math.max(1, track.clientWidth - INSET * 2)
    }
    function vToPx(v) {
        v = Math.max(MIN, Math.min(MAX, v)) // a size past the slider's range parks its handle at the end
        return INSET + ((v - MIN) / (MAX - MIN)) * cw()
    }
    function pxToV(px) {
        const p = Math.max(0, Math.min(1, (px - INSET) / cw()))
        return Math.round(MIN + p * (MAX - MIN))
    }

    let dragging = false
    const handles: Record<string, HTMLElement> = {},
        numEls: Record<string, HTMLElement> = {}

    function buildHandles() {
        Object.values(handles).forEach((h) => h.remove())
        for (const k in handles) delete handles[k]
        for (const k in numEls) delete numEls[k]
        adapter.list().forEach((item) => {
            const h = document.createElement("div")
            h.className = "handle"
            h.dataset.id = String(item.id)
            const inner = document.createElement("div")
            inner.className = "hshape"
            h.appendChild(inner)
            if (cfg.numtagPos) {
                const tag = document.createElement("div")
                tag.className = "numtag"
                h.appendChild(tag)
                numEls[item.id] = tag
            }
            track.appendChild(h)
            handles[item.id] = h
            h.addEventListener("pointerdown", onDown)
            if (adapter.highlight) {
                h.addEventListener("mouseenter", () => {
                    const list = adapter.list()
                    const merged =
                        list.length > 1 &&
                        new Set(list.map((i) => i.value)).size === 1
                    if (merged) return // the consolidated black handle represents everything — no single line to point at
                    adapter.highlight(item.id, item.color)
                })
                h.addEventListener("mouseleave", () => {
                    if (!dragging) adapter.highlight(null, null)
                })
            }
            if (rulerChip) {
                h.addEventListener("mouseenter", () =>
                    showRulerChip(item.id)
                )
                h.addEventListener("mouseleave", () => {
                    if (!dragging) hideRulerChip()
                })
            }
        })
    }

    function showRulerChip(id) {
        if (!rulerChip) return
        const item = adapter.list().find((i) => i.id === id)
        if (!item) return
        rulerChip.textContent = item.value
        rulerChip.style.left = vToPx(item.value) + "px"
        rulerChip.classList.add("on")
        ruler.classList.add("dimlabels")
    }
    function hideRulerChip() {
        if (!rulerChip) return
        rulerChip.classList.remove("on")
        ruler.classList.remove("dimlabels")
    }

    let stackTimer = null
    function applyStackHiding() {
        const list = adapter.list()
        const topOfStack = {}
        list.forEach((i) => {
            topOfStack[i.value] = i.id
        })
        list.forEach((i) => {
            const h = handles[i.id]
            if (!h) return
            h.querySelector<HTMLElement>(".hshape").style.opacity =
                topOfStack[i.value] === i.id ? "1" : "0"
        })
    }

    function refreshVisual() {
        const list = adapter.list()
        const merged =
            list.length > 0 &&
            new Set(list.map((i) => i.value)).size === 1
        list.forEach((i) => {
            const h = handles[i.id]
            if (!h) return
            h.style.left = vToPx(i.value) + "px"
            const inner = h.querySelector<HTMLElement>(".hshape")
            inner.style.background =
                merged && list.length > 1 ? "var(--text)" : i.color
            inner.style.opacity = "1"
            if (numEls[i.id]) numEls[i.id].textContent = String(i.value)
        })
        if (segWrapEl) {
            segWrapEl.innerHTML = ""
            for (let v = MIN; v <= MAX; v += STEP) {
                const s = document.createElement("div")
                s.style.cssText =
                    "position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,.07);left:" +
                    vToPx(v) +
                    "px;"
                segWrapEl.appendChild(s)
            }
        }
        clearTimeout(stackTimer)
        stackTimer = setTimeout(applyStackHiding, 270)
        renderPillButtons()
    }

    function renderRuler() {
        const chip = rulerChip
        ruler.innerHTML = ""
        if (chip) ruler.appendChild(chip)
        const gap = (cw() / (MAX - MIN)) * STEP
        const stride = gap < 24 ? Math.ceil(24 / gap) : 1
        let mi = 0
        for (let v = MIN; v <= MAX; v++) {
            const isMajor = v % STEP === 0
            const t = document.createElement("div")
            t.className = "rtick " + (isMajor ? "major" : "minor")
            t.style.left = vToPx(v) + "px"
            ruler.appendChild(t)
            if (isMajor) {
                if (mi % stride === 0) {
                    const l = document.createElement("div")
                    l.className = "rlabel"
                    l.style.left = vToPx(v) + "px"
                    l.textContent = String(v)
                    ruler.appendChild(l)
                }
                mi++
            }
        }
    }

    function renderPillButtons() {
        const distinct = Array.from(
            new Set<number>(adapter.list().map((i) => i.value))
        ).sort((x, y) => x - y)
        pillsEl.innerHTML = ""
        distinct.forEach((v) => {
            const b = document.createElement("button")
            b.className = "pill"
            b.textContent = String(v)
            b.tabIndex = -1
            b.addEventListener("click", (e) => {
                e.stopPropagation()
                adapter.setAll(v)
            })
            pillsEl.appendChild(b)
        })
    }

    function onDown(e) {
        e.stopPropagation() // no preventDefault: it would suppress mousemove for the drag and freeze custom cursors
        const h = e.currentTarget
        const id = parseFloat(h.dataset.id)
        h.classList.add("dragging")
        try {
            h.setPointerCapture(e.pointerId)
        } catch (_) {
            /* document listeners cover the drag */
        }
        dragging = true
        if (adapter.beginGesture) adapter.beginGesture() // one undo entry per drag
        // Merged state is decided ONCE, at drag start: if every
        // selected layer already shares one size, this drag grabs the
        // consolidated black node and moves ALL of them together for
        // its entire duration — it never splits back into individual
        // handles mid-gesture.
        const startList = adapter.list()
        const draggingAll =
            startList.length > 1 &&
            new Set(startList.map((i) => i.value)).size === 1
        // The consolidated node is really N perfectly-stacked handles.
        // Only elements with .dragging skip the .25s left-transition,
        // so during a merged drag EVERY handle gets it — otherwise the
        // grabbed one moves instantly while the rest ease after it,
        // reading as a laggy ghost trailing the black node.
        if (draggingAll) {
            Object.values(handles).forEach((h2) =>
                h2.classList.add("dragging")
            )
        }
        if (adapter.highlight) {
            const item = startList.find((i) => i.id === id)
            if (item && !draggingAll) adapter.highlight(id, item.color)
        }
        if (cfg.ruler === "hover") setRuler(true)
        if (rulerChip) showRulerChip(id)
        function mv(ev) {
            const rect = track.getBoundingClientRect()
            const v = pxToV(ev.clientX - rect.left)
            const item = adapter.list().find((i) => i.id === id)
            if (item && v !== item.value) {
                if (draggingAll) adapter.setAllLive(v)
                else adapter.set(id, v)
                if (rulerChip) showRulerChip(id)
            }
        }
        function up() {
            h.classList.remove("dragging")
            if (draggingAll) {
                Object.values(handles).forEach((h2) =>
                    h2.classList.remove("dragging")
                )
            }
            document.removeEventListener("pointermove", mv)
            document.removeEventListener("pointerup", up)
            dragging = false
            if (cfg.ruler === "hover" && !stack.matches(":hover"))
                setRuler(false)
            if (rulerChip && !h.matches(":hover")) hideRulerChip()
            if (adapter.highlight && !h.matches(":hover"))
                adapter.highlight(null, null)
        }
        document.addEventListener("pointermove", mv)
        document.addEventListener("pointerup", up)
    }

    function setRuler(on) {
        if (cfg.ruler !== "hover") return
        ruler.style.height = on ? "26px" : "0px"
        ruler.style.opacity = on ? "1" : "0"
        track.style.borderRadius = on ? "10px 10px 0 0" : "10px"
    }
    if (cfg.ruler === "hover") {
        ruler.style.cssText +=
            "height:0;opacity:0;transition:height .2s ease,opacity .15s ease;border-radius:0 0 10px 10px;"
    } else if (cfg.ruler === "always") {
        ruler.style.height = "26px"
        ruler.style.borderRadius = "0 0 10px 10px"
        track.style.borderRadius = "10px 10px 0 0"
    }

    const stack = document.createElement("div")
    stack.className = "stack"
    if (cfg.trackWidth) {
        stack.style.flex = "0 0 auto"
        stack.style.width = cfg.trackWidth + "px"
    }
    stack.appendChild(track)
    if (cfg.ruler !== "none") stack.appendChild(ruler)
    if (cfg.ruler === "hover") {
        stack.addEventListener("mouseenter", () => setRuler(true))
        stack.addEventListener("mouseleave", () => {
            if (!dragging) setRuler(false)
        })
    }

    const up = document.createElement("button")
    up.textContent = "+"
    up.setAttribute("aria-label", "Increase all")
    up.tabIndex = -1
    const dn = document.createElement("button")
    dn.textContent = "–"
    dn.setAttribute("aria-label", "Decrease all")
    dn.tabIndex = -1
    up.addEventListener("click", (e) => {
        e.stopPropagation()
        adapter.nudge(1)
    })
    dn.addEventListener("click", (e) => {
        e.stopPropagation()
        adapter.nudge(-1)
    })

    const flank = document.createElement("div")
    flank.className = "flank"
    const stepcol = document.createElement("div")
    stepcol.className = "stepcol"
    up.className = "up"
    dn.className = "dn"
    stepcol.append(up, dn)
    flank.append(stack, stepcol)
    wroot.appendChild(flank)
    const bottom = document.createElement("div")
    bottom.className = "bottomrow"
    bottom.append(pillsEl)
    wroot.appendChild(bottom)

    requestAnimationFrame(() => {
        buildHandles()
        if (cfg.ruler !== "none") renderRuler()
        refreshVisual()
    })

    return {
        el: wroot,
        refresh: refreshVisual,
        rebuild: () => {
            buildHandles()
            if (cfg.ruler !== "none") renderRuler()
            refreshVisual()
        },
    }
}

/* ---- version switching: the Versions buttons swap the widget design ---- */
export interface VariantsAPI {
    activate(num: number): void
    updateButtons(): void
}

export function installVariants(ctx: EditorContext): VariantsAPI {
    const { root } = ctx
    function activate(num: number) {
        if (num === ctx.ui.activeVariant) return
        ctx.ui.activeVariant = num
        ctx.panel.text?.mountWidget() // swaps only the widget inside the drawer — open state and dropdowns untouched
        updateButtons()
    }
    function updateButtons() {
        let activeBtn = null
        root.querySelectorAll<HTMLElement>(".vergroup .vbtn").forEach((b) => {
            const on = Number(b.dataset.v) === ctx.ui.activeVariant
            b.classList.toggle("active", on)
            if (on) activeBtn = b
        })
        // the blue highlight slides between buttons instead of popping
        const vind = root.querySelector<HTMLElement>("#vind")
        if (activeBtn && vind) {
            vind.style.left = activeBtn.offsetLeft + "px"
            vind.style.width = activeBtn.offsetWidth + "px"
        }
    }
    /* version buttons in the canvas pill */
    root.querySelectorAll<HTMLElement>(".vergroup .vbtn").forEach((b) => {
        b.addEventListener("click", (e) => {
            e.stopPropagation()
            activate(Number(b.dataset.v))
        })
    })
    return { activate, updateButtons }
}
