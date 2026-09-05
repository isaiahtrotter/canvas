export const MARKUP = `
<div class="app">
    <div class="layerspanel">
      <div class="lp-head lp-head-left">
        <button class="panelbtn" id="hideLeft" type="button" aria-label="Hide left sidebar" title="Hide sidebar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="2"/><path d="M5.5 2.5v9"/></svg></button>
      </div>
    </div>
    <div class="canvas-wrap">
      <button class="panelbtn reveal reveal-left" id="showLeft" type="button" aria-label="Show left sidebar" title="Show sidebar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="2"/><path d="M5.5 2.5v9"/></svg></button>
      <button class="panelbtn reveal reveal-right" id="showRight" type="button" aria-label="Show right sidebar" title="Show sidebar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="2"/><path d="M8.5 2.5v9"/></svg></button>
      <div class="canvas" id="canvas"><div class="world" id="world"></div><div class="overlay" id="overlay"><canvas class="grid" id="grid"></canvas></div></div>
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
    <div class="resizer left" id="resizeLeft" title="Drag to resize"></div>
    <div class="resizer right" id="resizeRight" title="Drag to resize"></div>
    <div class="settings" id="settings">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <nav class="settings-nav">
          <div class="settings-title">Settings</div>
          <button class="snav active" data-sec="account" type="button">Account</button>
          <button class="snav" data-sec="appearance" type="button">Appearance</button>
          <button class="snav" data-sec="canvas" type="button">Canvas</button>
          <button class="snav" data-sec="shortcuts" type="button">Shortcuts</button>
        </nav>
        <div class="settings-body">
          <button class="settings-close" id="settingsClose" type="button" aria-label="Close settings">&times;</button>
          <section class="ssec active" data-sec="account">
            <h2>Account</h2>
            <div class="srow">
              <div class="avatar lg" id="avatarLg" aria-hidden="true"></div>
            </div>
            <div class="srow">
              <div class="slabel"><b>Display name</b><span>Shown on your profile picture as initials.</span></div>
              <input class="sinput" id="prefName" type="text" placeholder="Your name" maxlength="40" autocomplete="off">
            </div>
            <div class="srow">
              <div class="slabel"><b>Email</b><span>Sign-in isn't set up yet.</span></div>
              <input class="sinput" type="text" value="Not signed in" disabled>
            </div>
          </section>
          <section class="ssec" data-sec="appearance">
            <h2>Appearance</h2>
            <div class="srow">
              <div class="slabel"><b>Theme</b><span>System follows your OS setting.</span></div>
              <div class="seg" id="prefTheme" role="radiogroup" aria-label="Theme">
                <button type="button" data-theme="light">Light</button>
                <button type="button" data-theme="dark">Dark</button>
                <button type="button" data-theme="system">System</button>
              </div>
            </div>
            <div class="srow">
              <div class="slabel"><b>Frame timestamps</b><span>Show when each frame was last edited. Shift+T toggles it too.</span></div>
              <label class="switch"><input type="checkbox" id="prefTimes"><span></span></label>
            </div>
          </section>
          <section class="ssec" data-sec="canvas">
            <h2>Canvas</h2>
            <div class="srow">
              <div class="slabel"><b>Pixel grid</b><span>Draw a one-pixel grid from 1000% zoom.</span></div>
              <label class="switch"><input type="checkbox" id="prefGrid"><span></span></label>
            </div>
            <div class="srow">
              <div class="slabel"><b>Background</b><span>Return the canvas to its default color.</span></div>
              <button class="sbtn" id="prefResetBg" type="button">Reset background</button>
            </div>
            <div class="srow">
              <div class="slabel"><b>View</b><span>Back to 100% at the origin.</span></div>
              <button class="sbtn" id="prefResetView" type="button">Reset view</button>
            </div>
          </section>
          <section class="ssec" data-sec="shortcuts">
            <h2>Shortcuts</h2>
            <div class="keys">
              <div class="k">Move tool</div><div><kbd>V</kbd></div>
              <div class="k">Frame tool</div><div><kbd>F</kbd></div>
              <div class="k">Pan</div><div><kbd>Space</kbd> + drag</div>
              <div class="k">Zoom</div><div><kbd>⌘</kbd><kbd>+</kbd> / <kbd>⌘</kbd><kbd>−</kbd> / <kbd>⌘</kbd><kbd>0</kbd></div>
              <div class="k">Select all / inside frame</div><div><kbd>⌘</kbd><kbd>A</kbd></div>
              <div class="k">Nudge selection</div><div><kbd>↑↓←→</kbd>, <kbd>Shift</kbd> for 10px</div>
              <div class="k">Duplicate while dragging</div><div><kbd>⌥</kbd> + drag</div>
              <div class="k">Measure to another layer</div><div>hold <kbd>⌥</kbd></div>
              <div class="k">Edit text / rename frame</div><div>double-click</div>
              <div class="k">Undo / redo</div><div><kbd>⌘</kbd><kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd></div>
              <div class="k">Toggle timestamps</div><div><kbd>⇧</kbd><kbd>T</kbd></div>
              <div class="k">Heatmap of recent edits</div><div><kbd>⇧</kbd><kbd>H</kbd></div>
              <div class="k">Settings</div><div><kbd>⌘</kbd><kbd>,</kbd></div>
              <div class="k">Hide / show sidebars</div><div><kbd>⌘</kbd><kbd>\\</kbd></div>
            </div>
          </section>
        </div>
      </div>
    </div>
    <div class="sidepanel">
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
    </div>
  </div>
`
