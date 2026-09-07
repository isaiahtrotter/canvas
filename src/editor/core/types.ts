// Document model and the public host-facing types. Pure declarations and a
// few constants — nothing here touches the DOM or holds state.

export interface TextItem {
    kind: "text"
    id: number
    x: number
    y: number
    text: string
    size: number
    font: string
    weight: number
    lineHeight?: number // unitless multiplier; default 1.2
    letterSpacing?: number // px; default 0
    /** id of the frame this text belongs to, or null. Membership is decided by
     *  where the pointer is when a drag ends (or where a frame is drawn), not by
     *  geometry, so a text can hang past its frame's edge and still be clipped
     *  by it. `undefined` only in documents saved before this field existed. */
    parent?: number | null
    /** last content/style edit — what the heatmap reads. Frames have the same field. */
    updatedAt?: number
    opacity?: number
    fill: string // hex
    alpha: number // 0–100
}

/** Smart layout: the frame arranges the text it holds itself. Treated as
 *  immutable — a change replaces the object — so undo snapshots (shallow
 *  copies of items) keep the version they were taken with. */
export interface FrameLayout {
    direction: "vertical" | "horizontal"
    gap: number // between children, world units
    padding: number // inside the frame, all sides
    align: "start" | "center" | "end" // children along the cross axis
    sizing: "hug" | "fixed" // hug: the frame fits its contents; fixed: keeps its w/h
}
export interface FrameItem {
    kind: "frame"
    id: number
    x: number
    y: number
    w: number
    h: number
    name: string
    createdAt: number
    updatedAt: number
    fill: string // hex
    alpha: number // 0–100
    layout?: FrameLayout | null
    /** id of the frame this frame sits in, or null. Set the same way as a
     *  text's: by where the pointer is when a drag ends, or by the frame drawn
     *  around it — not by geometry, so a child frame can hang past its
     *  parent's edge and still belong to it. `undefined` only in documents
     *  saved before frames had this field. */
    parent?: number | null
}

export interface Fill {
    hex: string
    alpha: number
}
/** What the editor tells its host about the Fill control. */
export type FillMode = "selection" | "background"
export interface EditorHooks {
    /** The fill swatch was clicked: open a picker anchored to `anchor`, for the selection or the canvas background. */
    onFillOpen?: (anchor: DOMRect, fill: Fill, mode: FillMode) => void
    /** Selection (or, in background mode, the background color) changed while the host may be showing a picker. */
    onFillChange?: (fill: Fill, mode: FillMode) => void
    /** The font row was clicked: open a floating list of fonts anchored to `anchor`. `value` is the
     *  selection's shared font, or "__mixed" when the selected text layers use different fonts. */
    onFontOpen?: (anchor: DOMRect, options: string[], value: string) => void
    /** The selection's font changed while the host may be showing the font list. */
    onFontChange?: (value: string) => void
}
export interface EditorAPI {
    /** Apply a fill to every selected layer. The first call after beginFillGesture() logs one undo step. */
    setFill: (hex: string, alpha: number) => void
    beginFillGesture: () => void
    endFillGesture: () => void
    /** Apply a font to every selected text layer. One undo step per call. */
    setFont: (font: string) => void
    destroy: () => void
}

export type Item = TextItem | FrameItem
export const isFrame = (it: Item): it is FrameItem => it.kind === "frame"
export const isText = (it: Item): it is TextItem => it.kind === "text"

// MIN..MAX is the range the size slider shows; the size itself has no
// upper limit (type any value into the field) and a floor of SIZE_MIN
export const MIN = 8,
    MAX = 48,
    STEP = 4,
    INSET = 12
export const SIZE_MIN = 1
export const DEFAULT_LINE_HEIGHT = 1.2
export const lineHeightOf = (it: TextItem) => it.lineHeight ?? DEFAULT_LINE_HEIGHT
export const letterSpacingOf = (it: TextItem) => it.letterSpacing ?? 0
export const PALETTE = [
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
