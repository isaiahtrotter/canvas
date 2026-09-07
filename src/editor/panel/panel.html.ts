// The right sidebar: header, alignment row, position/size fields, the Layout
// section, the Fill/Background row, the (parked) Versions switch, and the
// Text section's mount point (#panelGroup, filled by textPanel.ts).
export const SIDE_PANEL = `    <div class="sidepanel">
      <div class="lp-head">
        <button class="avatar" id="avatarBtn" type="button" aria-label="Open settings" title="Settings"></button>
        <button class="panelbtn" id="hideRight" type="button" aria-label="Hide right sidebar" title="Hide sidebar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="2"/><path d="M8.5 2.5v9"/></svg></button>
        <button class="sharebtn" id="shareBtn" type="button" disabled title="Sharing is coming soon">Share</button>
      </div>
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
      <div class="sp-divider sp-layout-div" id="layoutDiv"></div>
      <div class="sp-section sp-layout" id="layoutSec">
        <div class="sp-label">Layout</div>
        <div class="propgroup" id="layoutGroup"></div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-section sp-fill">
        <div class="sp-label" id="fillLabel">Fill</div>
        <button class="fillrow" id="fillRow" type="button" tabindex="-1" aria-label="Fill color"><span class="swatch"></span><span class="hex">1C1C1C</span><span class="pct">100%</span></button>
      </div>
      <div class="sp-divider sp-hidden"></div>
      <div class="sp-section sp-hidden">
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
    </div>`
