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
reference/               Original Framer components this was ported from
```

## Interactions

- Click / shift-click / marquee-drag to select layers; drag to move
- Hold Option (Alt) while dragging to duplicate
- Double-click to edit text · Enter commits · Esc commits and deselects
- Delete / Backspace removes selected layers
- Cmd/Ctrl+Z undo · Shift+Cmd/Ctrl+Z redo (20 steps)
- Sidebar: alignment, Versions 1–3 swap the font-size widget design,
  size field accepts typing / ↑↓ / the drawer's handles, pills, and ± steppers

## Adding an experiment

Everything lives in `src/editor/engine.ts`. State is `items` + `selection`;
call `emit()` after any change and every subscriber (canvas render, sidebar,
widget) refreshes. Wrap a user-visible change in `pushHistory()` so it's
undoable. To add a new widget design, add an entry to `VARIANTS` and a
matching button to `markup.ts`.
