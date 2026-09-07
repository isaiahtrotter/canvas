# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm run dev              # vite dev server, http://localhost:5173
npm run build            # tsc (typecheck) && vite build -> dist/
npm run preview          # serve the dist/ build
npm run typecheck        # tsc only, no build

npm run check            # build, then run the probe and diff it against the baseline
npm run probe            # the probe alone (dev server); label defaults to the git sha
npm run probe:baseline   # rewrite .probe/dev/baseline from the current code
npm run probe:preview    # same probe against `vite build && vite preview` (its own baseline)
npm run probe:preview:baseline
```

There is no lint script and no unit-test suite. Two checks exist, and
`npm run check` runs both:

1. `npm run build` — TypeScript (`strict: false`) plus the production bundle.
2. `scripts/probe.mjs` — a characterization probe. It drives the app in a
   headless Brave/Chromium (`puppeteer-core`, no bundled browser; set
   `PROBE_BROWSER` to point at another Chromium) through 23 scripted
   interactions against a fixed seed document with a frozen clock, and dumps
   the saved doc, the `#world`/`#overlay` DOM, and the side-panel values after
   every step as sorted JSON under `.probe/<mode>/<label>/`. A run diffs
   itself against `.probe/<mode>/baseline/` and exits non-zero on any
   difference or page error. `.probe/` is gitignored (font metrics are
   machine-specific), so the first run on a machine is `npm run
   probe:baseline` on a known-good commit.

   The probe is a *change detector*, not a spec: when a diff is the intended
   result of your change, read it, confirm every changed line is what you
   meant, then regenerate the baseline. A diff you did not intend is a
   regression. Things to know before extending it (in `scripts/probe.mjs`):
   `localStorage` is only written on `emit()` (on release of a drag, not on
   every `pointermove`), so the probe reads live DOM/style values mid-gesture
   and the saved doc after; a synthetic `element.click()` does not reproduce
   real click focus behavior, so every click goes through `page.mouse` at a
   run-time `getBoundingClientRect`; the app exposes `window.__canvasEditor`
   (the `EditorAPI`) in dev or with `?probe=1` so the probe can drive the
   fill/font surface the React popovers normally call.

## Architecture

A single-page vanilla-DOM canvas editor wrapped in a thin React shell. The
engine is a set of ES modules under `src/editor/`, one folder per feature,
composed by `src/editor/engine.ts`.

### The React shell (unchanged by the modular engine)

- `src/main.tsx` / `src/App.tsx` — React entry, renders `<Editor />` full-bleed.
- `src/components/Editor.tsx` — mounts the engine exactly once
  (`mountEditor(root, hooks)`, empty-deps effect) so all editor state
  survives React re-renders; a second effect only pushes cosmetic props
  (corner radius) onto the mounted DOM. The *only* piece of UI React owns is
  two floating popovers — the color picker and the font list — which the
  engine asks the host to open via hooks (`onFillOpen`/`onFillChange`,
  `onFontOpen`/`onFontChange`) and pushes changes back through the returned
  `EditorAPI` (`setFill`, `setFont`). Everything else is rendered by the
  engine directly into `root.innerHTML = MARKUP`.
- `src/components/ColorPicker.tsx`, `src/components/FontDropdown.tsx` —
  controlled popovers rendered by the React shell, positioned by `Editor.tsx`
  just left of the right sidebar.

### The engine: one folder per feature

```
src/editor/
  engine.ts          composition root: MARKUP → createContext → install modules in order → subscribers → boot → destroy
  markup.ts          composes the per-component *.html.ts fragments into MARKUP (byte-for-byte the shell)
  editor.css         ordered @import manifest of tokens.css + the per-component *.css files
  tokens.css         :root / :root.dark design tokens and the .app frame — imported first
  demo.ts            first-run seed content
  color.ts, time.ts  pure helpers (color math / WCAG contrast; relative & absolute timestamps)

  core/
    types.ts         Item / TextItem / FrameItem / FrameLayout / Fill, EditorHooks / EditorAPI, size + palette constants
    context.ts       EditorContext: doc, flags, ui, prefs, dom, bus (subscribe/emit), onDoc, nodeFor, and one typed slot per module
    store.ts         items + selection mutations, the parent/child tree helpers, selection queries, undo history, touchParentFrames
    persist.ts       canvas.doc.v1 save (debounced) / load (with migrations) / pagehide flush
    geometry.ts      toWorld / toScreen / placeScreenRect, nodeSize, bounds, containment, frameAt, visibleRect

  view/              pan, zoom, the #world transform, the pixel grid, ResizeObserver   (+ zoompill.html.ts, view.css)
  minimap/           the minimap above the zoom pill                                   (+ .html.ts, .css)
  measure/           Option/Alt distance guides; canvas hover tracking → ctx.ui.lastHover (+ .css)
  tools/             tool state (move/frame/text), the tool pill, the toast             (+ .html.ts, .css)
  times/             frame timestamps (Shift+T) and the heatmap (Shift+H); exports HEAT_BG (+ heat.css)
  canvas/            render.ts: node create/update, the in-place reconcile, frame labels, hover wash, web-font relayout
                     layout.ts: smart layout engine, Shift+A, applyClips             (+ canvas.html.ts, canvas.css)
  selection/         drill.ts: nested-frame drilling (ctx.ui.enteredFrame)
                     overlay.ts: underlines, selection box + handles, hover boxes, snap lines
                     snap.ts: sibling-scoped snapping math                              (+ selection.css)
  interactions/      itemGestures.ts: resize, inline edit, rename, text-tool placement
                     drag.ts: select + drag (shift-lock, snapping, Option-duplicate, membership follows the pointer)
                     canvasPointer.ts: canvas pointerdown → pan / draw frame / place text / marquee
                     keymap.ts: the main keydown/keyup, ⌘A, arrow nudging, delete, Escape
  panel/             panel.ts: composes the right sidebar; fill.ts (Fill/Background row + canvas label palette);
                     layoutPanel.ts; textPanel.ts (font, weight, size, spacing — built once in boot);
                     sizeAdapter.ts; sizeWidget.ts (makeWidget + VARIANTS + the Versions switch); fields.ts
                                                                                        (+ panel.html.ts, panel.css, widget.css)
  settings/          prefs.ts (canvas.prefs.v1); settings.ts: theme, avatar, dialog, switches, sidebars/resizers
                                                                                        (+ settings.html.ts, settings.css)
  layers/            the left-sidebar layer list — parked (no #layerList in the markup)   (+ .html.ts, .css)
```

### How the modules fit together

Every feature module is `installX(ctx): XAPI & { dispose?() }`. `engine.ts`
calls them in a fixed order and stores each result on its slot of the shared
context (`ctx.view`, `ctx.store`, …). The rules that make this work:

- **Modules never import each other.** They import only `core/types`,
  `core/context` (types), `color.ts`, `time.ts`, and pure constants (e.g.
  `DEFAULT_LAYOUT` from `canvas/layout`, `HEAT_BG` from `times/times`).
  Everything else is reached through `ctx.<slot>.fn()` and resolved **at
  call time**, so two modules may call each other freely (render ↔ layout,
  drag ↔ overlay, panel ↔ widget) with no import cycles.
- **An `install` body may only** query/append its own DOM, register
  listeners, initialize its own state, and call modules installed *before*
  it. Every other cross-module call happens later, from an event or from the
  boot sequence in `engine.ts`. The install order in `engine.ts` is the
  order the code sat in when the engine was one file; it fixes listener
  registration order (the store's undo keydown before the keymap's; the
  measure module's canvas `pointermove` before the pointerdown) and
  install-time DOM appends (the `.labels` layer into `#overlay`, the heat key
  into `.canvas-wrap`). Keep new modules in that spirit: add the `use(...)`
  where the feature belongs in that sequence.
- **Where state lives.** Document data — `items`, `selection`, `nextId`,
  `frameCount`, `bg`, `view` — is `ctx.doc` (exactly what `saveDoc()`
  serializes; keep that key order). The emit-diff switches (`restoring`,
  `carryingFrameDrag`, `suppressLeaveBump`, `skipTouch`) are `ctx.flags`.
  Interaction state that one module writes and another reads (`tool`,
  `editingEl`, `enteredFrame`, `lastHover`, `hoverWash`, `spaceDown`,
  `heat`, `settingsOpen`, `hideSelBoxWhileNesting`, `activeVariant`) is
  `ctx.ui`. Everything used by one module only is a plain `let` inside its
  `install` closure. **Read mutable `ctx` fields live** (`ctx.ui.tool`) —
  never destructure them into a local. The reference-typed objects
  (`ctx.doc.items`, `ctx.doc.selection`, `ctx.doc.view`, `ctx.prefs`,
  `ctx.store.lastText`) may be aliased but are mutated in place, never
  replaced (`Object.assign(view, …)`, not `view = …`).
- **Cleanup.** A module that owns a timer, observer, or window/document
  listener returns `dispose()`; `destroy()` runs them in reverse install
  order after removing the `ctx.onDoc` listeners, then clears `root`.
  Transient per-gesture `document` listeners (a drag's `pointermove`/`up`)
  remove themselves and are not tracked.
- **`ctx.nodeFor(id)`** is the one way to find an item's canvas node
  (`#canvas` scope, first match — a frame's label also carries the id but
  sits later in the DOM). `renderCanvas`/`relayoutLive` deliberately use
  `#world`'s `:scope > [data-id]` instead; that is a reconcile query, not a
  lookup.
- **Markup fragments** are byte-exact slices of the shell; `markup.ts`
  interpolates them in the original order. Keep `#world` and `#overlay`
  free of whitespace text nodes — `renderCanvas` uses `world.firstChild` as
  its reconcile cursor.
- **CSS order matters.** `editor.css` imports `tokens.css` first, then each
  component file in the order its rules were written, so same-specificity
  overrides keep resolving the same way (see the comment at the top of
  `times/heat.css` about the toggle rules winning over the steady-state
  ones). Add new rules to the component's file; add a new file to the
  manifest where its rules belong in that order, not at the end by default.

**Adding a feature**: make a folder with `feature.ts` (`installFeature(ctx)`
returning its API), optional `feature.html.ts` (a fragment `markup.ts`
interpolates) and `feature.css` (imported from `editor.css`); add a typed
slot to `EditorContext` in `core/context.ts` (`import type` the API); add
`use("feature", installFeature(ctx))` to `engine.ts` at the right point in
the install order; put any cross-module state on `ctx.ui`. Then `npm run
check` — and if the probe should see the feature, extend
`scripts/probe.mjs` and regenerate the baseline.

### State and the render loop

State is two things: `ctx.doc.items` (a flat array of `TextItem | FrameItem`,
discriminated by `kind`, both carrying a `parent: number | null` — see
"Frame/text nesting" below) and `ctx.doc.selection: Set<number>`. There is
no reactive framework: call `ctx.bus.emit()` after any change and every
subscriber re-runs — `engine.ts` registers two: `canvas.renderCanvas` and
`panel.update`. `emit()` also runs `store.touchParentFrames()` (stamps a
frame's `updatedAt` when its contents change — drives both the visible
timestamp and the heatmap) and `persist.scheduleSave()` (debounced 150ms
write to `localStorage`).

`renderCanvas()` (`canvas/render.ts`) reconciles `#world`'s children **in
place, keyed by item id** — it does not rebuild the DOM on every render. This
matters: CSS animations/transitions on a node (the heatmap's glow, a color
transition) survive a re-render because the node isn't torn down and
recreated, and the node currently being edited (`contenteditable`) isn't
destroyed out from under the user mid-keystroke.

Wrap any user-visible mutation in `ctx.store.pushHistory()` (or
`pushHistory(pre)` with a `snapshot()` taken before a drag/gesture started)
so it's undoable — snapshots deep-copy `items` + `selection`; undo/redo hold
up to 20 steps (`core/store.ts`).

Two `localStorage` keys, written independently: `canvas.doc.v1` (items,
`nextId`, `frameCount`, background, view/zoom — the actual document,
`core/persist.ts`) and `canvas.prefs.v1` (theme, display name, sidebar
widths/visibility, pixel grid on/off — `settings/prefs.ts`).
`canvas.showTimestamps` is a legacy third key for one boolean
(`times/times.ts`). Loading an old document migrates missing fields
defensively (see `loadDoc()` and the per-field `undefined` checks it does
for `parent`, `updatedAt`, etc.) — when adding a new `Item` field, follow
that pattern rather than assuming freshly-loaded items have it.

### Frame/text nesting: parent-based, not geometric

A text or frame's container is the `parent` field on the item itself, set
explicitly — **never** re-derived from whether one box geometrically sits
inside another. This means an item can hang out past its parent's edge and
still belong to it. Membership changes happen in exactly two places: (1)
while dragging something that isn't itself riding along inside an already-
dragged frame, the frame under the *pointer* (not the raw geometry) becomes
its new parent on every `pointermove` (`interactions/drag.ts`), and (2)
drawing a new frame, or wrapping a selection in a smart layout, assigns
parentage once at creation. `containingFrame(it)` is just
`frameById(it.parent)` — do not add a geometric fallback to it.

Consequences that follow from this and are easy to break by "fixing" one
site without the others:

- **Dragging** carries the *entire* subtree (`store.descendantsOf(f)`,
  walking `parent` at any depth) — a dragged frame moves its nested frames
  and all their text together. Deletion, arrow-key nudging, and
  ⌘A-inside-a-frame all use the same `descendantsOf`/`isInside` helpers;
  don't reintroduce a one-level-only version for a new feature.
- **Clipping** (`applyClips()` in `canvas/layout.ts`) walks the full parent
  chain (`geometry.visibleRect()`), not just the immediate parent, so a
  grandchild inside a clipped child frame is bounded by both ancestors. It's
  suspended entirely (forced to `clipPath: ""`) for the duration of a drag
  via the `.dragging` class — repositioning a clipped node via raw
  `style.left/top` on every frame turned out to be a real (if hard to pin
  down) compositing artifact in at least some browsers, visible as text
  descenders flickering off; see the comment inside `applyClips()` before
  changing this.
- **Nested-frame selection ("drilling")** — a top-level frame's contents are
  directly clickable, but a frame nested inside another is *opaque* until
  you double-click into it (`ctx.ui.enteredFrame`, `selectTargetFor`,
  `drillInto` in `selection/drill.ts`). A single click anywhere on an
  un-entered nested frame or its contents selects that frame as a whole;
  Escape steps back out one level (`interactions/keymap.ts`).
- A top-level frame that has *any* contents (text or a nested frame) can
  only be grabbed by its name label, never its body — the body passes
  clicks through as empty canvas so a marquee can start there. A frame
  nested inside another always grabs from its body regardless of contents,
  since it has no label to grab by (see next point). This is the
  `createFrameNode` pointerdown in `canvas/render.ts`.
- Frame **name/timestamp labels** are only rendered for top-level frames
  (`renderFrameLabels()` filters by `!containingFrame(f)`) — a nested frame
  shows neither. They live in a screen-space overlay (`#overlay .labels`),
  positioned by `placeLabel()` in exact pixel coordinates from `toScreen()`,
  not inside the zoomed `#world` with a CSS counter-scale — that was tried
  first and Chromium rasterized the nested `scale(1/z)` a few px off,
  drifting with zoom.

### Two coordinate spaces

Items live in **world units** (`it.x/y/w/h`); `#world` carries
`transform: translate(view.x, view.y) scale(view.z)` (`view/view.ts`).
Anything that must render at a constant size regardless of zoom — the
selection box and handles, the pixel grid, smart-guide lines, measurement
rulers, frame labels — lives in `#overlay`, a sibling of `#world` in plain
screen coordinates, built fresh each time via
`geometry.toScreen()`/`placeScreenRect()`. If you're adding chrome that
should scale with content, it belongs inside `#world`; if it should stay a
crisp 1px line or fixed-size box at any zoom, it belongs in `#overlay`.

The pixel grid (`#grid`, painted by `applyGrid()` in `view/view.ts` onto a
`<canvas>` from 1000% zoom up) is deliberately **not** a CSS
background-image — a repeating background gets its tile phase snapped to
whole device pixels by the browser, which drifted the grid off frame edges
at fractional zoom. It's drawn with `mix-blend-mode: difference` so a single
faint white line reads on both light and dark canvas backgrounds without a
per-background color switch (one dead zone: it fades out right around a
mid-gray background, since a neutral difference overlay must cross zero
somewhere between lightening black and darkening white).

### Canvas color vs. UI theme — kept independent on purpose

The app has a light/dark **UI theme** (`:root.dark`, driven by
`ctx.prefs.theme` in `settings/settings.ts`, affects panels/dialogs only)
that is intentionally decoupled from the **canvas background color**
(`ctx.doc.bg`), which the user sets directly and which drives its own
separate light/dark logic for frame label and selection-accent contrast
(`canvasIsDark()`, `labelPalette()`, `accentColor()` in `panel/fill.ts` — all
keyed off the *frame name* color pair specifically, not the timestamp
color, so re-tuning the timestamp's shade can't accidentally flip the
light/dark switch point). Don't wire the UI theme back into canvas
background/label colors — that coupling existed briefly and was
deliberately removed.

### Smart layout (auto layout)

`FrameItem.layout?: FrameLayout | null` (direction, gap, padding, cross-axis
align, hug/fixed sizing). `applyLayouts()` (`canvas/layout.ts`) runs inside
every `renderCanvas()` and also on every keystroke while editing text
(`relayoutLive()`, wired into the `contenteditable` `input` handler in
`interactions/itemGestures.ts`) so a hugging frame's size tracks its content
live, not just on commit. Children are re-ordered by their current position
along the main axis each time (not by array order), so dragging a child to
a new spot and releasing reorders it. A hugging frame takes its *exact*
fractional content size (not rounded) — rounding was the source of a
visible sliver/overlap bug between adjacent items and between an item and
its frame's edge at high zoom.

### Smart guides (snapping)

While dragging, `snapToGuides()` (`selection/snap.ts`) pulls the moving
selection's edges/centers onto another layer's matching edge/center within
a small screen-px radius, scoped to siblings only (same parent frame, or
same top level) — see `sibling()` inside that function, which mirrors the
nesting rules above.

## Notes on the README

`README.md` documents the user-facing feature set (keyboard shortcuts,
interactions) and is generally accurate for what it covers, but was written
early and doesn't mention several things that now exist: nested frames,
smart/auto layout, the heatmap view, dark mode, resizable/collapsible
sidebars, the settings dialog, smart-guide snapping, or the text tool. Treat
it as a good shortcuts reference, not a complete feature list — the folder
map above, and each module's exported `*API` interface, is the reliable
inventory of what exists.
