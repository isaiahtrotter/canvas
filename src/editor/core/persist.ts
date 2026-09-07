// Persistence: the document (layers, counters, background, view) lives in
// localStorage so a refresh picks up where you left off. Saves are debounced
// 150ms behind emit(); pagehide flushes the last one.
import type { EditorContext, Disposable } from "./context"
import { type FrameItem, isFrame, isText } from "./types"
import { isHex } from "../color"

export interface PersistAPI {
    saveDoc(): void
    /** debounced save, called by every emit() */
    scheduleSave(): void
    /** load canvas.doc.v1 into ctx.doc, migrating older documents; false when there is none */
    loadDoc(): boolean
}

export function installPersist(ctx: EditorContext): PersistAPI & Disposable {
    const items = ctx.doc.items
    const view = ctx.doc.view

    const DOC_KEY = "canvas.doc.v1"
    let saveTimer = null
    function saveDoc() {
        try {
            localStorage.setItem(
                DOC_KEY,
                JSON.stringify({ items, nextId: ctx.doc.nextId, frameCount: ctx.doc.frameCount, bg: ctx.doc.bg, view })
            )
        } catch (_) {
            /* storage unavailable or full — the session still works, just doesn't persist */
        }
    }
    function scheduleSave() {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(saveDoc, 150)
    }
    function loadDoc(): boolean {
        try {
            const raw = localStorage.getItem(DOC_KEY)
            if (!raw) return false
            const d = JSON.parse(raw)
            if (!Array.isArray(d.items)) return false
            d.items.forEach((it) => items.push(it))
            // documents from before explicit membership: a text belongs to the
            // smallest frame its top-left corner falls in
            items.filter(isText).forEach((t) => {
                if (t.parent !== undefined) return
                let best: FrameItem | null = null
                items.filter(isFrame).forEach((f) => {
                    const inside = t.x >= f.x && t.y >= f.y && t.x < f.x + f.w && t.y < f.y + f.h
                    if (inside && (!best || f.w * f.h < best.w * best.h)) best = f
                })
                t.parent = best ? best.id : null
            })
            // frames from before explicit nesting: a frame belongs to the
            // smallest frame it sits fully inside
            items.filter(isFrame).forEach((g) => {
                if (g.parent !== undefined) return
                const p = ctx.geo.frameEnclosing(g, g.id)
                g.parent = p ? p.id : null
            })
            // text saved before it had its own edit time: inherit its frame's
            items.filter(isText).forEach((t) => {
                if (typeof t.updatedAt === "number") return
                const f = items.find((it) => it.id === t.parent)
                t.updatedAt = f && isFrame(f) ? f.updatedAt : Date.now()
            })
            ctx.doc.nextId = typeof d.nextId === "number" ? d.nextId : items.reduce((m, it) => Math.max(m, it.id), 0) + 1
            ctx.doc.frameCount = typeof d.frameCount === "number" ? d.frameCount : items.filter(isFrame).length
            if (d.bg && isHex(d.bg.hex)) ctx.doc.bg = { hex: d.bg.hex, alpha: d.bg.alpha ?? 100 }
            if (d.view && Number.isFinite(d.view.x) && Number.isFinite(d.view.y) && d.view.z > 0)
                Object.assign(view, d.view)
            return true
        } catch (_) {
            return false
        }
    }
    const onPageHide = () => {
        clearTimeout(saveTimer)
        saveDoc()
    }
    window.addEventListener("pagehide", onPageHide)

    return {
        saveDoc,
        scheduleSave,
        loadDoc,
        dispose() {
            clearTimeout(saveTimer)
            window.removeEventListener("pagehide", onPageHide)
        },
    }
}
