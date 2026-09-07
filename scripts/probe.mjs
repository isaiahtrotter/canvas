#!/usr/bin/env node
// Characterization probe for the canvas editor.
//
// Drives the app in a headless Brave/Chromium through a fixed script of
// interactions against a fixed seed document, and dumps the observable state
// (saved doc, DOM, panel values) after every step as sorted JSON. Run it once
// on a known-good commit with `--label baseline`; every later run diffs itself
// against that baseline and exits non-zero on any difference or page error.
//
//   npm run probe:baseline          # write .probe/dev/baseline
//   npm run probe                   # run + diff against it (label = git sha)
//   npm run probe -- --label x      # custom label
//   npm run probe:preview:baseline  # same two, against `vite build && vite preview`
//   npm run probe:preview           # (production bundle; separate .probe/preview/ baseline)
//
// Env: PROBE_BROWSER (path to a Chromium binary), PROBE_PORT (default 5199).

import puppeteer from "puppeteer-core"
import { spawn, spawnSync, execSync } from "node:child_process"
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync, mkdtempSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import net from "node:net"

// ---------------------------------------------------------------- args ----
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const PREVIEW = flag("--preview")
const NO_DIFF = flag("--no-diff")
const LABEL =
    opt("--label", null) ??
    (() => {
        try {
            return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
        } catch {
            return "run"
        }
    })()
const PORT = Number(process.env.PROBE_PORT ?? 5199)
const BROWSER = process.env.PROBE_BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
const ROOT = resolve(new URL("..", import.meta.url).pathname)
// dev and preview bundles serialize CSS differently, so each mode has its own baseline
const DIR = join(ROOT, ".probe", PREVIEW ? "preview" : "dev")
const OUT = join(DIR, LABEL)
const BASELINE = join(DIR, "baseline")

// The frozen "now". Every timestamp the app writes during the run is exactly
// this, and every relative label ("2h ago") is computed against it.
const T = 1_790_000_000_000

// ---------------------------------------------------------------- seed ----
const seedDoc = {
    items: [
        { kind: "frame", id: 1, x: 100, y: 100, w: 400, h: 260, name: "Hero", createdAt: T - 7200e3, updatedAt: T - 3600e3, fill: "#ffffff", alpha: 100, layout: null, parent: null },
        { kind: "text", id: 2, x: 124, y: 124, text: "Headline", size: 32, font: "Inter", weight: 600, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: 1, updatedAt: T - 3600e3 },
        { kind: "text", id: 3, x: 380, y: 300, text: "Body copy that runs well past the right edge", size: 16, font: "Georgia", weight: 400, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: 1, updatedAt: T - 3600e3 },
        { kind: "frame", id: 4, x: 124, y: 180, w: 160, h: 80, name: "Card", createdAt: T - 7000e3, updatedAt: T - 600e3, fill: "#f2f2f2", alpha: 100, layout: null, parent: 1 },
        { kind: "text", id: 5, x: 220, y: 196, text: "Nested label text", size: 14, font: "PP Mondwest", weight: 400, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: 4, updatedAt: T - 600e3 },
        { kind: "frame", id: 6, x: 600, y: 100, w: 10, h: 10, name: "Stack", createdAt: T - 90000e3, updatedAt: T - 86400e3, fill: "#ffffff", alpha: 100, layout: { direction: "vertical", gap: 12, padding: 24, align: "start", sizing: "hug" }, parent: null },
        { kind: "text", id: 7, x: 624, y: 124, text: "One", size: 20, font: "Inter", weight: 400, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: 6, updatedAt: T - 86400e3 },
        { kind: "text", id: 8, x: 624, y: 160, text: "Two", size: 20, font: "Helvetica Neue", weight: 700, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: 6, updatedAt: T - 86400e3 },
        { kind: "text", id: 9, x: 624, y: 200, text: "Three", size: 24, font: "PP NeueBit", weight: 400, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: 6, updatedAt: T - 86400e3 },
        { kind: "text", id: 10, x: 100, y: 420, text: "Loose caption", size: 12, font: "Inter", weight: 400, lineHeight: 1.5, letterSpacing: 1, opacity: 100, fill: "#1c1c1c", alpha: 100, parent: null, updatedAt: T - 120e3 },
        { kind: "frame", id: 11, x: 4000, y: 3000, w: 200, h: 150, name: "Far away", createdAt: T - 8 * 86400e3, updatedAt: T - 7 * 86400e3, fill: "#ffffff", alpha: 100, layout: null, parent: null },
    ],
    nextId: 12,
    frameCount: 4,
    bg: { hex: "#ededed", alpha: 100 },
    view: { x: 0, y: 0, z: 1 },
}
const seedPrefs = { theme: "light", name: "Probe User", grid: true, leftPanel: true, rightPanel: true, leftWidth: 200, rightWidth: 230 }

// -------------------------------------------------------------- server ----
function waitForPort(port, ms = 30000) {
    const t0 = Date.now()
    return new Promise((res, rej) => {
        const tick = () => {
            const s = net.connect(port, "127.0.0.1")
            s.once("connect", () => {
                s.destroy()
                res()
            })
            s.once("error", () => {
                s.destroy()
                if (Date.now() - t0 > ms) rej(new Error("server did not start on :" + port))
                else setTimeout(tick, 150)
            })
        }
        tick()
    })
}
function startServer() {
    if (PREVIEW) {
        const b = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" })
        if (b.status !== 0) throw new Error("vite build failed")
    }
    const args = PREVIEW ? ["vite", "preview", "--port", String(PORT), "--strictPort"] : ["vite", "--port", String(PORT), "--strictPort"]
    const child = spawn("npx", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    let log = ""
    child.stdout.on("data", (d) => (log += d))
    child.stderr.on("data", (d) => (log += d))
    child.on("exit", (code) => {
        if (code && !stopping) {
            console.error("[probe] server exited", code, "\n" + log)
            process.exit(3)
        }
    })
    return child
}
let stopping = false

// ------------------------------------------------------------- helpers ----
const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === "object") {
        const o = {}
        for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k])
        return o
    }
    return v
}
const stable = (v) => JSON.stringify(sortKeys(v), null, 2) + "\n"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------- page-side code ----
// Runs before any app script on every navigation. Freezes time, seeds
// storage once per tab (sessionStorage survives the reload in step 99).
const bootstrap = (T, doc, prefs) => {
    const RealDate = Date
    class FrozenDate extends RealDate {
        constructor(...a) {
            super(...(a.length ? a : [T]))
        }
        static now() {
            return T
        }
    }
    Object.setPrototypeOf(FrozenDate, RealDate)
    window.Date = FrozenDate
    try {
        if (!sessionStorage.getItem("__probe_seeded")) {
            localStorage.clear()
            localStorage.setItem("canvas.doc.v1", JSON.stringify(doc))
            localStorage.setItem("canvas.prefs.v1", JSON.stringify(prefs))
            localStorage.setItem("canvas.showTimestamps", "1")
            sessionStorage.setItem("__probe_seeded", "1")
        }
    } catch (_) {}
}

// The observation. Everything here must be deterministic given the seed,
// the frozen clock, and the fixed viewport.
const capture = (T) => {
    const q = (s, r = document) => r.querySelector(s)
    const qa = (s, r = document) => Array.from(r.querySelectorAll(s))
    const rel = (v) => (typeof v === "number" ? "<T-" + Math.round((T - v) / 1000) + "s>" : v)
    const normItem = (it) => {
        const o = { ...it }
        if ("createdAt" in o) o.createdAt = rel(o.createdAt)
        if ("updatedAt" in o) o.updatedAt = rel(o.updatedAt)
        return o
    }
    const ls = (k) => {
        try {
            const v = localStorage.getItem(k)
            return v == null ? null : JSON.parse(v)
        } catch {
            return "<unparseable>"
        }
    }
    const doc = ls("canvas.doc.v1")
    if (doc && Array.isArray(doc.items)) doc.items = doc.items.map(normItem)
    const el = (n) => ({
        tag: n.tagName.toLowerCase(),
        id: n.id || undefined,
        did: n.dataset?.id,
        cls: n.className,
        style: n.getAttribute("style") || "",
    })
    const world = q("#world")
    const overlay = q("#overlay")
    const canvas = q("#canvas")
    const app = q(".app")
    const inputVal = (s) => {
        const n = q(s)
        return n ? { value: n.value, disabled: n.disabled, placeholder: n.placeholder || undefined } : null
    }
    const cs = (n) => (n ? getComputedStyle(n) : null)
    const labels = qa(".labels .flabel", overlay).map((n) => ({
        ...el(n),
        name: q(".fname", n)?.textContent,
        nameCe: q(".fname", n)?.getAttribute("contenteditable") || undefined,
        time: q(".ftime", n)?.textContent,
        t: rel(Number(q(".ftime", n)?.dataset.t)),
        title: q(".ftime", n)?.title,
    }))
    return {
        errors: [],
        storage: { doc, prefs: ls("canvas.prefs.v1"), times: localStorage.getItem("canvas.showTimestamps") },
        world: qa(":scope > *", world).map((n) => ({
            ...el(n),
            text: n.classList.contains("titem") ? n.textContent : undefined,
            ce: n.getAttribute("contenteditable") || undefined,
            vars: {
                heat: n.style.getPropertyValue("--heat") || undefined,
                heatFrame: n.style.getPropertyValue("--heat-frame") || undefined,
                phase: n.style.getPropertyValue("--phase") || undefined,
            },
            kids: qa(":scope > *", n).map((k) => k.className),
        })),
        overlay: qa(":scope > *", overlay)
            .filter((n) => !n.classList.contains("labels"))
            .map((n) => ({
                ...el(n),
                text: n.classList.contains("measure-label") || n.classList.contains("selsize") ? n.textContent : undefined,
                kids: qa(":scope > *", n).map((k) => ({ cls: k.className, style: k.getAttribute("style") || "", text: k.classList.contains("selsize") ? k.textContent : undefined })),
            })),
        labels,
        canvas: {
            cls: canvas.className,
            bg: cs(canvas).backgroundColor,
            vars: {
                fname: canvas.style.getPropertyValue("--fname"),
                ftime: canvas.style.getPropertyValue("--ftime"),
                accent: canvas.style.getPropertyValue("--accent"),
            },
            worldTransform: world.style.transform,
            inv: world.style.getPropertyValue("--inv") || canvas.style.getPropertyValue("--inv"),
            gridCls: q("#grid")?.className,
        },
        app: {
            cls: app?.className,
            wrapKids: qa(":scope > *", q(".canvas-wrap")).map((n) => (n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + "." + n.className.split(" ").join("."))),
            rootCls: document.documentElement.className,
            leftW: app?.parentElement?.style.getPropertyValue("--left-w") || app?.style.getPropertyValue("--left-w"),
            rightW: app?.parentElement?.style.getPropertyValue("--right-w") || app?.style.getPropertyValue("--right-w"),
        },
        chrome: {
            zoom: q("#zoomVal")?.textContent,
            tool: q(".toolpill button.active")?.dataset.tool,
            toast: { cls: q("#toast")?.className, text: q("#toast")?.textContent },
            minimap: {
                cls: q("#minimap")?.className,
                dots: qa("#minimap .mm-dot").map((d) => d.getAttribute("style")),
                view: q("#minimap .mm-view")?.getAttribute("style"),
            },
            heatkey: { cls: q(".heatkey")?.className, ticks: qa(".heatkey .tick").map((t) => t.getAttribute("style") + "|" + t.textContent) },
            settings: { cls: q("#settings")?.className, nav: q(".snav.active")?.dataset.sec, sec: q(".ssec.active")?.dataset.sec },
        },
        panel: {
            posX: inputVal("#posX"),
            posY: inputVal("#posY"),
            dimW: inputVal("#dimW"),
            dimH: inputVal("#dimH"),
            fillLabel: q("#fillLabel")?.textContent,
            fillRow: {
                cls: q("#fillRow")?.className,
                swatch: q("#fillRow .swatch")?.getAttribute("style"),
                hex: q("#fillRow .hex")?.textContent,
                pct: q("#fillRow .pct")?.textContent,
            },
            fontRow: q("#fontRow") ? { text: q("#fontRow").textContent, disabled: q("#fontRow").disabled, style: q("#fontRow").getAttribute("style") } : null,
            selects: qa("#panelGroup select").map((s) => ({ value: s.value, disabled: s.disabled })),
            inputs: qa("#panelGroup input").map((i) => ({ value: i.value, disabled: i.disabled, cls: i.className })),
            layoutSec: q("#layoutSec")?.className,
            layoutGroup: qa("#layoutGroup input, #layoutGroup button, #layoutGroup select").map((n) => ({
                tag: n.tagName.toLowerCase(),
                cls: n.className,
                value: "value" in n ? n.value : undefined,
                label: n.getAttribute("aria-label") || n.title || undefined,
                disabled: n.disabled,
            })),
            align: qa("#alignRow button").map((b) => ({ title: b.title || b.getAttribute("aria-label"), disabled: b.disabled })),
            sidepanel: q(".sidepanel")?.className,
            vbtn: q(".vergroup .vbtn.active")?.dataset.v,
            sizewrap: q(".sizewrap")?.className,
            drawer: q(".sizedrawer")?.className,
            widget: q(".sizedrawer") ? qa(".sizedrawer .handle, .sizedrawer .pill, .sizedrawer .numtag").map((n) => ({ cls: n.className, style: n.getAttribute("style") || "", text: n.textContent })) : [],
        },
        focus: (() => {
            const a = document.activeElement
            return a ? a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") + (a.className ? "." + String(a.className).split(" ").join(".") : "") : null
        })(),
    }
}

// World → screen, using the live #world transform (translate(x, y) scale(z)).
const worldToScreen = (wx, wy) => {
    const c = document.querySelector("#canvas").getBoundingClientRect()
    const tr = document.querySelector("#world").style.transform
    const nums = (tr.match(/-?\d+(\.\d+)?/g) || ["0", "0", "1"]).map(Number)
    const [tx, ty, z] = nums.length >= 3 ? [nums[0], nums[1], nums[nums.length - 1]] : [0, 0, 1]
    return { x: c.left + tx + wx * z, y: c.top + ty + wy * z }
}

// ----------------------------------------------------------------- run ----
async function main() {
    if (!existsSync(BROWSER)) {
        console.error("[probe] browser not found at", BROWSER, "— set PROBE_BROWSER")
        process.exit(2)
    }
    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })

    const server = startServer()
    await waitForPort(PORT)
    const profile = mkdtempSync(join(process.env.PROBE_TMP ?? tmpdir(), "canvas-probe-"))
    const browser = await puppeteer.launch({
        executablePath: BROWSER,
        headless: true,
        defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
        args: ["--force-device-scale-factor=1", "--user-data-dir=" + profile, "--no-first-run", "--disable-extensions", "--disable-background-networking"],
    })
    const page = await browser.newPage()
    const errors = []
    page.on("pageerror", (e) => errors.push("pageerror: " + (e?.message || String(e))))
    page.on("console", (m) => {
        if (m.type() !== "error") return
        const url = m.location()?.url || ""
        if (/\/favicon\.ico$/.test(url)) return // the browser's own request; index.html declares no icon
        errors.push("console.error: " + m.text() + (url ? " @ " + url : ""))
    })
    page.on("response", (r) => {
        const url = r.url()
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(url)) errors.push(`http ${r.status()}: ${url}`)
    })
    await page.evaluateOnNewDocument(bootstrap, T, seedDoc, seedPrefs)

    let n = 0
    const run = { label: LABEL, mode: PREVIEW ? "preview" : "dev", startedAt: new Date().toISOString(), steps: [], checks: {} }
    const cap = async (name) => {
        await sleep(60) // let the last pointer/keyboard event's emit() and the 150ms save debounce start
        const snap = await page.evaluate(capture, T)
        snap.errors = errors.splice(0)
        const file = String(n++).padStart(2, "0") + "-" + name + ".json"
        writeFileSync(join(OUT, file), stable(snap))
        run.steps.push(file)
        if (snap.errors.length) console.error("[probe] errors at", name, snap.errors)
        return snap
    }
    const settle = (ms = 250) => sleep(ms) // > the 150ms save debounce

    // geometry helpers
    const rectOf = (sel) => page.evaluate((s) => {
        const n = document.querySelector(s)
        if (!n) return null
        const r = n.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    }, sel)
    const must = async (sel) => {
        const r = await rectOf(sel)
        if (!r) throw new Error("missing element: " + sel)
        return r
    }
    const click = async (sel, opts = {}) => {
        const r = await must(sel)
        await page.mouse.click(r.cx, r.cy, opts)
    }
    const screen = (wx, wy) => page.evaluate(worldToScreen, wx, wy)
    const clickWorld = async (wx, wy, opts = {}) => {
        const p = await screen(wx, wy)
        await page.mouse.click(p.x, p.y, opts)
    }
    // drag with a pointer that reports movement in small steps (snapping,
    // membership-follow and duplicate logic all run on pointermove)
    const drag = async (from, to, { steps = 12, mid = null, altAtStep = -1 } = {}) => {
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        for (let i = 1; i <= steps; i++) {
            if (i === altAtStep) await page.keyboard.down("Alt")
            await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
            if (mid && i === Math.floor(steps / 2)) await mid()
        }
        await page.mouse.up()
        if (altAtStep >= 0) await page.keyboard.up("Alt")
    }
    const combo = async (mods, key) => {
        for (const m of mods) await page.keyboard.down(m)
        await page.keyboard.press(key)
        for (const m of mods.slice().reverse()) await page.keyboard.up(m)
    }
    const cmd = (key) => combo(["Meta"], key)
    const shift = (key) => combo(["Shift"], key)
    const textSel = (id) => `#world .titem[data-id="${id}"]`
    const labelSel = (id) => `#overlay .labels .flabel[data-id="${id}"] .fname`

    await page.goto(`http://127.0.0.1:${PORT}/?probe=1`, { waitUntil: "load" }) // ?probe=1 exposes window.__canvasEditor in production builds too
    await page.waitForSelector("#world .titem", { timeout: 15000 })
    const fonts = await page.evaluate(async () => {
        await document.fonts.ready
        // fonts.check() is true when no face matches at all, so test the
        // declared faces directly: Inter (Google Fonts) and the two PP faces
        const loaded = (fam) => Array.from(document.fonts).some((f) => f.family.replace(/["']/g, "") === fam && f.status === "loaded")
        return {
            inter: loaded("Inter"),
            mondwest: loaded("PP Mondwest"),
            neuebit: loaded("PP NeueBit"),
            faces: Array.from(document.fonts).map((f) => f.family.replace(/["']/g, "") + ":" + f.weight + ":" + f.status),
            ua: navigator.userAgent,
        }
    })
    run.fonts = fonts
    if (!fonts.inter || !fonts.mondwest || !fonts.neuebit) {
        console.error("[probe] fonts not loaded — aborting rather than producing a misleading diff", fonts)
        await shutdown(browser, server, profile)
        process.exit(2)
    }
    await page.addStyleTag({ content: "* { transition: none !important; animation: none !important; }" })
    await settle(200)

    // 00 — mount: hug sizes, clips, labels, markup + stylesheet hashes
    const s00 = await cap("mount")
    run.checks.markupHash = await page.evaluate(() => {
        const s = document.querySelector(".app").outerHTML
        // the mounted shell plus whatever the boot render produced
        return s.length + ":" + Array.from(s).reduce((h, c) => ((h * 31 + c.charCodeAt(0)) | 0), 7)
    })
    run.checks.styleHash = await page.evaluate(() => {
        const out = []
        for (const ss of Array.from(document.styleSheets)) {
            try {
                for (const r of Array.from(ss.cssRules)) out.push(r.cssText)
            } catch {
                out.push("<cross-origin:" + ss.href + ">")
            }
        }
        const s = out.join("\n").replace(/\s+/g, " ")
        return s.length + ":" + Array.from(s).reduce((h, c) => ((h * 31 + c.charCodeAt(0)) | 0), 7)
    })
    writeFileSync(join(OUT, "00-hashes.json"), stable(run.checks))

    // 01 — select a loose text
    await click(textSel(10))
    await cap("select-text")

    // 02 — drag it; snapping should pull x back onto Hero's left edge
    {
        const r = await must(textSel(10))
        await drag({ x: r.cx, y: r.cy }, { x: r.cx + 5, y: r.cy + 150 }, { mid: () => cap("drag-mid") })
        await settle()
        await cap("drag-released")
    }

    // 03 — option-drag duplicates
    {
        const r = await must(textSel(10))
        await drag({ x: r.cx, y: r.cy }, { x: r.cx, y: r.cy + 60 }, { altAtStep: 3 })
        await settle()
        await cap("alt-drag-duplicate")
    }

    // 04 — select Hero by its label, resize from the bottom-right handle
    await click(labelSel(1))
    await cap("select-frame-by-label")
    {
        const h = await must("#overlay .selbox .selhandle.br")
        await drag({ x: h.cx, y: h.cy }, { x: h.cx + 40, y: h.cy + 20 })
        await settle()
        await cap("resize-frame")
    }

    // 05 — edit text inside the hugging frame; live relayout while typing
    await click(textSel(7), { clickCount: 2 })
    await sleep(80)
    await page.keyboard.type("One longer")
    await cap("edit-mid")
    await page.keyboard.press("Enter")
    await settle()
    await cap("edit-committed")

    // 06 — rename a frame via its label
    await click(labelSel(6), { clickCount: 2 })
    await sleep(80)
    await page.keyboard.type("Stack renamed")
    await page.keyboard.press("Enter")
    await settle()
    await cap("rename-frame")

    // 07 — timestamps toggle
    await shift("T")
    await sleep(400)
    await cap("times-hidden")
    await shift("T")
    await sleep(400)
    await cap("times-shown")

    // 08 — heatmap toggle
    await shift("H")
    await sleep(450)
    await cap("heat-on")
    await shift("H")
    await sleep(450)
    await cap("heat-off")

    // 09 — wrap two texts in a smart layout, then remove the layout again
    await click(textSel(10))
    await page.keyboard.down("Shift")
    await click(textSel(12))
    await page.keyboard.up("Shift")
    await cap("shift-select-two")
    await shift("A")
    await settle()
    await cap("wrap-in-layout")
    await shift("A")
    await settle()
    await cap("layout-removed")

    // 10 — keyboard zoom
    await cmd("Equal")
    await cap("zoom-in-1")
    await cmd("Equal")
    await cap("zoom-in-2")
    await cmd("Minus")
    await cap("zoom-out")
    await cmd("Digit0")
    await settle()
    await cap("zoom-reset")

    // 11 — space pan, then pan far enough that the minimap appears
    {
        await page.keyboard.down("Space")
        const a = await screen(700, 600)
        await drag(a, { x: a.x - 200, y: a.y - 200 })
        await page.keyboard.up("Space")
        await settle()
        await cap("pan")
        await page.keyboard.down("Space")
        const b = await screen(700, 600)
        await drag({ x: b.x + 300, y: b.y + 100 }, { x: b.x - 1200, y: b.y - 700 })
        await page.keyboard.up("Space")
        await settle()
        await cap("pan-far-minimap")
        await cmd("Digit0")
        await settle()
        await cap("pan-reset")
    }

    // 12 — undo / redo round trip
    const before12 = (await cap("pre-undo")).storage.doc
    for (let i = 1; i <= 3; i++) {
        await cmd("z")
        await settle()
        await cap("undo-" + i)
    }
    for (let i = 1; i <= 3; i++) {
        await combo(["Meta", "Shift"], "z")
        await settle()
        const s = await cap("redo-" + i)
        if (i === 3) run.checks.redoRoundTrip = stable(s.storage.doc) === stable(before12)
    }

    // 13 — marquee: frames only when fully covered
    {
        const a = await screen(80, 80)
        const b = await screen(560, 400)
        await drag(a, b, { mid: () => cap("marquee-mid") })
        await settle()
        await cap("marquee-released")
    }

    // 14 — arrow nudges coalesce into one undo step
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await shift("ArrowDown")
    await sleep(450)
    await cap("nudged")
    await cmd("z")
    await settle()
    await cap("nudge-undone")

    // 15 — settings dialog; keys are swallowed while it is open
    await cmd("Comma")
    await sleep(100)
    await cap("settings-open")
    await click('.snav[data-sec="appearance"]')
    await sleep(100)
    await cap("settings-appearance")
    await page.keyboard.press("ArrowRight")
    await settle()
    await cap("settings-key-swallowed")
    await page.keyboard.press("Escape")
    await sleep(100)
    await cap("settings-closed")

    // 16 — sidebars
    await cmd("Backslash")
    await sleep(100)
    await cap("sidebars-hidden")
    await cmd("Backslash")
    await sleep(100)
    await click("#hideRight")
    await sleep(100)
    await cap("right-hidden")
    await click("#showRight")
    await sleep(100)
    await cap("right-shown")

    // 17 — the EditorAPI surface (what the React popovers drive)
    await click(textSel(10))
    await page.evaluate(() => {
        const api = window.__canvasEditor
        api.beginFillGesture()
        api.setFill("#ff0000", 50)
        api.setFill("#00ff00", 50)
        api.endFillGesture()
    })
    await settle()
    await cap("api-fill-gesture")
    await cmd("z")
    await settle()
    await cap("api-fill-gesture-undone")
    await page.evaluate(() => window.__canvasEditor.setFont("Georgia"))
    await settle()
    await cap("api-set-font")
    await page.keyboard.press("Escape")
    await settle()
    await page.evaluate(() => window.__canvasEditor.setFill("#112233", 80))
    await settle()
    await cap("api-background")
    await cmd("Comma")
    await click('.snav[data-sec="canvas"]')
    await click("#prefResetBg")
    await settle()
    await cap("background-reset")
    await page.keyboard.press("Escape")
    await sleep(100)

    // 18 — nested frame drilling and hover outlines
    await click(textSel(5))
    await cap("click-nested-selects-card")
    await click(textSel(5), { clickCount: 2 })
    await sleep(80)
    await page.keyboard.press("Escape") // leave text edit if it started
    await sleep(80)
    await cap("drilled")
    {
        const r = await must(textSel(3))
        await page.mouse.move(r.cx, r.cy)
        await sleep(80)
        await cap("hover-in-drilled")
    }
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await settle()
    await cap("escaped-out")

    // 19 — frame tool and text tool
    await page.keyboard.press("f")
    await cap("tool-frame")
    {
        const a = await screen(700, 500)
        const b = await screen(900, 650)
        await drag(a, b)
        await settle()
        await cap("frame-drawn")
    }
    await page.keyboard.press("t")
    await cap("tool-text")
    await clickWorld(700, 700)
    await sleep(80)
    await page.keyboard.type("Placed")
    await cap("text-placed-editing")
    await page.keyboard.press("Enter")
    await settle()
    await cap("text-placed")
    await page.keyboard.press("v")

    // 20 — option-hover measurement
    {
        await page.keyboard.down("Alt")
        const p = await screen(300, 320)
        await page.mouse.move(p.x, p.y)
        await sleep(120)
        await cap("measure")
        await page.keyboard.up("Alt")
    }

    // 21 — pixel grid threshold
    for (let i = 0; i < 11; i++) await cmd("Equal")
    await settle()
    await cap("grid-on")
    await cmd("Digit0")
    await settle()

    // 22 — delete a frame (takes its contents), undo
    await click(labelSel(13))
    await page.keyboard.press("Delete")
    await settle()
    await cap("frame-deleted")
    await cmd("z")
    await settle()
    const s22 = await cap("delete-undone")

    // 99 — reload: persisted doc round-trips; StrictMode double mount leaves no doubled listeners
    await page.reload({ waitUntil: "load" })
    await page.waitForSelector("#world .titem", { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    await page.addStyleTag({ content: "* { transition: none !important; animation: none !important; }" })
    await settle(200)
    const s99 = await cap("reloaded")
    run.checks.reloadRoundTrip = stable(s99.storage.doc) === stable(s22.storage.doc)
    await click(textSel(10))
    const x0 = Number((await page.evaluate(() => document.querySelector("#posX").value)) || NaN)
    await page.keyboard.press("ArrowRight")
    await settle()
    const x1 = Number((await page.evaluate(() => document.querySelector("#posX").value)) || NaN)
    run.checks.singleListener = x1 - x0 === 1
    await cap("reloaded-nudged")

    run.finishedAt = new Date().toISOString()
    run.pageErrors = errors.slice()
    writeFileSync(join(OUT, "_run.json"), stable(run))
    await shutdown(browser, server, profile)

    // ------------------------------------------------------------ report ----
    let bad = false
    const failedChecks = Object.entries(run.checks).filter(([k, v]) => typeof v === "boolean" && !v)
    if (failedChecks.length) {
        bad = true
        console.error("[probe] self-checks failed:", failedChecks.map(([k]) => k).join(", "))
    }
    const stepErrors = readdirSync(OUT)
        .filter((f) => /^\d\d-.*\.json$/.test(f) && f !== "00-hashes.json")
        .flatMap((f) => (JSON.parse(readFileSync(join(OUT, f), "utf8")).errors || []).map((e) => f + ": " + e))
    if (stepErrors.length) {
        bad = true
        console.error("[probe] page errors:\n  " + stepErrors.join("\n  "))
    }
    if (!NO_DIFF && LABEL !== "baseline") {
        if (!existsSync(BASELINE)) {
            console.error(`[probe] no baseline at ${BASELINE} — run \`npm run probe:${PREVIEW ? "preview:" : ""}baseline\` on a known-good commit first`)
            bad = true
        } else {
            // _run.json carries the label and wall-clock times, which legitimately
            // differ; every deterministic check it holds is also in 00-hashes.json
            const d = spawnSync("diff", ["-r", "-q", "-x", "_run.json", BASELINE, OUT], { encoding: "utf8" })
            if (d.status !== 0) {
                bad = true
                console.error("[probe] DIFF vs baseline:\n" + d.stdout + d.stderr)
                const full = spawnSync("diff", ["-r", "-u", "-x", "_run.json", BASELINE, OUT], { encoding: "utf8" }).stdout
                const lines = full.split("\n")
                console.error(lines.slice(0, 120).join("\n") + (lines.length > 120 ? `\n… (${lines.length - 120} more lines; see diff -r -u -x _run.json ${BASELINE} ${OUT})` : ""))
            } else {
                console.log(`[probe] ${run.steps.length} steps, identical to ${run.mode} baseline (${LABEL}).`)
            }
        }
    } else {
        console.log(`[probe] ${run.steps.length} steps written to ${OUT}`)
    }
    process.exit(bad ? 1 : 0)
}

async function shutdown(browser, server, profile) {
    stopping = true
    try {
        await browser?.close()
    } catch {}
    try {
        server?.kill("SIGTERM")
    } catch {}
    try {
        rmSync(profile, { recursive: true, force: true })
    } catch {}
}

main().catch(async (e) => {
    console.error("[probe] failed:", e)
    stopping = true
    process.exit(3)
})
