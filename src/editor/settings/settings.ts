// Settings dialog (⌘,), UI theme, avatar, and the collapsible/resizable
// sidebars. All of it is driven by ctx.prefs.
//
// Theme drives the UI tokens on :root only. The canvas (background, frame
// labels, selection blue) is left alone — those already adapt to the canvas
// background color, whatever the theme.
import type { EditorContext, Disposable } from "../core/context"
import { CANVAS_DEFAULT } from "../core/context"
import { type Theme, LEFT_W, RIGHT_W, clampW, savePrefs as save } from "./prefs"

export interface SettingsAPI {
    applyTheme(): void
    renderAvatar(): void
    openSettings(): void
    closeSettings(): void
    toggleSidebars(): void
}

export function installSettings(ctx: EditorContext): SettingsAPI & Disposable {
    const { root, prefs } = ctx
    const { app } = ctx.dom
    const savePrefs = () => save(prefs)

    const systemDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null
    function isDark() {
        return prefs.theme === "dark" || (prefs.theme === "system" && !!systemDark?.matches)
    }
    const segInd = root.querySelector<HTMLElement>("#segInd")
    function updateThemeIndicator() {
        const active = root.querySelector<HTMLElement>("#prefTheme button.active")
        if (!segInd || !active) return
        // the Appearance section is hidden until first visited, so its first
        // real measurement can land well after mount — skip the slide just
        // this once so it doesn't visibly grow in from a stale zero width
        const firstReal = !segInd.dataset.placed && active.offsetWidth > 0
        if (firstReal) segInd.style.transition = "none"
        segInd.style.left = active.offsetLeft + "px"
        segInd.style.width = active.offsetWidth + "px"
        if (firstReal) {
            segInd.dataset.placed = "1"
            void segInd.offsetWidth // flush the position before transitions resume
            segInd.style.transition = ""
        }
    }
    function applyTheme() {
        document.documentElement.classList.toggle("dark", isDark())
        root.querySelectorAll<HTMLElement>("#prefTheme button").forEach((b) =>
            b.classList.toggle("active", b.dataset.theme === prefs.theme)
        )
        updateThemeIndicator()
    }
    const onSystemTheme = () => {
        if (prefs.theme === "system") applyTheme()
    }
    systemDark?.addEventListener("change", onSystemTheme)
    function setTheme(t: Theme) {
        if (t === prefs.theme) return
        prefs.theme = t
        savePrefs()
        applyTheme()
    }

    // profile picture: initials of the display name, or a silhouette
    const userIcon = (px: number) =>
        `<svg width="${px}" height="${px}" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5.2" r="3"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0z"/></svg>`
    function initials(name: string) {
        const parts = name.trim().split(/\s+/).filter(Boolean)
        if (!parts.length) return ""
        const a = parts[0][0] ?? ""
        const b = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : ""
        return (a + b).toUpperCase()
    }
    function renderAvatar() {
        const ini = initials(prefs.name)
        root.querySelectorAll<HTMLElement>(".avatar").forEach((el) => {
            if (ini) el.textContent = ini
            else el.innerHTML = userIcon(el.classList.contains("lg") ? 28 : 16)
        })
    }

    const settingsEl = root.querySelector<HTMLElement>("#settings")
    let settingsSec = "account"
    const navInd = root.querySelector<HTMLElement>("#navInd")
    function updateNavIndicator() {
        const active = root.querySelector<HTMLElement>(".snav.active")
        if (!navInd || !active) return
        navInd.style.top = active.offsetTop + "px"
        navInd.style.height = active.offsetHeight + "px"
    }
    function showSettingsSection(sec: string) {
        settingsSec = sec
        root.querySelectorAll<HTMLElement>(".snav").forEach((b) => b.classList.toggle("active", b.dataset.sec === sec))
        root.querySelectorAll<HTMLElement>(".ssec").forEach((s) => s.classList.toggle("active", s.dataset.sec === sec))
        // both indicators: whichever section is visible now measures correctly;
        // the other settles into place next time it's shown
        updateNavIndicator()
        updateThemeIndicator()
    }
    function openSettings() {
        if (!settingsEl || ctx.ui.settingsOpen) return
        ctx.ui.settingsOpen = true
        settingsEl.classList.add("open")
        showSettingsSection(settingsSec)
        ;(root.querySelector<HTMLElement>(".snav.active") ?? settingsEl).focus?.()
    }
    function closeSettings() {
        if (!settingsEl || !ctx.ui.settingsOpen) return
        ctx.ui.settingsOpen = false
        settingsEl.classList.remove("open")
        root.querySelector<HTMLElement>("#avatarBtn")?.focus()
    }
    root.querySelector<HTMLElement>("#avatarBtn")?.addEventListener("click", openSettings)
    root.querySelector<HTMLElement>("#settingsClose")?.addEventListener("click", closeSettings)
    settingsEl?.addEventListener("pointerdown", (e) => {
        if (e.target === settingsEl) closeSettings() // the backdrop
    })
    root.querySelectorAll<HTMLElement>(".snav").forEach((b) =>
        b.addEventListener("click", () => showSettingsSection(b.dataset.sec))
    )
    const nameInput = root.querySelector<HTMLInputElement>("#prefName")
    if (nameInput) {
        nameInput.value = prefs.name
        nameInput.addEventListener("input", () => {
            prefs.name = nameInput.value.slice(0, 40)
            savePrefs()
            renderAvatar()
        })
        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") nameInput.blur()
        })
    }
    root.querySelectorAll<HTMLElement>("#prefTheme button").forEach((b) =>
        b.addEventListener("click", () => setTheme(b.dataset.theme as Theme))
    )
    root.querySelector<HTMLInputElement>("#prefTimes")?.addEventListener("change", (e) =>
        ctx.times.setShowTimes((e.target as HTMLInputElement).checked, false)
    )
    const gridSwitch = root.querySelector<HTMLInputElement>("#prefGrid")
    if (gridSwitch) {
        gridSwitch.checked = prefs.grid
        gridSwitch.addEventListener("change", () => {
            prefs.grid = gridSwitch.checked
            savePrefs()
            ctx.view.applyGrid()
        })
    }
    root.querySelector<HTMLElement>("#prefResetBg")?.addEventListener("click", () => {
        ctx.doc.bg = { hex: CANVAS_DEFAULT, alpha: 100 }
        ctx.panel.fill.applyBg()
        ctx.panel.fill.updateFill()
        ctx.persist.scheduleSave()
    })
    root.querySelector<HTMLElement>("#prefResetView")?.addEventListener("click", () => ctx.view.resetView())

    /* ---- sidebars: each hides from its own header button and comes back
       from a floating button at that edge of the canvas; ⌘\ toggles both ---- */
    // widths go on the mount's parent so the host's color picker (a sibling
    // of the engine root, anchored to the right sidebar) can read them too
    const varHost = root.parentElement ?? root
    function applyPanels() {
        app.classList.toggle("left-hidden", !prefs.leftPanel)
        app.classList.toggle("right-hidden", !prefs.rightPanel)
        varHost.style.setProperty("--left-w", prefs.leftWidth + "px")
        varHost.style.setProperty("--right-w", prefs.rightWidth + "px")
        // the canvas just changed size; its ResizeObserver redraws the chrome
    }
    /* drag a sidebar's inner edge to resize it; the width persists with prefs */
    function wireResizer(el: HTMLElement | null, side: "leftWidth" | "rightWidth") {
        if (!el) return
        el.addEventListener("pointerdown", (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            const startX = e.clientX
            const startW = prefs[side]
            const range = side === "leftWidth" ? LEFT_W : RIGHT_W
            el.classList.add("active")
            app.classList.add("resizing")
            const mv = (ev: PointerEvent) => {
                // the left sidebar grows as the pointer moves right; the right one as it moves left
                const dx = side === "leftWidth" ? ev.clientX - startX : startX - ev.clientX
                const w = clampW(startW + dx, range)
                if (w !== prefs[side]) {
                    prefs[side] = w
                    applyPanels()
                }
            }
            const up = () => {
                document.removeEventListener("pointermove", mv)
                document.removeEventListener("pointerup", up)
                el.classList.remove("active")
                app.classList.remove("resizing")
                savePrefs()
            }
            document.addEventListener("pointermove", mv)
            document.addEventListener("pointerup", up)
        })
    }
    wireResizer(root.querySelector<HTMLElement>("#resizeLeft"), "leftWidth")
    wireResizer(root.querySelector<HTMLElement>("#resizeRight"), "rightWidth")
    function setPanel(side: "leftPanel" | "rightPanel", on: boolean) {
        if (prefs[side] === on) return
        prefs[side] = on
        savePrefs()
        applyPanels()
    }
    function toggleSidebars() {
        const anyOn = prefs.leftPanel || prefs.rightPanel
        prefs.leftPanel = prefs.rightPanel = !anyOn
        savePrefs()
        applyPanels()
    }
    root.querySelector<HTMLElement>("#hideLeft")?.addEventListener("click", () => setPanel("leftPanel", false))
    root.querySelector<HTMLElement>("#showLeft")?.addEventListener("click", () => setPanel("leftPanel", true))
    root.querySelector<HTMLElement>("#hideRight")?.addEventListener("click", () => setPanel("rightPanel", false))
    root.querySelector<HTMLElement>("#showRight")?.addEventListener("click", () => setPanel("rightPanel", true))
    applyPanels()

    return {
        applyTheme,
        renderAvatar,
        openSettings,
        closeSettings,
        toggleSidebars,
        dispose() {
            systemDark?.removeEventListener("change", onSystemTheme)
            document.documentElement.classList.remove("dark")
        },
    }
}
