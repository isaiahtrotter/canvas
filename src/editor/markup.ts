export const MARKUP = `
<div class="app">
    <div class="canvas-wrap">
      <div class="canvas" id="canvas"></div>

    </div>
    <div class="sidepanel">
      <div class="sp-section">
        <div class="alignrow" id="alignRow"></div>
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
        <div class="fillrow"><span class="swatch"></span><span class="hex">1C1C1C</span><span class="pct">100%</span></div>
      </div>
    </div>
  </div>
`
