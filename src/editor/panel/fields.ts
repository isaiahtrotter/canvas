// Form controls shared by the side panel's sections.
import type { EditorContext } from "../core/context"
import type { TextItem } from "../core/types"

// Every numeric field steps with the arrow keys: ±1 unit, ×10 with Shift
export function arrowStep(e: KeyboardEvent, unit = 1) {
    const dir = e.key === "ArrowUp" ? 1 : -1
    return dir * unit * (e.shiftKey ? 10 : 1)
}

export function makeSelect(options: Array<string | { label: string; value: string | number }>, onChange?: (v: string) => void) {
    const wrap = document.createElement("div")
    wrap.className = "dd-wrap"
    const sel = document.createElement("select")
    sel.className = "dd"
    options.forEach((o) => {
        const opt = document.createElement("option")
        const isObj = typeof o === "object"
        opt.value = String(isObj ? o.value : o)
        opt.textContent = isObj ? o.label : o
        sel.appendChild(opt)
    })
    if (onChange)
        sel.addEventListener("change", () => onChange(sel.value))
    wrap.appendChild(sel)
    return wrap
}

// a compact segmented control with the sliding highlight, like the settings' .seg
export function makeSeg<T extends string>(
    options: Array<{ value: T; label: string; icon?: string; title?: string }>,
    onPick: (v: T) => void
) {
    const el = document.createElement("div")
    el.className = "lseg"
    const ind = document.createElement("div")
    ind.className = "segind"
    el.appendChild(ind)
    const btns = options.map((o) => {
        const b = document.createElement("button")
        b.type = "button"
        b.tabIndex = -1
        b.dataset.value = o.value
        b.innerHTML = (o.icon ?? "") + (o.label ? `<span>${o.label}</span>` : "")
        if (o.title) b.title = o.title
        b.addEventListener("click", () => onPick(o.value))
        el.appendChild(b)
        return b
    })
    let placed = false
    function set(v: T) {
        btns.forEach((b) => b.classList.toggle("active", b.dataset.value === v))
        const a = btns.find((b) => b.dataset.value === v)
        if (!a || !a.offsetWidth) return
        if (!placed) ind.style.transition = "none"
        ind.style.left = a.offsetLeft + "px"
        ind.style.width = a.offsetWidth + "px"
        if (!placed) {
            placed = true
            void ind.offsetWidth
            ind.style.transition = ""
        }
    }
    return { el, set }
}

/* A .pi number field bound to one numeric property of the selected text
   (line height, letter spacing). Applies live as you type; a typing session
   is one undo step. */
export function numField(
    ctx: EditorContext,
    key: string,
    label: string,
    read: (it: TextItem) => number,
    write: (it: TextItem, v: number) => void,
    step: number,
    decimals: number
) {
    const selectedTextItems = () => ctx.store.selectedTextItems()
    const { emit } = ctx.bus
    const pi = document.createElement("div")
    pi.className = "pi"
    const k = document.createElement("span")
    k.className = "pi-key"
    k.textContent = key
    const input = document.createElement("input")
    input.setAttribute("inputmode", "decimal")
    input.setAttribute("aria-label", label)
    input.title = label
    pi.append(k, input)
    let pre = null
    const fmt = (v: number) => String(Number(v.toFixed(decimals)))
    function apply(v: number) {
        const sel = selectedTextItems()
        if (!sel.length || sel.every((it) => read(it) === v)) return
        if (pre) {
            ctx.store.pushHistory(pre)
            pre = null
        }
        sel.forEach((it) => write(it, v))
        emit()
    }
    function update(force?: boolean) {
        const sel = selectedTextItems()
        input.disabled = !sel.length
        if (!sel.length) {
            input.value = ""
            input.placeholder = "–"
            return
        }
        if (document.activeElement === input && !force) return
        const vals = sel.map(read)
        const same = vals.every((v) => v === vals[0])
        input.value = same ? fmt(vals[0]) : ""
        input.placeholder = same ? "" : "Mixed"
    }
    input.addEventListener("focus", () => {
        pre = ctx.store.snapshot()
        input.select()
    })
    input.addEventListener("input", () => {
        const v = parseFloat(input.value)
        if (!isNaN(v)) apply(Number(v.toFixed(decimals)))
    })
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            input.blur()
            return
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const sel = selectedTextItems()
            if (!sel.length) return
            const s = arrowStep(e, step)
            if (!pre) pre = ctx.store.snapshot()
            ctx.store.pushHistory(pre)
            pre = null
            sel.forEach((it) => write(it, Number((read(it) + s).toFixed(decimals))))
            emit()
            update(true)
        }
    })
    input.addEventListener("blur", () => {
        pre = null
        update(true)
    })
    return { el: pi, update }
}

// a .pi number field bound to one layout property of the selected frame
export function layoutNumField(ctx: EditorContext, key: string, label: string, prop: "gap" | "padding") {
    const { emit } = ctx.bus
    const pi = document.createElement("div")
    pi.className = "pi"
    const k = document.createElement("span")
    k.className = "pi-key"
    k.innerHTML = key // a letter or an inline icon
    const input = document.createElement("input")
    input.setAttribute("inputmode", "numeric")
    input.setAttribute("aria-label", label)
    input.title = label
    pi.append(k, input)
    let pre = null
    function apply(v: number) {
        const f = ctx.store.singleSelectedFrame()
        if (!f?.layout || f.layout[prop] === v) return
        if (pre) {
            ctx.store.pushHistory(pre)
            pre = null
        }
        f.layout = { ...f.layout, [prop]: v }
        f.updatedAt = Date.now()
        emit()
    }
    function update(force?: boolean) {
        const f = ctx.store.singleSelectedFrame()
        if (!f?.layout) return
        if (document.activeElement === input && !force) return
        input.value = String(f.layout[prop])
    }
    input.addEventListener("focus", () => {
        pre = ctx.store.snapshot()
        input.select()
    })
    input.addEventListener("input", () => {
        const v = parseFloat(input.value)
        if (!isNaN(v)) apply(Math.max(0, Math.round(v)))
    })
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            input.blur()
            return
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const f = ctx.store.singleSelectedFrame()
            if (!f?.layout) return
            if (!pre) pre = ctx.store.snapshot()
            apply(Math.max(0, f.layout[prop] + arrowStep(e)))
            update(true)
        }
    })
    input.addEventListener("blur", () => {
        pre = null
        update(true)
    })
    return { el: pi, update }
}
