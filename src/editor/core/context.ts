// The one object every editor module shares. Created once per mount by
// `mountEditor`, then handed to each module's `install*(ctx)`.
//
// Rules (see CLAUDE.md):
// - Document data lives in `doc`, the emit-diff switches in `flags`, and any
//   interaction state that one module writes and another reads in `ui`. Read
//   these live off `ctx` — never destructure a mutable field into a local.
// - Cross-module *calls* go through the typed slots (`ctx.store.…`, `ctx.view.…`)
//   and are resolved at call time, so modules may depend on each other in
//   both directions without import cycles. A module's `install` body may
//   only call modules installed before it; everything else waits for an event.
import type { EditorHooks, Fill, Item, Tool } from "./types"
import type { ToolsAPI } from "../tools/tools"

export interface Doc {
    // everything saveDoc() serializes — keep this key order, it is the JSON order
    items: Item[]
    selection: Set<number>
    nextId: number
    frameCount: number
    bg: Fill
    view: { x: number; y: number; z: number } // mutated in place (Object.assign), never replaced
}

/** Switches read by `touchParentFrames()` during an emit. */
export interface TouchFlags {
    /** undo/redo/initial load: a restored snapshot keeps the timestamps it was saved with */
    restoring: boolean
    /** true only while a frame-drag's own emit() is diffing */
    carryingFrameDrag: boolean
    /** true while an option/ctrl-drag's final emit() settles (the frame it passed through does not light up) */
    suppressLeaveBump: boolean
    /** true while a drag re-renders mid-gesture: nothing is diffed or stamped */
    skipTouch: boolean
}

/** Interaction state one module writes and another reads. Read it live off ctx. */
export interface UiState {
    tool: Tool // tools → read by pointer handlers and the keymap
}

export interface Dom {
    app: HTMLElement
    canvas: HTMLElement
    world: HTMLElement
    overlay: HTMLElement
    canvasWrap: HTMLElement
}

export interface Bus {
    subscribe(fn: () => void): void
    /** Run after any change: stamps parent frames, re-runs every subscriber, schedules a save. */
    emit(): void
}

export type Disposable = { dispose?(): void }

// Module slots. Each is filled by mountEditor when that module installs; the
// interfaces grow as modules are extracted from engine.ts.
export interface StoreAPI {
    touchParentFrames(): void
}
export interface PersistAPI {
    scheduleSave(): void
}

export interface EditorContext {
    root: HTMLElement
    hooks: EditorHooks
    dom: Dom
    doc: Doc
    flags: TouchFlags
    ui: UiState
    bus: Bus
    /** document-level listener that unmount removes */
    onDoc<K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void): void
    disposeDocListeners(): void
    /** the canvas node for an item id (first match under #canvas — a frame's label also carries the id but sits later in the DOM) */
    nodeFor(id: number): HTMLElement | null

    store: StoreAPI
    persist: PersistAPI
    tools: ToolsAPI
}

export const CANVAS_DEFAULT = "#ededed"

export function createContext(root: HTMLElement, hooks: EditorHooks): EditorContext {
    const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)
    const canvas = q("#canvas")
    const docListeners: Array<[string, EventListener]> = []
    const listeners: Array<() => void> = []
    const ctx = {
        root,
        hooks,
        dom: {
            app: q(".app"),
            canvas,
            world: q("#world"),
            overlay: q("#overlay"),
            canvasWrap: canvas.parentElement as HTMLElement,
        },
        doc: {
            items: [],
            selection: new Set<number>(),
            nextId: 1,
            frameCount: 0,
            bg: { hex: CANVAS_DEFAULT, alpha: 100 },
            view: { x: 0, y: 0, z: 1 },
        },
        flags: { restoring: false, carryingFrameDrag: false, suppressLeaveBump: false, skipTouch: false },
        ui: { tool: "move" },
        bus: {
            subscribe(fn) {
                listeners.push(fn)
            },
            emit() {
                ctx.store.touchParentFrames()
                listeners.forEach((fn) => fn())
                ctx.persist.scheduleSave()
            },
        },
        onDoc(type, fn) {
            document.addEventListener(type, fn)
            docListeners.push([type, fn as EventListener])
        },
        disposeDocListeners() {
            docListeners.forEach(([t, f]) => document.removeEventListener(t, f))
        },
        nodeFor: (id: number) => canvas.querySelector<HTMLElement>('[data-id="' + id + '"]'),
    } as EditorContext
    return ctx
}
