# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm run dev         # vite dev server, http://localhost:5173
npm run build       # tsc (typecheck) && vite build -> dist/
npm run preview     # serve the dist/ build
npm run typecheck   # tsc only, no build
```

There is no lint script and no test suite. `npm run build` is the only
correctness check (TypeScript, `strict: false`) — run it after any change to
`src/editor/engine.ts` before considering a change done, since that file has
no other safety net.

Verification in this project has been done by running the dev server and
driving it with a headless Chromium browser (Puppeteer against a local Brave
install) rather than by unit tests: seed `localStorage["canvas.doc.v1"]`
with a specific scene via `page.evaluateOnNewDocument`, then read back
`localStorage` or live DOM state (`getBoundingClientRect`, inline
`style.left/top/clipPath`, etc.) to assert on it. Two things to know before
writing a probe like this: `localStorage` is only written on `emit()` (i.e.
on release of a drag, not on every `pointermove`), so reading it mid-drag
gets stale data — read the live DOM/style values during a drag instead. And
a synthetic `element.click()` does not reproduce real click focus behavior
(the `:focus-visible` outline can behave differently); use
`page.mouse.click(x, y)` when focus matters.

## Architecture

This is a single-page vanilla-DOM canvas editor wrapped in a thin React
shell. Nearly all logic lives in one file, `src/editor/engine.ts`
(~4,400 lines) — read function names there directly rather than expecting a
module boundary to guide you; it's organized in commented `====` sections
(app state, canvas/view, tools, canvas rendering, smart layout, selection
overlay, side panel, preferences/settings) but not split into files.

- `src/main.tsx` / `src/App.tsx` — React entry, renders `<Editor />` full-bleed.
- `src/components/Editor.tsx` — mounts the engine exactly once
  (`mountEditor(root, hooks)`, empty-deps effect) so all editor state
  survives React re-renders; a second effect only pushes cosmetic props
  (corner radius) onto the mounted DOM. The *only* piece of UI React owns is
  two floating popovers — the color picker and the font list — which the
  engine asks the host to open via hooks (`onFillOpen`/`onFillChange`,
  `onFontOpen`/`onFontChange`) and pushes changes back through the returned
  `EditorAPI` (`setFill`, `setFont`). Everything else is rendered by the
  engine directly into `root.innerHTML = MARKUP` (from `src/editor/markup.ts`).
- `src/editor/markup.ts` — the static shell HTML the engine mounts into and
  wires up: canvas, tool pill, zoom pill, layers panel (left, currently
  parked/hidden), side panel (right), settings dialog.
- `src/editor/editor.css` — all editor styling, including the two
  screen-space overlay layers described below.
- `src/editor/color.ts` — hex/rgb/hsv conversion, WCAG contrast/luminance,
  alpha compositing. Shared by the engine (contrast-driven label/accent
  color) and `ColorPicker.tsx`.
- `src/editor/time.ts` — relative/absolute timestamp formatting for frame labels.
- `src/components/ColorPicker.tsx`, `src/components/FontDropdown.tsx` —
  controlled popovers rendered by the React shell, positioned by `Editor.tsx`
  just left of the right sidebar.

### State and the render loop

State is two things: `items: Item[]` (a flat array of `TextItem | FrameItem`,
discriminated by `kind`, both carrying a `parent: number | null` — see
"Frame/text nesting" below) and `selection: Set<number>`. There is no
reactive framework: call `emit()` after any change and every subscriber
(`renderCanvas`, side panel, alignment buttons, etc., registered via
`subscribe(fn)`) re-runs. `emit()` also runs `touchParentFrames()` (stamps a
frame's `updatedAt` when its contents change — drives both the visible
timestamp and the heatmap) and `scheduleSave()` (debounced 150ms write to
`localStorage`).

`renderCanvas()` reconciles `#world`'s children **in place, keyed by item
id** — it does not rebuild the DOM on every render. This matters: CSS
animations/transitions on a node (the heatmap's glow, a color transition)
survive a re-render because the node isn't torn down and recreated, and the
node currently being edited (`contenteditable`) isn't destroyed out from
under the user mid-keystroke.

Wrap any user-visible mutation in `pushHistory()` (or `pushHistory(pre)` with
a snapshot taken before a drag/gesture started) so it's undoable —
`snapshot()`/`restore()` deep-copy `items` + `selection`; undo/redo hold up
to 20 steps.

Two `localStorage` keys, written independently: `canvas.doc.v1` (items,
`nextId`, `frameCount`, background, view/zoom — the actual document) and
`canvas.prefs.v1` (theme, display name, sidebar widths/visibility, pixel
grid on/off). `canvas.showTimestamps` is a legacy third key for one boolean.
Loading an old document migrates missing fields defensively (see `loadDoc()`
and the per-field `undefined` checks it does for `parent`, `updatedAt`, etc.)
— when adding a new `Item` field, follow that pattern rather than assuming
freshly-loaded items have it.

### Frame/text nesting: parent-based, not geometric

A text or frame's container is the `parent` field on the item itself, set
explicitly — **never** re-derived from whether one box geometrically sits
inside another. This means an item can hang out past its parent's edge and
still belong to it. Membership changes happen in exactly two places: (1)
while dragging something that isn't itself riding along inside an already-
dragged frame, the frame under the *pointer* (not the raw geometry) becomes
its new parent on every `pointermove`, and (2) drawing a new frame, or
wrapping a selection in a smart layout, assigns parentage once at creation.
`containingFrame(it)` is just `frameById(it.parent)` — do not add a
geometric fallback to it.

Consequences that follow from this and are easy to break by "fixing" one
site without the others:

- **Dragging** carries the *entire* subtree (`descendantsOf(f)`, walking
  `parent` at any depth) — a dragged frame moves its nested frames and all
  their text together. Deletion, arrow-key nudging, and ⌘A-inside-a-frame
  all use the same `descendantsOf`/`isInside` helpers; don't reintroduce a
  one-level-only version for a new feature.
- **Clipping** (`applyClips()`) walks the full parent chain
  (`visibleRect()`), not just the immediate parent, so a grandchild inside a
  clipped child frame is bounded by both ancestors. It's suspended entirely
  (forced to `clipPath: ""`) for the duration of a drag via the `.dragging`
  class — repositioning a clipped node via raw `style.left/top` on every
  frame turned out to be a real (if hard to pin down) compositing artifact
  in at least some browsers, visible as text descenders flickering off; see
  the comment at the top of `applyClips()` before changing this.
- **Nested-frame selection ("drilling")** — a top-level frame's contents are
  directly clickable, but a frame nested inside another is *opaque* until
  you double-click into it (`enteredFrame`, `selectTargetFor`, `drillInto`).
  A single click anywhere on an un-entered nested frame or its contents
  selects that frame as a whole; Escape steps back out one level.
- A top-level frame that has *any* contents (text or a nested frame) can
  only be grabbed by its name label, never its body — the body passes
  clicks through as empty canvas so a marquee can start there. A frame
  nested inside another always grabs from its body regardless of contents,
  since it has no label to grab by (see next point).
- Frame **name/timestamp labels** are only rendered for top-level frames
  (`renderFrameLabels()` filters by `!containingFrame(f)`) — a nested frame
  shows neither. They live in a screen-space overlay
  (`#overlay .labels`), positioned by `placeLabel()` in exact pixel
  coordinates from `toScreen()`, not inside the zoomed `#world` with a CSS
  counter-scale — that was tried first and Chromium rasterized the nested
  `scale(1/z)` a few px off, drifting with zoom.

### Two coordinate spaces

Items live in **world units** (`it.x/y/w/h`); `#world` carries
`transform: translate(view.x, view.y) scale(view.z)`. Anything that must
render at a constant size regardless of zoom — the selection box and
handles, the pixel grid, smart-guide lines, measurement rulers, frame
labels — lives in `#overlay`, a sibling of `#world` in plain screen
coordinates, built fresh each time via `toScreen()`/`placeScreenRect()`. If
you're adding chrome that should scale with content, it belongs inside
`#world`; if it should stay a crisp 1px line or fixed-size box at any zoom,
it belongs in `#overlay`.

The pixel grid (`#grid`, painted by `applyGrid()` onto a `<canvas>` from
1000% zoom up) is deliberately **not** a CSS background-image — a
repeating background gets its tile phase snapped to whole device pixels by
the browser, which drifted the grid off frame edges at fractional zoom.
It's drawn with `mix-blend-mode: difference` so a single faint white line
reads on both light and dark canvas backgrounds without a per-background
color switch (one dead zone: it fades out right around a mid-gray
background, since a neutral difference overlay must cross zero somewhere
between lightening black and darkening white).

### Canvas color vs. UI theme — kept independent on purpose

The app has a light/dark **UI theme** (`:root.dark`, driven by
`prefs.theme`, affects panels/dialogs only) that is intentionally decoupled
from the **canvas background color**, which the user sets directly and
which drives its own separate light/dark logic for frame label and
selection-accent contrast (`canvasIsDark()`, `labelPalette()`,
`accentColor()` — all keyed off the *frame name* color pair specifically,
not the timestamp color, so re-tuning the timestamp's shade can't
accidentally flip the light/dark switch point). Don't wire the UI theme
back into canvas background/label colors — that coupling existed briefly
and was deliberately removed.

### Smart layout (auto layout)

`FrameItem.layout?: FrameLayout | null` (direction, gap, padding, cross-axis
align, hug/fixed sizing). `applyLayouts()` runs inside every `renderCanvas()`
and also on every keystroke while editing text (`relayoutLive()`, wired into
the `contenteditable` `input` handler) so a hugging frame's size tracks its
content live, not just on commit. Children are re-ordered by their current
position along the main axis each time (not by array order), so dragging a
child to a new spot and releasing reorders it. A hugging frame takes its
*exact* fractional content size (not rounded) — rounding was the source of
a visible sliver/overlap bug between adjacent items and between an item and
its frame's edge at high zoom.

### Smart guides (snapping)

While dragging, `snapToGuides()` pulls the moving selection's edges/centers
onto another layer's matching edge/center within a small screen-px radius,
scoped to siblings only (same parent frame, or same top level) — see
`sibling()` inside that function, which mirrors the nesting rules above.

## Notes on the README

`README.md` documents the user-facing feature set (keyboard shortcuts,
interactions) and is generally accurate for what it covers, but was written
early and doesn't mention several things that now exist: nested frames,
smart/auto layout, the heatmap view, dark mode, resizable/collapsible
sidebars, the settings dialog, smart-guide snapping, or the text tool. Treat
it as a good shortcuts reference, not a complete feature list — check
`engine.ts` (the function name list from `grep -n "^    function"` is a
useful map) for what actually exists before assuming the README is complete.
