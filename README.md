# Canvas

A web playground for prototyping canvas-editor features: multi-select text
layers, a Figma-style properties sidebar, and a multi-handle font-size control
with three switchable designs. Built to try out new and innovative editor
ideas quickly.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
npm run check      # build, then run the behavior probe and diff it against the baseline
```

## Layout

```
src/
  main.tsx                 React entry
  App.tsx                  Full-bleed <Editor />
  components/
    Editor.tsx             React shell: mounts the engine once, owns the two floating popovers
    ColorPicker.tsx        Controlled color picker rendered by the React shell
    FontDropdown.tsx       Controlled font list rendered by the React shell
  editor/                  The editor itself — vanilla DOM, one folder per feature
    engine.ts              Composition root: mountEditor(root, hooks) → EditorAPI + destroy
    markup.ts              Composes each component's *.html.ts fragment into the shell markup
    editor.css             Ordered @import manifest of tokens.css + each component's *.css
    core/                  types, the shared context, store (items/selection/history), persistence, geometry
    view/                  pan, zoom, pixel grid            minimap/     the minimap
    tools/                 tool pill + toast                times/       timestamps + heatmap
    canvas/                rendering, labels, smart layout, clipping
    selection/             drilling, selection overlay, snapping
    interactions/          resize/edit/rename, drag, canvas pointerdown (frame draw, marquee), keyboard
    panel/                 the right sidebar: fill/background, layout section, text section, size widget
    settings/              prefs, theme, settings dialog, sidebars
    measure/               Option/Alt distance guides    layers/      the (parked) layer list
    color.ts, time.ts      pure helpers
scripts/probe.mjs          Headless-browser characterization probe (see CLAUDE.md)
reference/                 Original Framer components this was ported from
```

## Interactions

The document (layers, background, pan/zoom) is saved to `localStorage` as you work and restored
on refresh. Clear the `canvas.doc.v1` key to start over with the demo content.

**Canvas**
- Scroll / pinch to zoom (10%–400%), anchored under the cursor · ⌘/Ctrl `+` `−` `0` · zoom pill bottom-left
- Hold Space and drag, or middle-mouse drag, to pan
- `V` move tool · `F` frame tool · `Esc` back to move / clear selection
- When nothing is on screen, a minimap fades in above the zoom pill: frames are dots, the
  viewport is a rectangle you can drag (clamped to the map); click elsewhere to jump

**Frames**
- With the frame tool, drag to draw a frame, or click to drop a 200×150 one
- Frames show their name and a "last edited" timestamp above the top-left corner;
  hover the timestamp for the full date. `Shift+T` toggles timestamps (remembered)
- Double-click the name to rename · drag any corner or edge handle to resize (down to 1×1) · W/H editable in the sidebar
- Frames are selected and dragged by their title; clicking the body acts like empty canvas. Dragging a frame carries the text sitting inside it; deleting a frame deletes that text too
- Moving or editing anything inside a frame bumps the frame's timestamp
- Duplicating or moving a frame keeps its timestamp; only edits to its contents bump it. Undoing
  restores whatever timestamp was in effect at that point in history

**Fill**
- The Fill row in the sidebar shows the selection's color and alpha (or "Mixed"); click it
  to open the color picker (ported from `reference/color_picker.tsx`). Changes apply live to
  every selected layer — frame backgrounds and text color — and one picker session is one undo step
- With nothing selected, the sidebar collapses to a single **Background** section, and the same
  row controls the canvas background instead (not part of item undo history)

**Measuring**
- Hold Option (Alt on Windows) and hover another layer to see the pixel gap to the current
  selection: a guide runs from the middle of the selection's facing side straight to the hovered
  target's edge. Hovering the frame that contains the selection draws rulers to all four of its
  edges. Pressing Option shows them immediately, even with a still mouse

**Text**
- Click / shift-click / marquee-drag to select text layers; drag to move. A marquee only picks up a
  frame once it fully encloses it — partially overlapping one leaves it alone
- Hold Option (Alt) while dragging to duplicate
- Double-click to edit text · Enter commits · Esc commits and deselects
- Cmd/Ctrl+A selects everything; with a frame selected, it selects the layers inside that frame;
  while editing text it's the browser's select-all
- Arrow keys nudge the selection 1px, Shift+arrow 10px (a frame carries its text; a quick run of
  presses is one undo step)
- Delete / Backspace removes selected layers
- Cmd/Ctrl+Z undo · Shift+Cmd/Ctrl+Z redo (20 steps)
- Font dropdown switches the selected text between Inter, PP Mondwest, PP NeueBit, Helvetica Neue, Georgia
  (the PP faces are loaded from `public/fonts/`)
- Sidebar: alignment (a single layer aligns within its frame), Versions 1–3 swap the
  font-size widget design, size field accepts typing / ↑↓ / the drawer's handles, pills, and ± steppers

## Adding an experiment

Each feature is a folder under `src/editor/` with an `install(ctx)` function
that returns its API; `engine.ts` installs them in order onto the shared
context. State is `ctx.doc.items` (text layers and frames, discriminated by
`kind`) + `ctx.doc.selection`; call `ctx.bus.emit()` after any change and
every subscriber (canvas render, sidebar, widget) refreshes. Wrap a
user-visible change in `ctx.store.pushHistory()` so it's undoable. Reach other
features through their `ctx` slot (`ctx.view.applyView()`), not by importing
them. To add a new widget design, add an entry to `VARIANTS` in
`panel/sizeWidget.ts` and a matching button to `panel/panel.html.ts`. Run
`npm run check` before calling a change done; `CLAUDE.md` has the details.
