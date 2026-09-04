import { useEffect, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"

/**
 * Font-size canvas demo — multi-select text layers, a docked properties
 * sidebar, and the multi-handle font-size control (3 switchable versions).
 *
 * Cursor integration: everything that should show the CustomCursor hand
 * (text layers, slider handles) is styled `cursor: pointer` — that's the
 * signal the CustomCursor component already reads. No data-cursor
 * attributes, no changes needed on the cursor side. Text editing keeps
 * `cursor: text`, so the beam shows automatically.
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 600
 * @framerIntrinsicHeight 400
 */
export default function FontSizeCanvas(props) {
    const {
        canvasColor = "#fafaf9",
        cornerRadius = 10,
        borderColor = "#dedede",
    } = props
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const root = ref.current
        if (!root) return

        root.innerHTML = MARKUP

        // document-level listeners, tracked so unmount removes them
        const docListeners: Array<[string, EventListener]> = []
        function onDoc(type: string, fn: EventListener) {
            document.addEventListener(type, fn)
            docListeners.push([type, fn])
        }

        /* ================= ported app ================= */

        const MIN = 8,
            MAX = 48,
            STEP = 4,
            INSET = 12
        const PALETTE = [
            "#008FF0",
            "#F24822",
            "#FFCD29",
            "#14AE5C",
            "#9747FF",
            "#FF7A00",
            "#FF24BD",
            "#00B5CE",
            "#845EF7",
            "#E8590C",
        ]

        const VARIANTS = {
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
        let activeVariant = 2

        /* ================= app state ================= */
        let nextId = 1
        const items = [] // {id,x,y,text,size,font,weight}
        const selection = new Set()
        const listeners = []
        function subscribe(fn) {
            listeners.push(fn)
        }
        function emit() {
            listeners.forEach((fn) => fn())
        }

        /* ---- undo history: up to 20 steps ---- */
        const HISTORY_MAX = 20
        const history = []
        const redoStack = []
        function snapshot() {
            return {
                items: items.map((it) => Object.assign({}, it)),
                selection: Array.from(selection),
            }
        }
        function pushHistory(pre) {
            history.push(pre || snapshot())
            if (history.length > HISTORY_MAX) history.shift()
            redoStack.length = 0 // a new action invalidates the redo timeline
        }
        function restore(st) {
            items.length = 0
            st.items.forEach((it) => items.push(Object.assign({}, it)))
            selection.clear()
            st.selection.forEach((id) => selection.add(id))
            nextId = items.reduce((m, it) => Math.max(m, it.id), 0) + 1
            emit()
        }
        function undo() {
            if (!history.length) return
            redoStack.push(snapshot())
            if (redoStack.length > HISTORY_MAX) redoStack.shift()
            restore(history.pop())
        }
        function redo() {
            if (!redoStack.length) return
            history.push(snapshot())
            if (history.length > HISTORY_MAX) history.shift()
            restore(redoStack.pop())
        }
        onDoc("keydown", (e) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
                const a = document.activeElement
                if (a && a.isContentEditable) return // let native undo run inside text editing
                e.preventDefault()
                if (e.shiftKey) redo()
                else undo()
            }
        })

        function addItem(props) {
            const it = Object.assign(
                {
                    id: nextId++,
                    x: 60,
                    y: 60,
                    text: "Text",
                    size: 16,
                    font: "Inter",
                    weight: 400,
                    opacity: 100,
                },
                props
            )
            items.push(it)
            return it
        }

        addItem({
            x: 60,
            y: 70,
            text: "select multiple",
            size: 32,
            weight: 400,
        })
        addItem({ x: 60, y: 130, text: "lines of text", size: 20, weight: 400 })
        addItem({
            x: 60,
            y: 180,
            text: "and use the drop down",
            size: 16,
            weight: 400,
        })
        addItem({ x: 60, y: 220, text: "to edit them", size: 14, weight: 400 })
        selection.add(items[0].id)
        selection.add(items[1].id)
        selection.add(items[2].id)
        selection.add(items[3].id)

        function selectedItems() {
            return items.filter((it) => selection.has(it.id))
        }
        function selColor(id) {
            const sel = selectedItems()
            const idx = sel.findIndex((it) => it.id === id)
            return PALETTE[idx % PALETTE.length]
        }

        /* ================= canvas ================= */
        const canvas = root.querySelector("#canvas")
        let editingEl = null
        let hoverWash = null // {id, color} — set while a slider handle is hovered/dragged

        function hexToRgba(hex, a) {
            const n = parseInt(hex.slice(1), 16)
            return (
                "rgba(" +
                ((n >> 16) & 255) +
                "," +
                ((n >> 8) & 255) +
                "," +
                (n & 255) +
                "," +
                a +
                ")"
            )
        }
        function applyWash() {
            items.forEach((it) => {
                const node = canvas.querySelector('[data-id="' + it.id + '"]')
                if (!node) return
                node.style.background =
                    hoverWash && hoverWash.id === it.id
                        ? hexToRgba(hoverWash.color, 0.15)
                        : ""
            })
        }

        function renderCanvas() {
            canvas.innerHTML = ""
            const multi = selection.size > 1
            items.forEach((it) => {
                const el = document.createElement("div")
                el.className =
                    "titem" +
                    (multi && selection.has(it.id) ? " sel-underline" : "")
                el.style.left = it.x + "px"
                el.style.top = it.y + "px"
                el.style.fontSize = it.size + "px"
                el.style.fontFamily = it.font
                el.style.fontWeight = it.weight
                el.style.opacity = (it.opacity != null ? it.opacity : 100) / 100
                el.textContent = it.text
                el.dataset.id = it.id
                el.addEventListener("pointerdown", (e) =>
                    onItemPointerDown(e, it, el)
                )
                el.addEventListener("dblclick", (e) => {
                    e.stopPropagation()
                    startEditing(el, it)
                })
                canvas.appendChild(el)
            })
            applyWash()
            renderSelectionOverlay()
        }

        // One-time initial layout for the default demo lines: each line is
        // horizontally centered on its own (a centered text block, not
        // left-margin-aligned), and the whole stack is shifted so it sits
        // vertically centered in the canvas — the original relative gaps
        // between lines (60/50/40px) are preserved, only re-centered as a
        // group. Requires a render pass first so offsetWidth/offsetHeight
        // are real measurements, not guesses.
        function centerDefaultItems() {
            if (!items.length) return
            const canvasW = canvas.clientWidth
            const canvasH = canvas.clientHeight
            const rects = items.map((it) => {
                const node = canvas.querySelector('[data-id="' + it.id + '"]')
                return node
                    ? { w: node.offsetWidth, h: node.offsetHeight }
                    : { w: 0, h: 0 }
            })
            const firstY = items[0].y
            const lastIdx = items.length - 1
            const blockTop = firstY
            const blockBottom = items[lastIdx].y + rects[lastIdx].h
            const shiftY = canvasH / 2 - (blockTop + blockBottom) / 2
            items.forEach((it, i) => {
                it.x = canvasW / 2 - rects[i].w / 2 // center each line horizontally
                it.y = it.y + shiftY // recenter the whole stack vertically
            })
        }

        /* Figma-style bounding box: combined bounds of the selection, corner handles, W × H badge */
        function selectionBounds() {
            const sel = selectedItems()
            if (!sel.length) return null
            let x1 = Infinity,
                y1 = Infinity,
                x2 = -Infinity,
                y2 = -Infinity
            sel.forEach((it) => {
                const node = canvas.querySelector('[data-id="' + it.id + '"]')
                if (!node) return
                const w = node.offsetWidth,
                    h = node.offsetHeight
                x1 = Math.min(x1, it.x)
                y1 = Math.min(y1, it.y)
                x2 = Math.max(x2, it.x + w)
                y2 = Math.max(y2, it.y + h)
            })
            if (x1 === Infinity) return null
            return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
        }

        function renderSelectionOverlay() {
            canvas.querySelectorAll(".selbox").forEach((n) => n.remove())
            if (editingEl) return
            const b = selectionBounds() // one combined box around everything selected
            if (!b) return
            const box = document.createElement("div")
            box.className = "selbox"
            box.style.left = b.x + "px"
            box.style.top = b.y + "px"
            box.style.width = b.w + "px"
            box.style.height = b.h + "px"
            ;["tl", "tr", "bl", "br"].forEach((c) => {
                const h = document.createElement("div")
                h.className = "selhandle " + c
                box.appendChild(h)
            })
            const size = document.createElement("div")
            size.className = "selsize"
            size.textContent = Math.round(b.w) + " \u00d7 " + Math.round(b.h)
            box.appendChild(size)
            canvas.appendChild(box)
        }

        function startEditing(el, it) {
            editingEl = el
            renderSelectionOverlay()
            const preEdit = snapshot()
            el.setAttribute("contenteditable", "true")
            el.focus()
            const range = document.createRange()
            range.selectNodeContents(el)
            const s = window.getSelection()
            s.removeAllRanges()
            s.addRange(range)
            function done() {
                el.removeAttribute("contenteditable")
                const newText = el.textContent.trim() || "Text"
                if (newText !== it.text) pushHistory(preEdit)
                it.text = newText
                el.removeEventListener("blur", done)
                editingEl = null
                emit()
            }
            el.addEventListener("blur", done)
            el.addEventListener("keydown", (e) => {
                e.stopPropagation() // don't let Delete/Backspace inside editing delete the layer
                if (e.key === "Enter") {
                    e.preventDefault()
                    el.blur()
                }
                if (e.key === "Escape") {
                    e.preventDefault()
                    el.blur() // commits the text via done()
                    selection.clear() // and drops the selection entirely
                    emit()
                }
            })
        }

        function onItemPointerDown(e, it, el) {
            if (el.getAttribute("contenteditable") === "true") return
            e.stopPropagation()

            if (e.shiftKey) {
                if (selection.has(it.id)) selection.delete(it.id)
                else selection.add(it.id)
                emit()
                return
            }
            if (!selection.has(it.id)) {
                selection.clear()
                selection.add(it.id)
                emit()
            }

            const liveEl =
                canvas.querySelector('[data-id="' + it.id + '"]') || el

            const startX = e.clientX,
                startY = e.clientY
            const starts = selectedItems().map((s) => ({
                it: s,
                x: s.x,
                y: s.y,
            }))
            const preDrag = snapshot() // pre-state: pushed once if the gesture actually moves anything
            let moved = false
            let duplicated = false
            liveEl.classList.add("dragging")
            function mv(ev) {
                const dx = ev.clientX - startX,
                    dy = ev.clientY - startY
                if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
                    moved = true
                    pushHistory(preDrag)
                }
                // option (mac) / ctrl (windows) duplicates — works whether held at click time
                // or pressed at any point during the drag: a copy is left at the origin
                if (moved && !duplicated && (ev.altKey || ev.ctrlKey)) {
                    duplicated = true
                    starts.forEach((s) => {
                        addItem({
                            x: s.x,
                            y: s.y,
                            text: s.it.text,
                            size: s.it.size,
                            font: s.it.font,
                            weight: s.it.weight,
                        })
                    })
                    emit()
                }
                starts.forEach((s) => {
                    s.it.x = s.x + dx
                    s.it.y = s.y + dy
                })
                items.forEach((i2) => {
                    const node = canvas.querySelector(
                        '[data-id="' + i2.id + '"]'
                    )
                    if (node) {
                        node.style.left = i2.x + "px"
                        node.style.top = i2.y + "px"
                    }
                })
                renderSelectionOverlay()
                updateProps() // X/Y readouts follow the drag in real time
            }
            function up() {
                liveEl.classList.remove("dragging")
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", up)
                if (moved) emit()
            }
            document.addEventListener("pointermove", mv)
            document.addEventListener("pointerup", up)
        }

        /* marquee drag-select on empty canvas */
        canvas.addEventListener("pointerdown", (e) => {
            if (e.target !== canvas) return
            const rect = canvas.getBoundingClientRect()
            const sx = e.clientX - rect.left,
                sy = e.clientY - rect.top
            let marquee = null,
                moved = false

            function hits(r) {
                const out = new Set()
                items.forEach((it) => {
                    const node = canvas.querySelector(
                        '[data-id="' + it.id + '"]'
                    )
                    if (!node) return
                    const iw = node.offsetWidth,
                        ih = node.offsetHeight
                    if (
                        it.x < r.x + r.w &&
                        it.x + iw > r.x &&
                        it.y < r.y + r.h &&
                        it.y + ih > r.y
                    )
                        out.add(it.id)
                })
                return out
            }
            function mv(ev) {
                const cx = Math.max(
                    0,
                    Math.min(rect.width, ev.clientX - rect.left)
                )
                const cy = Math.max(
                    0,
                    Math.min(rect.height, ev.clientY - rect.top)
                )
                if (
                    !moved &&
                    (Math.abs(cx - sx) > 3 || Math.abs(cy - sy) > 3)
                ) {
                    moved = true
                    marquee = document.createElement("div")
                    marquee.className = "marquee"
                    canvas.appendChild(marquee)
                }
                if (!marquee) return
                const x = Math.min(sx, cx),
                    y = Math.min(sy, cy)
                const w = Math.abs(cx - sx),
                    h = Math.abs(cy - sy)
                marquee.style.left = x + "px"
                marquee.style.top = y + "px"
                marquee.style.width = w + "px"
                marquee.style.height = h + "px"
                marquee._rect = { x, y, w, h }
                // live highlight: any text the rectangle currently touches gets the blue underline
                const touched = hits(marquee._rect)
                items.forEach((it) => {
                    const node = canvas.querySelector(
                        '[data-id="' + it.id + '"]'
                    )
                    if (node)
                        node.classList.toggle(
                            "sel-underline",
                            touched.has(it.id)
                        )
                })
            }
            function up() {
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", up)
                if (moved && marquee) {
                    const r = marquee._rect || { x: sx, y: sy, w: 0, h: 0 }
                    marquee.remove()
                    selection.clear()
                    hits(r).forEach((id) => selection.add(id))
                    emit()
                } else {
                    selection.clear()
                    emit()
                }
            }
            document.addEventListener("pointermove", mv)
            document.addEventListener("pointerup", up)
        })

        /* keyboard delete */
        onDoc("keydown", (e) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return
            const a = document.activeElement
            if (
                a &&
                (a.tagName === "INPUT" ||
                    a.tagName === "SELECT" ||
                    a.isContentEditable)
            )
                return
            if (!selection.size) return
            e.preventDefault()
            pushHistory()
            for (let i = items.length - 1; i >= 0; i--) {
                if (selection.has(items[i].id)) items.splice(i, 1)
            }
            selection.clear()
            emit()
        })

        /* version buttons in the canvas pill */
        root.querySelectorAll(".vergroup .vbtn").forEach((b) => {
            b.addEventListener("click", (e) => {
                e.stopPropagation() // keep the demo drawer open through the swap
                activateVariant(Number(b.dataset.v))
            })
        })

        /* ================= widget (selection-bound) ================= */
        function makeWidget(cfg, adapter) {
            const root = document.createElement("div")
            root.className =
                "w shape-" +
                cfg.shape +
                (cfg.numtagPos ? " numtag-" + cfg.numtagPos : "")

            const track = document.createElement("div")
            track.className = "track"
            if (cfg.barH) track.style.height = cfg.barH + "px"
            if (cfg.segments) {
                const segWrap = document.createElement("div")
                segWrap.style.cssText =
                    "position:absolute;inset:0;pointer-events:none;border-radius:10px;overflow:hidden;"
                track.appendChild(segWrap)
                root._segWrap = segWrap
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
                return INSET + ((v - MIN) / (MAX - MIN)) * cw()
            }
            function pxToV(px) {
                const p = Math.max(0, Math.min(1, (px - INSET) / cw()))
                return Math.round(MIN + p * (MAX - MIN))
            }

            let dragging = false
            const handles = {},
                numEls = {}

            function buildHandles() {
                Object.values(handles).forEach((h) => h.remove())
                for (const k in handles) delete handles[k]
                for (const k in numEls) delete numEls[k]
                adapter.list().forEach((item) => {
                    const h = document.createElement("div")
                    h.className = "handle"
                    h.dataset.id = item.id
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
                    h.querySelector(".hshape").style.opacity =
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
                    const inner = h.querySelector(".hshape")
                    inner.style.background =
                        merged && list.length > 1 ? "#111" : i.color
                    inner.style.opacity = "1"
                    if (numEls[i.id]) numEls[i.id].textContent = i.value
                })
                if (root._segWrap) {
                    root._segWrap.innerHTML = ""
                    for (let v = MIN; v <= MAX; v += STEP) {
                        const s = document.createElement("div")
                        s.style.cssText =
                            "position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,.07);left:" +
                            vToPx(v) +
                            "px;"
                        root._segWrap.appendChild(s)
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
                            l.textContent = v
                            ruler.appendChild(l)
                        }
                        mi++
                    }
                }
            }

            function renderPillButtons() {
                const distinct = Array.from(
                    new Set(adapter.list().map((i) => i.value))
                ).sort((x, y) => x - y)
                pillsEl.innerHTML = ""
                distinct.forEach((v) => {
                    const b = document.createElement("button")
                    b.className = "pill"
                    b.textContent = v
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
            root.appendChild(flank)
            const bottom = document.createElement("div")
            bottom.className = "bottomrow"
            bottom.append(pillsEl)
            root.appendChild(bottom)

            requestAnimationFrame(() => {
                buildHandles()
                if (cfg.ruler !== "none") renderRuler()
                refreshVisual()
            })

            return {
                el: root,
                refresh: refreshVisual,
                rebuild: () => {
                    buildHandles()
                    if (cfg.ruler !== "none") renderRuler()
                    refreshVisual()
                },
            }
        }

        /* ================= side panel (built once) ================= */
        const panelGroup = root.querySelector("#panelGroup")

        // alignment: single item aligns within the canvas, multi aligns within the selection bounds
        const alignBtns = []
        ;(function () {
            const row = root.querySelector("#alignRow")
            const defs = [
                {
                    kind: "left",
                    icon: '<rect x="1" y="2" width="2" height="10"/><rect x="5" y="4" width="8" height="2"/><rect x="5" y="8" width="5" height="2"/>',
                },
                {
                    kind: "centerH",
                    icon: '<rect x="6" y="2" width="2" height="10"/><rect x="2" y="4" width="10" height="2"/><rect x="3.5" y="8" width="7" height="2"/>',
                },
                {
                    kind: "right",
                    icon: '<rect x="11" y="2" width="2" height="10"/><rect x="1" y="4" width="8" height="2"/><rect x="4" y="8" width="5" height="2"/>',
                },
                {
                    kind: "top",
                    icon: '<rect x="2" y="1" width="10" height="2"/><rect x="4" y="5" width="2" height="8"/><rect x="8" y="5" width="2" height="5"/>',
                },
                {
                    kind: "centerV",
                    icon: '<rect x="2" y="6" width="10" height="2"/><rect x="4" y="2" width="2" height="10"/><rect x="8" y="3.5" width="2" height="7"/>',
                },
                {
                    kind: "bottom",
                    icon: '<rect x="2" y="11" width="10" height="2"/><rect x="4" y="1" width="2" height="8"/><rect x="8" y="4" width="2" height="5"/>',
                },
            ]
            defs.forEach((d) => {
                const b = document.createElement("button")
                b.className = "alignbtn"
                b.tabIndex = -1
                b.title = "Align " + d.kind
                b.innerHTML =
                    '<svg width="14" height="14" viewBox="0 0 14 14" fill="#1c1c1c">' +
                    d.icon +
                    "</svg>"
                b.addEventListener("click", () => alignSelection(d.kind))
                row.appendChild(b)
                alignBtns.push(b)
            })
        })()

        function alignSelection(kind) {
            const sel = selectedItems()
            if (!sel.length) return
            // target frame: the selection's own bounds for multi, the whole canvas for single
            let frame
            if (sel.length > 1) {
                const b = selectionBounds()
                if (!b) return
                frame = { x: b.x, y: b.y, w: b.w, h: b.h }
            } else {
                frame = {
                    x: 0,
                    y: 0,
                    w: canvas.clientWidth,
                    h: canvas.clientHeight,
                }
            }
            pushHistory()
            sel.forEach((it) => {
                const node = canvas.querySelector('[data-id="' + it.id + '"]')
                if (!node) return
                const iw = node.offsetWidth,
                    ih = node.offsetHeight
                if (kind === "left") it.x = frame.x
                if (kind === "centerH") it.x = frame.x + (frame.w - iw) / 2
                if (kind === "right") it.x = frame.x + frame.w - iw
                if (kind === "top") it.y = frame.y
                if (kind === "centerV") it.y = frame.y + (frame.h - ih) / 2
                if (kind === "bottom") it.y = frame.y + frame.h - ih
            })
            emit()
        }

        function updateAlignButtons() {
            const none = selection.size === 0
            alignBtns.forEach((b) => (b.disabled = none))
        }

        // position / dimensions / opacity fields, live-bound to the selection
        const posX = root.querySelector("#posX")
        const posY = root.querySelector("#posY")
        const dimW = root.querySelector("#dimW")
        const dimH = root.querySelector("#dimH")

        function updateProps() {
            const sel = selectedItems()
            const none = sel.length === 0
            ;[posX, posY].forEach((i) => {
                i.disabled = none
                if (none) {
                    i.value = ""
                    i.placeholder = "\u2013"
                }
            })
            if (none) {
                dimW.value = ""
                dimH.value = ""
                return
            }

            const b = selectionBounds()
            if (b) {
                if (document.activeElement !== posX)
                    posX.value = Math.round(b.x)
                if (document.activeElement !== posY)
                    posY.value = Math.round(b.y)
                dimW.value = Math.round(b.w)
                dimH.value = Math.round(b.h)
            }
        }

        let posPre = null
        function armPos() {
            posPre = snapshot()
        }
        function consumePos() {
            if (posPre) {
                pushHistory(posPre)
                posPre = null
            }
        }

        posX.addEventListener("focus", armPos)
        posY.addEventListener("focus", armPos)

        posX.addEventListener("input", () => {
            const v = parseFloat(posX.value)
            if (isNaN(v)) return
            const b = selectionBounds()
            if (!b) return
            const dx = v - b.x
            if (dx === 0) return
            consumePos()
            selectedItems().forEach((it) => (it.x += dx))
            emit()
        })
        posY.addEventListener("input", () => {
            const v = parseFloat(posY.value)
            if (isNaN(v)) return
            const b = selectionBounds()
            if (!b) return
            const dy = v - b.y
            if (dy === 0) return
            consumePos()
            selectedItems().forEach((it) => (it.y += dy))
            emit()
        })
        ;[posX, posY].forEach((i) => {
            i.addEventListener("blur", () => {
                posPre = null
                updateProps()
            })
            i.addEventListener("keydown", (e) => {
                if (e.key === "Enter") i.blur()
            })
        })
        let activeWidget = null
        let panelAPI = null

        function makeSelect(options, onChange) {
            const wrap = document.createElement("div")
            wrap.className = "dd-wrap"
            const sel = document.createElement("select")
            sel.className = "dd"
            options.forEach((o) => {
                const opt = document.createElement("option")
                opt.value = o.value !== undefined ? o.value : o
                opt.textContent = o.label || o
                sel.appendChild(opt)
            })
            if (onChange)
                sel.addEventListener("change", () => onChange(sel.value))
            wrap.appendChild(sel)
            return wrap
        }

        // gesture-scoped history for the size controls: a handle drag or a typing session
        // logs ONE undo entry, captured before its first change; discrete actions (a pill
        // click, a +/- press) log one entry each
        let pendingPre = null
        const adapter = {
            beginGesture() {
                pendingPre = snapshot()
            },
            cancelGesture() {
                pendingPre = null
            },
            _consumeOrPush() {
                if (pendingPre) {
                    pushHistory(pendingPre)
                    pendingPre = null
                } else pushHistory()
            },
            highlight(id, color) {
                hoverWash = color ? { id, color } : null
                applyWash()
            },
            list() {
                return selectedItems().map((it) => ({
                    id: it.id,
                    color: selColor(it.id),
                    value: it.size,
                }))
            },
            set(id, v) {
                const it = items.find((i) => i.id === id)
                if (!it) return
                v = Math.max(MIN, Math.min(MAX, Math.round(v)))
                if (v === it.size) return
                if (pendingPre) {
                    pushHistory(pendingPre)
                    pendingPre = null
                }
                it.size = v
                emit()
            },
            // Drag-safe variant of setAll: consumes the gesture's pending
            // snapshot on first change only, so a whole merged-node drag is
            // ONE undo entry (setAll would push history on every pixel).
            setAllLive(v) {
                v = Math.max(MIN, Math.min(MAX, Math.round(v)))
                if (selectedItems().every((it) => it.size === v)) return
                if (pendingPre) {
                    pushHistory(pendingPre)
                    pendingPre = null
                }
                selectedItems().forEach((it) => (it.size = v))
                emit()
            },
            setAll(v) {
                v = Math.max(MIN, Math.min(MAX, Math.round(v)))
                if (selectedItems().every((it) => it.size === v)) return
                this._consumeOrPush()
                selectedItems().forEach((it) => (it.size = v))
                emit()
            },
            nudge(s) {
                this._consumeOrPush()
                selectedItems().forEach(
                    (it) =>
                        (it.size = Math.max(MIN, Math.min(MAX, it.size + s)))
                )
                emit()
            },
        }

        function buildPanel() {
            const fontDD = makeSelect([
                "Inter",
                "Helvetica Neue",
                "SF Pro",
                "Roboto",
                "Georgia",
                "IBM Plex Sans",
            ])
            fontDD.querySelector("select").disabled = true

            const row = document.createElement("div")
            row.className = "proprow"
            const weightDD = makeSelect([
                { label: "Light", value: 300 },
                { label: "Regular", value: 400 },
                { label: "Medium", value: 500 },
                { label: "Semibold", value: 600 },
                { label: "Bold", value: 700 },
            ])
            weightDD.classList.add("grow")
            weightDD.querySelector("select").value = "400"
            weightDD.querySelector("select").disabled = true

            const sizewrap = document.createElement("div")
            sizewrap.className = "sizewrap"
            const field = document.createElement("div")
            field.className = "sizefield"
            const input = document.createElement("input")
            input.type = "text"
            input.className = "sizeinput"
            input.setAttribute("inputmode", "numeric")
            input.setAttribute("aria-label", "Font size")
            const chevronBtn = document.createElement("button")
            chevronBtn.type = "button"
            chevronBtn.className = "sizechevron"
            chevronBtn.tabIndex = -1
            chevronBtn.setAttribute("aria-label", "Show size controls")
            chevronBtn.innerHTML = '<span class="chev"></span>'
            field.append(input, chevronBtn)
            sizewrap.appendChild(field)

            const tooltip = document.createElement("div")
            tooltip.className = "tooltip-summary"
            const dotsRow = document.createElement("div")
            dotsRow.className = "dots-row"
            const summaryText = document.createElement("div")
            summaryText.className = "summary-text"
            tooltip.append(dotsRow, summaryText)
            sizewrap.appendChild(tooltip)

            row.append(weightDD, sizewrap)

            const drawer = document.createElement("div")
            drawer.className = "sizedrawer"

            let open = false
            function setOpen(v) {
                if (selection.size === 0) v = false
                open = v
                drawer.classList.toggle("open", v)
                if (v) tooltip.classList.remove("visible")
            }

            function mountWidget() {
                drawer.innerHTML = ""
                activeWidget = makeWidget(VARIANTS[activeVariant], adapter)
                drawer.appendChild(activeWidget.el)
                // keep open state exactly as it was — swapping the version must not reset the panel
            }

            function updateField(force) {
                const sel = selectedItems()
                if (sel.length === 0) {
                    input.value = ""
                    input.placeholder = "–"
                    input.disabled = true
                    chevronBtn.disabled = true
                    setOpen(false)
                    return
                }
                input.disabled = false
                chevronBtn.disabled = false
                if (document.activeElement === input && !force) return // don't clobber what the user is typing
                const vals = sel.map((it) => it.size)
                const allEqual = vals.every((v) => v === vals[0])
                if (allEqual) {
                    input.value = vals[0]
                    input.classList.remove("mixed")
                } else {
                    input.value = "Mixed"
                    input.classList.add("mixed")
                }
            }
            function updateTooltip() {
                const sel = selectedItems()
                dotsRow.innerHTML = ""
                sel.forEach((it) => {
                    const dot = document.createElement("span")
                    dot.className = "dot"
                    dot.style.background = selColor(it.id)
                    dotsRow.appendChild(dot)
                })
                const vals = sel.map((it) => it.size)
                if (!vals.length) {
                    summaryText.textContent = "No layers selected"
                    return
                }
                const min = Math.min(...vals),
                    max = Math.max(...vals)
                const distinct = new Set(vals).size
                summaryText.innerHTML =
                    min === max
                        ? "<b>" + min + "px</b>"
                        : "<b>" +
                          min +
                          "–" +
                          max +
                          "px</b> · " +
                          distinct +
                          " distinct layers"
            }

            chevronBtn.addEventListener("click", (e) => {
                e.stopPropagation()
                setOpen(!open)
            })
            input.addEventListener("focus", () => {
                input.select()
                adapter.beginGesture()
            })
            input.addEventListener("input", () => {
                const v = parseFloat(input.value)
                if (!isNaN(v)) adapter.setAll(v) // applies live as you type
            })
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    input.blur()
                    return
                }
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault()
                    adapter.nudge(e.key === "ArrowUp" ? 1 : -1)
                    updateField(true) // force: this is a real value change, not mid-typing
                }
            })
            input.addEventListener("blur", () => {
                adapter.cancelGesture()
                updateField()
            })
            sizewrap.addEventListener("mouseenter", () => {
                if (!open && selection.size > 1) {
                    updateTooltip()
                    tooltip.classList.add("visible")
                }
            })
            sizewrap.addEventListener("mouseleave", () =>
                tooltip.classList.remove("visible")
            )
            onDoc("click", (e) => {
                if (
                    open &&
                    !sizewrap.contains(e.target) &&
                    !drawer.contains(e.target)
                )
                    setOpen(false)
            })

            panelGroup.append(fontDD, row, drawer)
            mountWidget()
            updateField()
            setOpen(true)

            panelAPI = {
                updateField,
                updateTooltip: () => {
                    if (tooltip.classList.contains("visible")) updateTooltip()
                },
                mountWidget,
            }
        }

        /* ================= version switching ================= */
        function activateVariant(num) {
            if (num === activeVariant) return
            activeVariant = num
            panelAPI.mountWidget() // swaps only the widget inside the drawer — open state and dropdowns untouched
            updateVariantButtons()
        }

        function updateVariantButtons() {
            let activeBtn = null
            root.querySelectorAll(".vergroup .vbtn").forEach((b) => {
                const on = Number(b.dataset.v) === activeVariant
                b.classList.toggle("active", on)
                if (on) activeBtn = b
            })
            // the blue highlight slides between buttons instead of popping
            const vind = root.querySelector("#vind")
            if (activeBtn && vind) {
                vind.style.left = activeBtn.offsetLeft + "px"
                vind.style.width = activeBtn.offsetWidth + "px"
            }
        }

        /* ================= wire up ================= */
        subscribe(renderCanvas)

        let lastSelSig = ""
        subscribe(() => {
            updateProps()
            updateAlignButtons()
            if (panelAPI) {
                panelAPI.updateField()
                panelAPI.updateTooltip()
            }
            if (!activeWidget) return
            const sig = Array.from(selection)
                .sort((a, b) => a - b)
                .join(",")
            if (sig !== lastSelSig) {
                lastSelSig = sig
                activeWidget.rebuild()
            } else {
                activeWidget.refresh()
            }
        })

        renderCanvas()
        centerDefaultItems() // needs real measurements from the render above
        renderCanvas() // re-render with the centered positions
        buildPanel()
        updateProps()
        updateAlignButtons()
        updateVariantButtons()

        return () => {
            docListeners.forEach(([t, f]) => document.removeEventListener(t, f))
            root.innerHTML = ""
        }
    }, [])

    // Kept separate from the setup effect above (which has an empty dep
    // array): re-running that one on every color tweak would wipe the demo's
    // items/selection/undo history. This effect just paints three props onto
    // the already-mounted DOM.
    useEffect(() => {
        const root = ref.current
        if (!root) return
        const appEl = root.querySelector(".app")
        if (appEl) {
            appEl.style.borderRadius = cornerRadius + "px"
            appEl.style.borderColor = borderColor
        }
        const canvasEl = root.querySelector("#canvas")
        // backgroundColor only (not the `background` shorthand) so the
        // dot-grid background-image from the CSS class survives untouched.
        if (canvasEl) canvasEl.style.backgroundColor = canvasColor
    }, [canvasColor, cornerRadius, borderColor])

    return (
        <div style={{ width: "100%", height: "100%" }}>
            <style>{CSS}</style>
            <link
                rel="stylesheet"
                href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
            />
            <div ref={ref} style={{ width: "100%", height: "100%" }} />
        </div>
    )
}

const MARKUP = `
<div class="app">
    <div class="canvas-wrap">
      <div class="canvas" id="canvas"></div>

    </div>
    <div class="sidepanel">
      <div class="sp-section">
        <div class="alignrow" id="alignRow"></div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Versions</div>
        <div class="vergroup">
          <div class="vind" id="vind"></div>
          <button class="vbtn" data-v="1" tabindex="-1">1</button>
          <button class="vbtn" data-v="2" tabindex="-1">2</button>
          <button class="vbtn" data-v="3" tabindex="-1">3</button>
        </div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Text</div>
        <div class="propgroup" id="panelGroup"></div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Position</div>
        <div class="proprow">
          <div class="pi"><span class="pi-key">X</span><input id="posX" inputmode="numeric" aria-label="X position"></div>
          <div class="pi"><span class="pi-key">Y</span><input id="posY" inputmode="numeric" aria-label="Y position"></div>
        </div>
        <div class="proprow">
          <div class="pi"><span class="pi-key">W</span><input id="dimW" disabled aria-label="Width"></div>
          <div class="pi"><span class="pi-key">H</span><input id="dimH" disabled aria-label="Height"></div>
        </div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Fill</div>
        <div class="fillrow"><span class="swatch"></span><span class="hex">1C1C1C</span><span class="pct">100%</span></div>
      </div>
    </div>
  </div>
`

const CSS = `
:root{
    --accent:#0c8ce9;
  }

  /* ================= demo app ================= */
  .app{
    display:flex;background:#ffffff;border:1px solid #dedede;border-radius:10px;
    width:100%;height:100%;overflow:hidden;
    font-family:'Inter',system-ui,sans-serif;color:#1c1c1c;
    -webkit-font-smoothing:antialiased;box-sizing:border-box;
  }
  .app *{box-sizing:border-box;}

  /* ---- canvas ---- */
  .canvas-wrap{position:relative;flex:1;min-width:0;}
  .canvas{
    position:absolute;inset:0;overflow:hidden;
    background:#fafaf9;
    user-select:none;
  }
  /* cursor:pointer is the CustomCursor hand trigger — it reads the computed
     cursor value, so anything draggable here gets the morphing hand for free */
  .titem{
    position:absolute;cursor:pointer;white-space:nowrap;line-height:1.2;
    padding:2px 6px;border-radius:2px;color:#1c1c1c;
  }
  .titem.dragging{cursor:pointer;}
  .titem:hover, .titem.sel-underline{
    text-decoration:underline;
    text-decoration-color:#008FF0;
    text-decoration-thickness:1.5px;
    text-underline-offset:0px;
    text-decoration-skip-ink:none;
  }
  .titem[contenteditable="true"]{text-decoration:none;}
  /* cursor:text while editing → CustomCursor swaps to the text beam */
  .titem[contenteditable="true"]{cursor:text;user-select:text;box-shadow:0 0 0 1.5px var(--accent);}

  /* Figma-style selection overlay */
  .selbox{
    position:absolute;border:1.5px solid var(--accent);pointer-events:none;z-index:8;
  }
  .selhandle{
    position:absolute;width:9px;height:9px;background:#fff;border:1.5px solid var(--accent);
    border-radius:1.5px;
  }
  .selhandle.tl{left:-5px;top:-5px;} .selhandle.tr{right:-5px;top:-5px;}
  .selhandle.bl{left:-5px;bottom:-5px;} .selhandle.br{right:-5px;bottom:-5px;}
  .selsize{
    position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);
    background:var(--accent);color:#fff;font-size:10.5px;font-weight:500;
    padding:2px 7px;border-radius:4px;white-space:nowrap;font-variant-numeric:tabular-nums;
    user-select:none;
  }

  .marquee{
    position:absolute;border:1px solid #008FF0;background:rgba(0,143,240,.15);
    pointer-events:none;z-index:9;
  }

  /* floating toolbar pill: T + version switches */
  .vergroup{
    position:relative;display:flex;gap:5px;background:#f2f2f0;border-radius:10px;padding:3px;
  }
  .vbtn{
    position:relative;z-index:1;flex:1;
    height:26px;border:none;border-radius:8px;background:transparent;
    cursor:pointer;font-family:inherit;font-size:11.5px;color:#1c1c1c;
    display:flex;align-items:center;justify-content:center;
    font-variant-numeric:tabular-nums;transition:color .18s;
  }
  .vbtn.active{color:#fff;font-weight:600;}
  .vind{
    position:absolute;top:3px;height:26px;border-radius:8px;background:var(--accent);
    transition:left .18s cubic-bezier(.3,.9,.4,1), width .18s ease;z-index:0;
  }

  /* ---- side panel ---- */
  .sidepanel{
    width:230px;flex-shrink:0;border-left:1px solid #ececea;background:#fff;
    padding:8px 8px 16px;display:flex;flex-direction:column;gap:14px;
    overflow-y:auto;scrollbar-width:none;
  }
  .sidepanel::-webkit-scrollbar{display:none;}
  .sp-section{display:flex;flex-direction:column;gap:8px;padding:0 4px;}
  .sp-divider{height:1px;background:#f0f0ee;margin:0 -8px;}
  .sp-label{font-size:11px;font-weight:600;color:#9a9a9a;text-transform:uppercase;letter-spacing:.05em;}

  .alignrow{display:flex;justify-content:space-between;padding:2px 4px;}
  .alignbtn{
    width:26px;height:24px;border:none;border-radius:6px;background:transparent;
    display:flex;align-items:center;justify-content:center;cursor:pointer;
    transition:background .12s, opacity .12s;
  }
  .alignbtn:hover{background:#f2f2f0;}
  .alignbtn:active{transform:translateY(1px);}
  .alignbtn:disabled{opacity:.3;cursor:default;}
  .alignbtn:disabled:hover{background:transparent;}
  .alignbtn svg{display:block;}

  .pi{
    display:flex;align-items:center;background:#f2f2f0;border-radius:10px;
    flex:1;min-width:0;overflow:hidden;
  }
  .pi .pi-key{font-size:10px;font-weight:700;color:#9a9a9a;width:16px;text-align:center;flex-shrink:0;user-select:none;margin-left:3px;}
  .pi input{
    flex:1;min-width:0;border:none;background:transparent;outline:none;
    font-family:inherit;font-size:12px;color:#1c1c1c;padding:9px 8px 9px 0;
    font-variant-numeric:tabular-nums;
  }
  .pi input:disabled{color:#b0b0ae;}
  .pi:has(input:focus){background:#e8e8e5;}

  .fillrow{display:flex;align-items:center;gap:8px;background:#f2f2f0;border-radius:10px;padding:7px 10px;opacity:.5;}
  .fillrow .swatch{width:16px;height:16px;border-radius:4px;background:#1c1c1c;border:1px solid #d0d0d0;flex-shrink:0;}
  .fillrow .hex{font-size:12px;color:#1c1c1c;font-variant-numeric:tabular-nums;}
  .fillrow .pct{font-size:12px;color:#9a9a9a;margin-left:auto;font-variant-numeric:tabular-nums;}
  .propgroup{display:flex;flex-direction:column;gap:12px;}
  .proprow{display:flex;gap:6px;}

  .dd-wrap{position:relative;flex:1;min-width:0;}
  .dd-wrap.grow{flex:1.15;}
  .dd-wrap::after{
    content:'';position:absolute;right:8px;top:50%;width:6px;height:6px;
    border-right:1.5px solid #9a9a9a;border-bottom:1.5px solid #9a9a9a;
    transform:translateY(-70%) rotate(45deg);pointer-events:none;
  }
  .dd{
    -webkit-appearance:none;appearance:none;
    width:100%;background:#f2f2f0;border:none;border-radius:10px;
    padding:9px 20px 9px 10px;font-family:inherit;font-size:12px;color:#1c1c1c;
    cursor:pointer;text-overflow:ellipsis;
  }
  .dd:hover{background:#e8e8e5;}
  .dd:focus{outline:2px solid var(--accent);outline-offset:1px;}
  .dd:disabled{color:#b0b0ae;cursor:default;}
  .dd:disabled:hover{background:#f2f2f0;}
  .dd-wrap:has(.dd:disabled)::after{border-color:#c9c9c7;}

  /* size field: input + white seam + chevron */
  .sizewrap{position:relative;flex:1;min-width:84px;}
  .sizefield{display:flex;align-items:stretch;background:#f2f2f0;border-radius:10px;overflow:hidden;}
  .sizeinput{
    flex:1;min-width:0;border:none;background:transparent;
    font-family:inherit;font-size:12px;color:#1c1c1c;
    padding:9px 6px 9px 10px;outline:none;
  }
  .sizeinput.mixed{color:#9a9a9a;font-style:italic;}
  .sizeinput:disabled{color:#c4c4c2;}
  .sizeinput:focus{background:#e8e8e5;}
  .sizechevron{
    flex-shrink:0;width:26px;border:none;background:transparent;cursor:pointer;
    display:flex;align-items:center;justify-content:center;border-left:1px solid #ffffff;
  }
  .sizechevron:hover{background:#e8e8e5;}
  .sizechevron:disabled{cursor:default;opacity:.4;}
  .sizechevron:disabled:hover{background:transparent;}
  .sizechevron .chev{
    width:6px;height:6px;border-right:1.5px solid #9a9a9a;border-bottom:1.5px solid #9a9a9a;
    transform:rotate(45deg) translate(-1px,-1px);
  }

  .tooltip-summary{
    position:absolute;top:calc(100% + 8px);right:0;width:186px;
    background:#fff;border:1px solid #dedede;border-radius:9px;
    box-shadow:0 12px 28px rgba(0,0,0,.14);padding:10px 12px;z-index:30;
    opacity:0;transform:translateY(4px);pointer-events:none;
    transition:opacity .12s ease, transform .12s ease;
  }
  .tooltip-summary.visible{opacity:1;transform:translateY(0);}
  .tooltip-summary .dots-row{display:flex;gap:5px;margin-bottom:7px;}
  .tooltip-summary .dots-row .dot{width:7px;height:7px;border-radius:50%;}
  .tooltip-summary .summary-text{font-size:11.5px;color:#6e6e6e;line-height:1.5;}
  .tooltip-summary .summary-text b{color:#1c1c1c;font-variant-numeric:tabular-nums;}

  .sizedrawer{
    max-height:0;opacity:0;overflow:hidden;margin-top:-12px;
    transition:max-height .22s ease, opacity .1s ease, margin-top .2s ease;
  }
  .sizedrawer.open{
    max-height:320px;opacity:1;margin-top:0;overflow:visible;
    transition:max-height .22s ease, opacity .15s ease .05s, margin-top .2s ease;
  }

  /* ================= widget ================= */
  .w{position:relative;width:100%;}
  .flank{display:flex;align-items:stretch;gap:6px;}
  .flank .stack{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;}

  .stepcol{display:flex;flex-direction:column;align-self:stretch;flex-shrink:0;width:28px;}
  .stepcol button{
    flex:1;border:none;font-family:inherit;color:#1c1c1c;cursor:pointer;line-height:1;
    display:flex;align-items:center;justify-content:center;font-size:12px;
    background:#f2f2f0;transition:background .12s;
  }
  .stepcol button:hover{background:#e8e8e5;}
  .stepcol button:active{transform:translateY(1px);}
  .stepcol .up{border-radius:10px 10px 0 0;border-bottom:1px solid #ffffff;}
  .stepcol .dn{border-radius:0 0 10px 10px;}

  .bottomrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;}
  .pills{display:flex;flex-wrap:wrap;gap:5px;align-items:center;}
  .pill{
    font-family:inherit;background:#fff;border:1px solid #d0d0d0;
    color:#1c1c1c;border-radius:14px;padding:4px 9px;font-size:10.5px;
    cursor:pointer;font-variant-numeric:tabular-nums;flex-shrink:0;
  }
  .pill:hover{border-color:var(--accent);}

  .track{
    position:relative;z-index:2;background:#f2f2f0;border-radius:10px;height:56px;
    transition:border-radius .2s ease;
  }
  .ruler{position:relative;z-index:1;overflow:hidden;background:#f2f2f0;}
  .rtick{position:absolute;width:1px;background:#c4c4c4;bottom:5px;}
  .rtick.major{background:#8a8a8a;height:8px;}
  .rtick.minor{height:4px;opacity:.5;}
  .rlabel{
    position:absolute;bottom:13px;transform:translateX(-50%);font-size:9.5px;color:#9a9a9a;
    font-variant-numeric:tabular-nums;white-space:nowrap;transition:opacity .15s;
    user-select:none;-webkit-user-select:none;pointer-events:none;
  }

  /* cursor:pointer here too — slider handles get the CustomCursor hand */
  .handle{
    position:absolute;top:0;bottom:0;width:22px;transform:translateX(-50%);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;touch-action:none;
    transition:left .25s cubic-bezier(.3,.9,.4,1);
  }
  .handle.dragging{transition:none;cursor:pointer;}
  .hshape{
    display:flex;align-items:center;justify-content:center;
    transition:background-color .25s ease, width .16s ease, height .16s ease,
               border-radius .16s ease, transform .16s ease, filter .1s, opacity .12s ease;
  }
  .shape-bar .hshape{width:4px;height:24px;border-radius:3px;}
  .shape-bar .handle:hover .hshape, .shape-bar .handle.dragging .hshape{width:8px;height:34px;border-radius:5px;}
  .shape-diamond .hshape{width:10px;height:10px;border-radius:2px;transform:rotate(45deg);}

  .numtag{
    position:absolute;left:50%;
    font-size:9.5px;font-weight:600;color:#111;
    background:#fff;border:1px solid #d6d6d6;border-radius:6px;padding:2px 6px;
    font-variant-numeric:tabular-nums;pointer-events:none;opacity:0;
    transition:opacity .15s ease, transform .18s cubic-bezier(.3,.9,.4,1);
    white-space:nowrap;z-index:6;user-select:none;-webkit-user-select:none;
  }
  .numtag-above .numtag{bottom:calc(100% - 10px);transform:translate(-50%,6px);}
  .numtag-below .numtag{top:calc(100% - 10px);transform:translate(-50%,-6px);}
  .numtag-above .handle:hover .numtag, .numtag-above .handle.dragging .numtag,
  .numtag-below .handle:hover .numtag, .numtag-below .handle.dragging .numtag{
    opacity:1;transform:translate(-50%,0);
  }

  .rulerchip{
    position:absolute;bottom:11px;transform:translateX(-50%);
    font-size:10px;font-weight:700;color:#fff;background:#111;
    border-radius:5px;padding:1px 5px;font-variant-numeric:tabular-nums;
    pointer-events:none;opacity:0;transition:opacity .12s;z-index:3;white-space:nowrap;
    user-select:none;-webkit-user-select:none;
  }
  .rulerchip.on{opacity:1;}
  .ruler.dimlabels .rlabel{opacity:.25;}
`

addPropertyControls(FontSizeCanvas, {
    canvasColor: {
        type: ControlType.Color,
        title: "Canvas Color",
        defaultValue: "#fafaf9",
    },
    cornerRadius: {
        type: ControlType.Number,
        title: "Corner Radius",
        min: 0,
        max: 40,
        step: 1,
        defaultValue: 10,
    },
    borderColor: {
        type: ControlType.Color,
        title: "Border Color",
        defaultValue: "#dedede",
    },
})
