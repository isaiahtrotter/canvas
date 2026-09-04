export const MARKUP = `
<div class="app">
    <div class="canvas-wrap">
      <div class="canvas" id="canvas"><div class="world" id="world"></div></div>
      <div class="toolpill" role="toolbar" aria-label="Tools">
        <button data-tool="move" class="active" title="Move (V)" aria-label="Move tool" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3.2 1.8l8.6 6.3-3.9.6 2.2 4-1.7.9-2.2-4-2.9 2.6z"/></svg>
        </button>
        <button data-tool="frame" title="Frame (F)" aria-label="Frame tool" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11"/></svg>
        </button>
      </div>
      <div class="minimap" id="minimap" aria-hidden="true"></div>
      <div class="zoompill" aria-label="Zoom">
        <button data-z="-" title="Zoom out (⌘−)" aria-label="Zoom out" tabindex="-1">−</button>
        <button data-z="reset" id="zoomVal" class="zoomval" title="Reset zoom (⌘0)" tabindex="-1">100%</button>
        <button data-z="+" title="Zoom in (⌘+)" aria-label="Zoom in" tabindex="-1">+</button>
      </div>
      <div class="toast" id="toast" role="status"></div>
    </div>
    <div class="sidepanel">
      <div class="sp-section">
        <div class="alignrow" id="alignRow"></div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Position</div>
        <div class="proprow">
          <div class="pi"><span class="pi-key">X</span><input id="posX" inputmode="numeric" aria-label="X position"></div>
          <div class="pi"><span class="pi-key">Y</span><input id="posY" inputmode="numeric" aria-label="Y position"></div>
        </div>
        <div class="proprow">
          <div class="pi"><span class="pi-key">W</span><input id="dimW" disabled aria-label="Width"></div>
          <div class="pi"><span class="pi-key">H</span><input id="dimH" disabled aria-label="Height"></div>
        </div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Fill</div>
        <button class="fillrow" id="fillRow" type="button" tabindex="-1" aria-label="Fill color"><span class="swatch"></span><span class="hex">1C1C1C</span><span class="pct">100%</span></button>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Versions</div>
        <div class="vergroup">
          <div class="vind" id="vind"></div>
          <button class="vbtn" data-v="1" tabindex="-1">1</button>
          <button class="vbtn" data-v="2" tabindex="-1">2</button>
          <button class="vbtn" data-v="3" tabindex="-1">3</button>
        </div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section">
        <div class="sp-label">Text</div>
        <div class="propgroup" id="panelGroup"></div>
      </div>
    </div>
  </div>
`
