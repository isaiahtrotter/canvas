// The tool pill (top-left of the canvas) and the toast.
export const TOOL_PILL = `      <div class="toolpill" role="toolbar" aria-label="Tools">
        <button data-tool="move" class="active" title="Move (V)" aria-label="Move tool" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3.2 1.8l8.6 6.3-3.9.6 2.2 4-1.7.9-2.2-4-2.9 2.6z"/></svg>
        </button>
        <button data-tool="frame" title="Frame (F)" aria-label="Frame tool" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11"/></svg>
        </button>
        <button data-tool="text" title="Text (T)" aria-label="Text tool" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 2.5h9M7 2.5v9"/></svg>
        </button>
      </div>`

export const TOAST = `      <div class="toast" id="toast" role="status"></div>`
