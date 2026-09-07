// Sidebar chrome (the floating reveal buttons and the resize strips) and the
// settings dialog.
export const REVEAL_BUTTONS = `      <button class="panelbtn reveal reveal-left" id="showLeft" type="button" aria-label="Show left sidebar" title="Show sidebar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="2"/><path d="M5.5 2.5v9"/></svg></button>
      <button class="panelbtn reveal reveal-right" id="showRight" type="button" aria-label="Show right sidebar" title="Show sidebar"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="2"/><path d="M8.5 2.5v9"/></svg></button>`

export const RESIZERS = `    <div class="resizer left" id="resizeLeft" title="Drag to resize"></div>
    <div class="resizer right" id="resizeRight" title="Drag to resize"></div>`

export const SETTINGS_DIALOG = `    <div class="settings" id="settings">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <nav class="settings-nav">
          <div class="settings-title">Settings</div>
          <div class="navind" id="navInd"></div>
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
                <div class="segind" id="segInd"></div>
                <button type="button" data-theme="light">Light</button>
                <button type="button" data-theme="dark">Dark</button>
                <button type="button" data-theme="system">System</button>
              </div>
            </div>
            <div class="srow">
              <div class="slabel"><b>Frame timestamps</b><span>Show when each frame was last edited. Shift+T to toggle.</span></div>
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
              <div class="k">Text tool</div><div><kbd>T</kbd></div>
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
              <div class="k">Smart layout: add/remove on a frame, or wrap selected text</div><div><kbd>⇧</kbd><kbd>A</kbd></div>
              <div class="k">Settings</div><div><kbd>⌘</kbd><kbd>,</kbd></div>
              <div class="k">Hide / show sidebars</div><div><kbd>⌘</kbd><kbd>\\</kbd></div>
            </div>
          </section>
        </div>
      </div>
    </div>`
