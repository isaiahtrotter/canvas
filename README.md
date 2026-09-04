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
```

## Layout

```
src/
  main.tsx               React entry
  App.tsx                Full-bleed <Editor />
  components/Editor.tsx  React shell: mounts the engine once, paints cosmetic props
  editor/
    engine.ts            The editor itself — vanilla DOM, mountEditor(root) → cleanup
    markup.ts            Static sidebar/canvas markup the engine renders into
    editor.css           All editor styling
    time.ts              Relative/absolute time formatting for frame timestamps
    color.ts             Color math (hex/rgb/hsv) shared by the engine and the picker
  components/ColorPicker.tsx  Controlled color picker rendered by the React shell
reference/               Original Framer components this was ported from
```

## Interactions

**Canvas**
- Scroll / pinch to zoom (10%–400%), anchored under the cursor · ⌘/Ctrl `+` `−` `0` · zoom pill bottom-left
- Hold Space and drag, or middle-mouse drag, to pan
- `V` move tool · `F` frame tool · `Esc` back to move / clear selection
- When nothing is on screen, a minimap fades in above the zoom pill: frames are dots, the
  viewport is a rectangle; click it to jump

**Frames**
- With the frame tool, drag to draw a frame, or click to drop a 200×150 one
- Frames show their name and a "last edited" timestamp above the top-left corner;
  hover the timestamp for the full date. `Shift+T` toggles timestamps (remembered)
- Double-click the name to rename · drag corner handles to resize · W/H editable in the sidebar
- Dragging a frame carries the text sitting inside it; deleting a frame leaves the text
- Duplicating a frame keeps its timestamp; undoing an edit restores the pre-edit timestamp

**Fill**
- The Fill row in the sidebar shows the selection's color and alpha (or "Mixed"); click it
  to open the color picker (ported from `reference/color_picker.tsx`). Changes apply live to
  every selected layer — frame backgrounds and text color — and one picker session is one undo step

**Text**
- Click / shift-click / marquee-drag to select layers; drag to move
- Hold Option (Alt) while dragging to duplicate
- Double-click to edit text · Enter commits · Esc commits and deselects
- Delete / Backspace removes selected layers
- Cmd/Ctrl+Z undo · Shift+Cmd/Ctrl+Z redo (20 steps)
- Font dropdown switches the selected text between Inter, PP Mondwest, PP NeueBit, Helvetica Neue, Georgia
  (the PP faces are loaded from `public/fonts/`)
- Sidebar: alignment (a single layer aligns within its frame), Versions 1–3 swap the
  font-size widget design, size field accepts typing / ↑↓ / the drawer's handles, pills, and ± steppers

## Adding an experiment

Everything lives in `src/editor/engine.ts`. State is `items` (text layers and
frames, discriminated by `kind`) + `selection`;
call `emit()` after any change and every subscriber (canvas render, sidebar,
widget) refreshes. Wrap a user-visible change in `pushHistory()` so it's
undoable. To add a new widget design, add an entry to `VARIANTS` and a
matching button to `markup.ts`.
