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
import type { EditorHooks, Fill, FrameItem, Item, TextItem, Tool } from "./types"
import type { DrillAPI } from "../selection/drill"
import type { CanvasAPI } from "../canvas/render"
import type { LayoutAPI } from "../canvas/layout"
import type { OverlayAPI } from "../selection/overlay"
import type { SnapAPI } from "../selection/snap"
import type { ToolsAPI } from "../tools/tools"
import type { SettingsAPI } from "../settings/settings"
import type { TimesAPI } from "../times/times"
import type { MinimapAPI } from "../minimap/minimap"
import type { LayersAPI } from "../layers/layers"
import type { MeasureAPI } from "../measure/measure"
import type { ViewAPI } from "../view/view"

export interface Rect {
    x: number
    y: number
    w: number
    h: number
}
import { type Prefs, loadPrefs } from "../settings/prefs"

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
    settingsOpen: boolean // settings → both keydown handlers bail while the dialog is up
    heat: boolean // times → renderCanvas re-applies heat colors; fill.applyBg picks the thermal palette
    lastHover: HTMLElement | null // measure / layers → the layer node under the pointer, read by the overlay
    spaceDown: boolean // view → pointer handlers pan instead of selecting while Space is held
    enteredFrame: number | null // drill → the nested frame whose contents are directly selectable; keymap/pointerdown reset it
    editingEl: HTMLElement | null // gestures → the contenteditable text node; render/clips/overlay/keymap leave it alone
    hoverWash: { id: number; color: string } | null // panel (size handles) → render.applyWash tints that text
    hideSelBoxWhileNesting: boolean // drag → overlay skips the selection box while a frame is dragged inside another
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
export interface Snapshot {
    items: Item[]
    selection: number[]
}
export interface StoreAPI {
    touchParentFrames(): void
    itemById(id: number): Item | undefined
    containingFrame(it: Item): FrameItem | null
    selectedItems(): Item[]
    singleSelectedFrame(): FrameItem | null
    addItem(props: Partial<TextItem>): TextItem
    addFrame(props: Partial<FrameItem>): FrameItem
    /** a freshly drawn frame takes in the loose items that sit fully inside it */
    adoptLooseText(f: FrameItem): void
    snapshot(): Snapshot
    /** log an undo step — the current state, or `pre` taken before a gesture began */
    pushHistory(pre?: Snapshot): void
    /** the per-text signature/parent seen at the last emit; layout moves update it so they don't count as edits */
    lastText: Map<number, { sig: string; parent: number | null }>
    textSig(it: TextItem): string
}
export interface PersistAPI {
    scheduleSave(): void
}
export interface GeometryAPI {
    /** rendered size in world units (frames know theirs; text is measured off its node) */
    nodeSize(it: Item): { w: number; h: number }
    boundsOf(its: Item[]): Rect | null
    itemBounds(it: Item): Rect
    selectionBounds(): Rect | null
    rectContains(f: FrameItem, it: Item): boolean
    /** smallest frame a box sits fully inside */
    frameEnclosing(r: Rect, exclude?: number): FrameItem | null
    /** smallest frame under a world point */
    frameAt(p: { x: number; y: number }, exclude?: Set<number>): FrameItem | null
    /** an item's rect clipped by every ancestor frame */
    visibleRect(it: Item, w: number, h: number): Rect
    /** client (pointer) coords → world */
    toWorld(clientX: number, clientY: number): { x: number; y: number }
    /** world → canvas-relative screen coords */
    toScreen(x: number, y: number): { x: number; y: number }
    /** position an #overlay element over a world rect, snapped to whole pixels */
    placeScreenRect(el: HTMLElement, r: Rect): void
}
export interface GesturesAPI {
    startRenaming(name: HTMLElement, it: FrameItem): void
    startEditing(el: HTMLElement, it: TextItem): void
    /** drag a selection-box corner ("tl".."br") or edge ("t","r","b","l") to resize a lone frame */
    startResize(e: PointerEvent, it: FrameItem, corner: string): void
}
export interface DragAPI {
    onItemPointerDown(e: PointerEvent, it: Item, el: HTMLElement): void
}
export interface FillAPI {
    applyBg(): void
    updateFill(): void
}
export interface PanelAPI {
    fill: FillAPI
}

export interface EditorContext {
    root: HTMLElement
    hooks: EditorHooks
    dom: Dom
    doc: Doc
    flags: TouchFlags
    ui: UiState
    prefs: Prefs // loaded here, before any module installs, so applyGrid() can read it at any time
    bus: Bus
    /** document-level listener that unmount removes */
    onDoc<K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void): void
    disposeDocListeners(): void
    /** the canvas node for an item id (first match under #canvas — a frame's label also carries the id but sits later in the DOM) */
    nodeFor(id: number): HTMLElement | null

    store: StoreAPI
    persist: PersistAPI
    geo: GeometryAPI
    view: ViewAPI
    minimap: MinimapAPI
    measure: MeasureAPI
    tools: ToolsAPI
    times: TimesAPI
    canvas: CanvasAPI
    layout: LayoutAPI
    layers: LayersAPI
    drill: DrillAPI
    overlay: OverlayAPI
    snap: SnapAPI
    gestures: GesturesAPI
    drag: DragAPI
    panel: PanelAPI
    settings: SettingsAPI
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
        ui: { tool: "move", settingsOpen: false, heat: false, lastHover: null, spaceDown: false, enteredFrame: null, editingEl: null, hoverWash: null, hideSelBoxWhileNesting: false },
        prefs: loadPrefs(),
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
