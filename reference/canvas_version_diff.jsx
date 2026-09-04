/**
 * Canvas Version Diff
 *
 * An infinite canvas with a single design frame and a version-history
 * sidebar. Pan with Space + drag or the middle mouse button, zoom with
 * the scroll wheel / pinch, click the "v#" chip to open version history,
 * hold the half-circle icon to peek at the previous version, restore
 * older versions (creates a new version), and Cmd/Ctrl+Z to undo.
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 760
 */
import * as React from "react"
import {
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    useCallback,
} from "react"
import { addPropertyControls, ControlType } from "framer"

/* ------------------------------------------------------------------ */
/* Default photos (embedded so the component works out of the box).    */
/* Override any of these via the property controls.                    */
/* ------------------------------------------------------------------ */

const DEFAULT_EDITOR_ONE_PHOTO =
    "data:image/jpeg;base64,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"
const DEFAULT_EDITOR_TWO_PHOTO =
    "data:image/jpeg;base64,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"
const DEFAULT_TEAM_1 =
    "data:image/jpeg;base64,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"
const DEFAULT_TEAM_2 =
    "data:image/jpeg;base64,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"
const DEFAULT_TEAM_3 =
    "data:image/jpeg;base64,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"

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const HOUR = 3600000
const DAY = 86400000
const BB = 1 // bounding-box border width
const PANEL_W = 242
const PANEL_ANCHOR_X = -204
const PANEL_ANCHOR_Y = -240
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5
const HOVER_SEL =
    ".cvd-badge, .cvd-h1, .cvd-sub, .cvd-cta, .cvd-avatars, .cvd-stack"

type DesignKey = "v1" | "v2" | "v3" | "v4"

interface Version {
    num: string
    at: number
    key: DesignKey
    restoredFrom: string | null
    editor: 0 | 1 | 2 // 0 = "You", 1 = editor one, 2 = editor two
    note: string
}

interface Rect {
    left: number
    top: number
    width: number
    height: number
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function shortTime(t: number) {
    const diff = Date.now() - t
    if (diff < 60000) return "now"
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return mins + "m ago"
    const hours = Math.floor(diff / HOUR)
    if (hours < 24) return hours + "h ago"
    return Math.floor(diff / DAY) + "d ago"
}

function relTime(t: number) {
    const diff = Date.now() - t
    if (diff < 60000) return "Just now"
    const mins = Math.floor(diff / 60000)
    if (mins < 60)
        return "Edited " + mins + (mins === 1 ? " minute ago" : " minutes ago")
    const hours = Math.floor(diff / HOUR)
    if (hours < 24)
        return "Edited " + hours + (hours === 1 ? " hour ago" : " hours ago")
    const days = Math.floor(diff / DAY)
    if (days === 1) return "Edited yesterday"
    return "Edited " + days + " days ago"
}

function longNum(num: string) {
    return "Version " + num.replace(/^v/, "")
}

function initials(name: string) {
    return name
        .split(" ")
        .map((p) => p.charAt(0))
        .join("")
        .toUpperCase()
        .slice(0, 2)
}

function seedVersions(): Version[] {
    const now = Date.now()
    return [
        {
            num: "v1",
            at: now - 3 * DAY - 2 * HOUR,
            key: "v1",
            restoredFrom: null,
            editor: 1,
            note: "Rough first pass to unblock engineering on layout and copy structure.",
        },
        {
            num: "v2",
            at: now - 2 * DAY - 5 * HOUR,
            key: "v2",
            restoredFrom: null,
            editor: 1,
            note: "Switched the button to our brand color so it matches the rest of onboarding.",
        },
        {
            num: "v3",
            at: now - 1 * DAY - 1 * HOUR,
            key: "v3",
            restoredFrom: null,
            editor: 2,
            note: "Added a release badge, second CTA, and social proof per marketing's request.",
        },
        {
            num: "v4",
            at: now - 2 * HOUR,
            key: "v4",
            restoredFrom: null,
            editor: 1,
            note: "Simplified to one CTA and centered the layout to test a cleaner conversion path.",
        },
    ]
}

/* ------------------------------------------------------------------ */
/* Styles (scoped under .cvd)                                          */
/* ------------------------------------------------------------------ */

const CSS = `
.cvd, .cvd * { box-sizing: border-box; }
.cvd {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #141414;
  -webkit-font-smoothing: antialiased;
  --ink: #141414; --ink-2: #6b6b6b; --ink-3: #a3a3a3;
  --line: #ececec; --line-2: #d6d6d6;
  --wash: #f5f5f5; --wash-2: #ededed;
}

.cvd-canvas {
  position: absolute; inset: 0; overflow: hidden; cursor: default;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.cvd-canvas.pan-ready { cursor: grab; }
.cvd-canvas.panning { cursor: grabbing; }
.cvd-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }

.cvd-tag {
  position: absolute; left: -180px; top: -268px; font-size: 12px; color: var(--ink-2);
  white-space: nowrap; display: flex; align-items: center; gap: 8px;
}
.cvd-fname { cursor: pointer; padding: 3px 2px; }
.cvd-fname:hover, .cvd-fname.selected { color: var(--select-hover); }
.cvd-vbtn {
  font: inherit; font-size: 11px; font-weight: 550; color: var(--ink-2); background: var(--wash);
  border: none; border-radius: 5px; height: 20px; padding: 0 7px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px; transition: background .12s, color .12s;
}
.cvd-vbtn:hover { background: var(--wash-2); color: var(--ink); }
.cvd-vbtn svg { transition: transform .15s; }
.cvd-vbtn.open svg { transform: rotate(180deg); }
.cvd-chip {
  background: var(--wash); color: var(--ink-2); font-weight: 550; border-radius: 999px;
  height: 20px; padding: 0 9px; font-size: 10.5px; letter-spacing: .03em;
  display: inline-flex; align-items: center;
}

.cvd-frame {
  position: absolute; left: -180px; top: -240px; width: 360px; background: #fff;
  border: 1px solid var(--line); border-radius: 14px; cursor: default; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.06);
}

/* design inside the frame */
.cvd-card { padding: 28px; }
.cvd-card.center { text-align: center; }
.cvd-badge {
  display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 550;
  letter-spacing: .02em; border-radius: 999px; padding: 4px 11px; margin-bottom: 16px;
  background: var(--accent-soft); color: var(--accent);
}
.cvd-badge i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); display: inline-block; }
.cvd-h1 { font-size: 24px; line-height: 1.2; font-weight: 600; letter-spacing: -.02em; margin: 0 0 8px; }
.cvd-sub { font-size: 13.5px; line-height: 1.55; color: var(--ink-2); margin: 0 0 20px; }
.cvd-cta {
  height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  font-size: 13.5px; font-weight: 550; letter-spacing: .01em;
}
.cvd-cta-row { display: flex; gap: 8px; }
.cvd-cta-row .cvd-cta { flex: 1; }
.cvd-cta.solid { background: var(--accent); color: #fff; }
.cvd-cta.dark { background: var(--ink); color: #fff; }
.cvd-cta.gray { background: #e9e9e9; color: #555; }
.cvd-cta.ghost { background: #fff; border: 1px solid var(--line-2); color: var(--ink); }
.cvd-avatars {
  display: flex; align-items: center; gap: 10px; margin-top: 20px; padding-top: 18px;
  border-top: 1px solid var(--line); font-size: 12px; color: var(--ink-2);
}
.cvd-card.center .cvd-avatars { justify-content: center; }
.cvd-stack { display: flex; }
.cvd-stack span {
  width: 24px; height: 24px; border-radius: 50%; border: 2px solid #fff; margin-left: -7px;
  background-size: cover; background-position: center;
}
.cvd-stack span:first-child { margin-left: 0; }

/* bounding boxes */
.cvd-bbox { position: absolute; border: ${BB}px solid var(--select); pointer-events: none; z-index: 15; }
.cvd-bbox .h {
  position: absolute; width: 8px; height: 8px; background: #fff; border: 1px solid var(--select);
}
.cvd-bbox .h.tl { left: -.5px; top: -.5px; transform: translate(-50%,-50%); }
.cvd-bbox .h.tr { right: -.5px; top: -.5px; transform: translate(50%,-50%); }
.cvd-bbox .h.bl { left: -.5px; bottom: -.5px; transform: translate(-50%,50%); }
.cvd-bbox .h.br { right: -.5px; bottom: -.5px; transform: translate(50%,50%); }

/* version panel */
.cvd-panel {
  position: absolute; width: ${PANEL_W}px; background: #fff; border: 1px solid var(--line);
  border-radius: 14px; padding: 8px; z-index: 10;
  box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.06);
}
.cvd-cards { position: relative; }
.cvd-selbg {
  position: absolute; left: 0; right: 0; top: 0; border-radius: 8px; background: var(--wash);
  z-index: 0; pointer-events: none; opacity: 0;
  transition: transform .2s cubic-bezier(.4,0,.2,1), height .2s cubic-bezier(.4,0,.2,1), opacity .15s ease;
}
.cvd-list { display: flex; flex-direction: column; gap: 4px; position: relative; z-index: 1; }
.cvd-vcard {
  position: relative; border-radius: 8px; padding: 10px 11px; cursor: pointer;
  background: transparent; transition: background .12s;
}
.cvd-vcard:hover { background: var(--wash); }
.cvd-row1 { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.cvd-vnum { font-size: 11px; font-weight: 550; color: var(--ink-2); }
.cvd-vcard.is-current .cvd-vnum, .cvd-vcard.is-current .cvd-cur { color: var(--select); }
.cvd-stamp { font-size: 11px; font-weight: 500; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.cvd-cur {
  margin-left: auto; font-size: 9.5px; font-weight: 550; letter-spacing: .05em;
  text-transform: uppercase; color: var(--ink-2);
}
.cvd-editor { display: flex; align-items: center; gap: 7px; }
.cvd-av {
  width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 9px; font-weight: 600;
  letter-spacing: .02em; display: flex; align-items: center; justify-content: center; flex: none;
  background-size: cover; background-position: center;
}
.cvd-ename { font-size: 11.5px; font-weight: 450; color: var(--ink-2); }
.cvd-note {
  display: none; margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--line);
  font-size: 11.5px; font-weight: 450; line-height: 1.5; color: var(--ink-2);
}
.cvd-vcard.selected .cvd-note { display: block; }
.cvd-origin { margin-top: 9px; font-size: 11px; color: var(--ink-2); display: flex; align-items: center; gap: 5px; }

.cvd-actions { display: flex; gap: 8px; margin-top: 10px; }
.cvd-restore {
  flex: 1; height: 36px; display: flex; align-items: center; justify-content: center;
  font: inherit; font-size: 13px; font-weight: 550; background: var(--ink); color: #fff;
  border: none; border-radius: 8px; cursor: pointer;
}
.cvd-restore:hover { background: #000; }
.cvd-restore:active { transform: scale(.99); }
.cvd-compare {
  width: 36px; height: 36px; flex: none; padding: 0; display: flex; align-items: center;
  justify-content: center; background: #fff; border: none; border-radius: 8px; cursor: pointer;
  -webkit-tap-highlight-color: transparent; touch-action: none;
}
.cvd-compare:hover { background: var(--wash); }
.cvd-compare svg { width: 18px; height: 18px; overflow: visible; transform: rotate(90deg); }
.cvd-compare svg path { stroke: #000; stroke-width: 1.5; stroke-linejoin: round; }
.cvd-compare .hl { fill: var(--ink); }
.cvd-compare .hr { fill: #fff; }
.cvd-compare.held .hl { fill: #fff; }
.cvd-compare.held .hr { fill: var(--ink); }

.cvd-toast {
  position: absolute; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(6px);
  background: var(--ink); color: #fff; font-size: 12.5px; border-radius: 999px; padding: 8px 16px;
  opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 20; white-space: nowrap;
}
.cvd-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (prefers-reduced-motion: reduce) { .cvd * { transition: none !important; } }
`

/* ------------------------------------------------------------------ */
/* Frame design per version                                            */
/* ------------------------------------------------------------------ */

function Design({ k, team }: { k: DesignKey; team: string[] }) {
    const stack = (
        <div className="cvd-stack">
            {team.map((src, i) => (
                <span key={i} style={{ backgroundImage: `url(${src})` }} />
            ))}
        </div>
    )
    const proof = (
        <div className="cvd-avatars">
            {stack}
            <span>Trusted by 12,000+ teams</span>
        </div>
    )
    const headline = (
        <>
            Design together,
            <br />
            in one space
        </>
    )

    if (k === "v1")
        return (
            <div className="cvd-card">
                <h1 className="cvd-h1" style={{ color: "#3a3a3a" }}>
                    {headline}
                </h1>
                <p className="cvd-sub">
                    Set up your workspace and invite your team to start
                    collaborating on the canvas.
                </p>
                <div className="cvd-cta gray">Continue</div>
            </div>
        )
    if (k === "v2")
        return (
            <div className="cvd-card">
                <h1 className="cvd-h1">{headline}</h1>
                <p className="cvd-sub">
                    Set up your workspace and invite your team to start
                    collaborating on the canvas.
                </p>
                <div className="cvd-cta solid">Continue</div>
            </div>
        )
    if (k === "v3")
        return (
            <div className="cvd-card">
                <div className="cvd-badge">
                    <i /> New · Spaces 2.0
                </div>
                <h1 className="cvd-h1">{headline}</h1>
                <p className="cvd-sub">
                    Frames, comments, and version history — everything your team
                    needs on a single shared canvas.
                </p>
                <div className="cvd-cta-row">
                    <div className="cvd-cta solid">Start free</div>
                    <div className="cvd-cta ghost">See a demo</div>
                </div>
                {proof}
            </div>
        )
    return (
        <div className="cvd-card center">
            <div className="cvd-badge">
                <i /> New · Spaces 2.0
            </div>
            <h1 className="cvd-h1">{headline}</h1>
            <p className="cvd-sub">
                Frames, comments, and version history — everything your team
                needs on a single shared canvas.
            </p>
            <div className="cvd-cta dark">Start free</div>
            {proof}
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface Props {
    frameName: string
    accent: string
    accentSoft: string
    selectColor: string
    selectHover: string
    background: string
    borderColor: string
    borderWidth: number
    borderRadius: number
    editorOneName: string
    editorOnePhoto: string
    editorTwoName: string
    editorTwoPhoto: string
    team1: string
    team2: string
    team3: string
    style?: React.CSSProperties
}

export default function CanvasVersionDiff(props: Partial<Props>) {
    const {
        frameName = "Onboarding card",
        accent = "#1d6fe0",
        accentSoft = "#e6eefc",
        selectColor = "#008FF0",
        selectHover = "#86B7F4",
        background = "#ffffff",
        borderColor = "#e5e5e5",
        borderWidth = 1,
        borderRadius = 16,
        editorOneName = "Maya Chen",
        editorTwoName = "Jordan Lee",
        style,
    } = props
    const editorOnePhoto = props.editorOnePhoto || DEFAULT_EDITOR_ONE_PHOTO
    const editorTwoPhoto = props.editorTwoPhoto || DEFAULT_EDITOR_TWO_PHOTO
    const team1 = props.team1 || DEFAULT_TEAM_1
    const team2 = props.team2 || DEFAULT_TEAM_2
    const team3 = props.team3 || DEFAULT_TEAM_3

    /* ---------- state ---------- */
    const [versions, setVersions] = useState<Version[]>(seedVersions)
    const [current, setCurrent] = useState(3)
    const [selected, setSelected] = useState(3)
    const [panelOpen, setPanelOpen] = useState(true)
    const [comparing, setComparing] = useState(false)
    const [view, setView] = useState({ x: 0, y: 0, z: 1 })
    const [origin, setOrigin] = useState({ x: 0, y: 0 })
    const [spaceHeld, setSpaceHeld] = useState(false)
    const [panning, setPanning] = useState(false)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const [tick, setTick] = useState(0)
    const [toast, setToast] = useState<{ msg: string; id: number } | null>(null)
    const [hoveredEl, setHoveredEl] = useState<HTMLElement | null>(null)
    const [selectedEl, setSelectedEl] = useState<HTMLElement | null>(null)
    const [frameSelected, setFrameSelected] = useState(false)
    const [frameNameHover, setFrameNameHover] = useState(false)
    const [boxes, setBoxes] = useState<{
        hover: Rect | null
        frame: Rect | null
        elem: Rect | null
    }>({ hover: null, frame: null, elem: null })

    /* ---------- refs ---------- */
    const rootRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLDivElement>(null)
    const worldRef = useRef<HTMLDivElement>(null)
    const frameRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const versionBtnRef = useRef<HTMLButtonElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const selBgRef = useRef<HTMLDivElement>(null)
    const undoStack = useRef<number[]>([])
    const spaceDown = useRef(false)
    const isPanning = useRef(false)
    const last = useRef({ x: 0, y: 0 })
    const hovering = useRef(false)
    const latest = useRef({ panelOpen, selected, current, versions })
    latest.current = { panelOpen, selected, current, versions }
    const originRef = useRef(origin)
    originRef.current = origin

    const team = [team1, team2, team3]
    const displayIndex = comparing && selected > 0 ? selected - 1 : selected
    const dv = versions[displayIndex]

    /* ---------- editor lookup ---------- */
    const editorInfo = (v: Version) => {
        if (v.editor === 1)
            return { name: editorOneName, photo: editorOnePhoto }
        if (v.editor === 2)
            return { name: editorTwoName, photo: editorTwoPhoto }
        return { name: "You", photo: "", color: "#3b3b3b" }
    }

    /* ---------- toast ---------- */
    const showToast = useCallback((msg: string) => {
        setToast({ msg, id: Date.now() })
    }, [])
    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), 2200)
        return () => clearTimeout(t)
    }, [toast])

    /* ---------- size tracking ---------- */
    useLayoutEffect(() => {
        const el = rootRef.current
        if (!el) return
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    /* ---------- center the composition (frame + tag + panel) ---------- */
    useLayoutEffect(() => {
        if (!size.w || !size.h) return
        const frameH = frameRef.current?.offsetHeight ?? 340
        const panelH = panelRef.current?.offsetHeight ?? 0
        const hasPanel = !!panelRef.current
        const left = hasPanel ? PANEL_ANCHOR_X - PANEL_W : -180
        const right = 180
        const top = -268
        const bottom = -240 + Math.max(frameH, panelH)
        setOrigin({
            x: Math.round(size.w / 2 - (left + right) / 2),
            y: Math.round(size.h / 2 - (top + bottom) / 2),
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size])

    /* ---------- relative-time refresh ---------- */
    useEffect(() => {
        const t = setInterval(() => setTick((n) => n + 1), 30000)
        return () => clearInterval(t)
    }, [])

    /* ---------- reset element selection when the shown design changes ---------- */
    useEffect(() => {
        setHoveredEl(null)
        setSelectedEl(null)
    }, [displayIndex])

    /* ---------- sliding selection background ---------- */
    useLayoutEffect(() => {
        const list = listRef.current
        const bg = selBgRef.current
        if (!list || !bg) return
        const el = list.children[versions.length - 1 - selected] as
            | HTMLElement
            | undefined
        if (!el || !panelOpen) {
            bg.style.opacity = "0"
            return
        }
        bg.style.transform = `translateY(${el.offsetTop}px)`
        bg.style.height = `${el.offsetHeight}px`
        bg.style.opacity = "1"
    }, [selected, versions, panelOpen, tick, current])

    /* ---------- bounding boxes ---------- */
    useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        const rr = root.getBoundingClientRect()
        const rect = (el: HTMLElement | null): Rect | null => {
            if (!el || !el.isConnected) return null
            const r = el.getBoundingClientRect()
            return {
                left: r.left - rr.left - borderWidth - BB,
                top: r.top - rr.top - borderWidth - BB,
                width: r.width + BB * 2,
                height: r.height + BB * 2,
            }
        }
        setBoxes({
            elem: rect(selectedEl),
            hover:
                hoveredEl && hoveredEl !== selectedEl ? rect(hoveredEl) : null,
            frame:
                frameSelected || frameNameHover ? rect(frameRef.current) : null,
        })
    }, [
        view,
        origin,
        size,
        borderWidth,
        hoveredEl,
        selectedEl,
        frameSelected,
        frameNameHover,
        displayIndex,
        versions,
    ])

    /* ---------- wheel zoom (non-passive) ---------- */
    useEffect(() => {
        const canvas = canvasRef.current
        const root = rootRef.current
        if (!canvas || !root) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            const rr = root.getBoundingClientRect()
            const o = originRef.current
            const cx = e.clientX - rr.left - o.x
            const cy = e.clientY - rr.top - o.y
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
            setView((v) => {
                const next = Math.min(
                    ZOOM_MAX,
                    Math.max(ZOOM_MIN, v.z * factor)
                )
                if (next === v.z) return v
                return {
                    x: cx - (cx - v.x) * (next / v.z),
                    y: cy - (cy - v.y) * (next / v.z),
                    z: next,
                }
            })
        }
        canvas.addEventListener("wheel", onWheel, { passive: false })
        return () => canvas.removeEventListener("wheel", onWheel)
    }, [])

    /* ---------- keyboard: space to pan, cmd/ctrl+z to undo ---------- */
    const undo = useCallback(() => {
        if (!undoStack.current.length) return
        const { versions: vs } = latest.current
        let next = vs
        if (vs[vs.length - 1].restoredFrom) next = vs.slice(0, -1)
        const prev = undoStack.current.pop() as number
        setVersions(next)
        setCurrent(prev)
        setSelected(prev)
        showToast("Undid restore · back on " + next[prev].num)
    }, [showToast])

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (!hovering.current) return
            if (e.code === "Space") {
                const t = (e.target as HTMLElement).tagName
                if (t === "INPUT" || t === "TEXTAREA") return
                if (t === "BUTTON") (e.target as HTMLElement).blur()
                if (!spaceDown.current) {
                    spaceDown.current = true
                    setSpaceHeld(true)
                }
                e.preventDefault()
            }
            if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
                e.preventDefault()
                undo()
            }
        }
        const up = (e: KeyboardEvent) => {
            if (e.code === "Space") {
                spaceDown.current = false
                setSpaceHeld(false)
            }
        }
        const blur = () => {
            spaceDown.current = false
            isPanning.current = false
            setSpaceHeld(false)
            setPanning(false)
        }
        window.addEventListener("keydown", down)
        window.addEventListener("keyup", up)
        window.addEventListener("blur", blur)
        return () => {
            window.removeEventListener("keydown", down)
            window.removeEventListener("keyup", up)
            window.removeEventListener("blur", blur)
        }
    }, [undo])

    /* ---------- compare release + outside click ---------- */
    useEffect(() => {
        const release = () => setComparing(false)
        const outside = (e: MouseEvent) => {
            if (!latest.current.panelOpen) return
            const t = e.target as Node
            if (panelRef.current?.contains(t)) return
            if (versionBtnRef.current?.contains(t)) return
            setPanelOpen(false)
            if (latest.current.selected !== latest.current.current)
                setSelected(latest.current.current)
        }
        document.addEventListener("pointerup", release)
        document.addEventListener("pointercancel", release)
        document.addEventListener("click", outside, true)
        return () => {
            document.removeEventListener("pointerup", release)
            document.removeEventListener("pointercancel", release)
            document.removeEventListener("click", outside, true)
        }
    }, [])

    /* ---------- pan handlers ---------- */
    const onPointerDown = (e: React.PointerEvent) => {
        const middle = e.button === 1
        if (!spaceDown.current && !middle) return
        isPanning.current = true
        setPanning(true)
        last.current = { x: e.clientX, y: e.clientY }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        e.preventDefault()
    }
    const onPointerMove = (e: React.PointerEvent) => {
        if (!isPanning.current) return
        const dx = e.clientX - last.current.x
        const dy = e.clientY - last.current.y
        last.current = { x: e.clientX, y: e.clientY }
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    }
    const endPan = () => {
        if (!isPanning.current) return
        isPanning.current = false
        setPanning(false)
    }

    /* ---------- restore ---------- */
    const restore = () => {
        if (selected === current) return
        const source = versions[selected]
        const next: Version[] = [
            ...versions,
            {
                num: "v" + (versions.length + 1),
                at: Date.now(),
                key: source.key,
                restoredFrom: source.num,
                editor: 0,
                note:
                    "Restored " +
                    source.num +
                    " to bring back its design after review.",
            },
        ]
        undoStack.current.push(current)
        setVersions(next)
        setCurrent(next.length - 1)
        setSelected(next.length - 1)
        showToast(
            next[next.length - 1].num + " created · restored from " + source.num
        )
    }

    /* ---------- frame interactions ---------- */
    const onFrameMouseOver = (e: React.MouseEvent) => {
        const el = (e.target as HTMLElement).closest(
            HOVER_SEL
        ) as HTMLElement | null
        setHoveredEl(el)
    }
    const onFrameClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        const el = (e.target as HTMLElement).closest(
            HOVER_SEL
        ) as HTMLElement | null
        if (el) {
            setSelectedEl(el)
            setFrameSelected(false)
        } else {
            setSelectedEl(null)
            setFrameSelected(true)
        }
    }
    const onCanvasClick = (e: React.MouseEvent) => {
        if (e.target === canvasRef.current || e.target === worldRef.current) {
            setSelectedEl(null)
            setFrameSelected(false)
        }
    }

    /* ---------- panel position (root-relative) ---------- */
    const panelLeft = origin.x + view.x + PANEL_ANCHOR_X * view.z - PANEL_W
    const panelTop = origin.y + view.y + PANEL_ANCHOR_Y * view.z

    const rootStyle = {
        width: "100%",
        height: "100%",
        ...style,
        position: "relative",
        overflow: "hidden",
        background,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius,
        ["--accent" as any]: accent,
        ["--accent-soft" as any]: accentSoft,
        ["--select" as any]: selectColor,
        ["--select-hover" as any]: selectHover,
    } as React.CSSProperties

    const Box = ({ r, handles }: { r: Rect | null; handles?: boolean }) =>
        r ? (
            <div
                className="cvd-bbox"
                style={{
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                }}
            >
                {handles && (
                    <>
                        <span className="h tl" />
                        <span className="h tr" />
                        <span className="h bl" />
                        <span className="h br" />
                    </>
                )}
            </div>
        ) : null

    return (
        <div
            ref={rootRef}
            className="cvd"
            style={rootStyle}
            onMouseEnter={() => (hovering.current = true)}
            onMouseLeave={() => (hovering.current = false)}
        >
            <style>{CSS}</style>

            <div
                ref={canvasRef}
                className={
                    "cvd-canvas" +
                    (panning ? " panning" : spaceHeld ? " pan-ready" : "")
                }
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPan}
                onPointerCancel={endPan}
                onAuxClick={(e) => e.button === 1 && e.preventDefault()}
                onClick={onCanvasClick}
            >
                <div
                    ref={worldRef}
                    className="cvd-world"
                    style={{
                        left: origin.x,
                        top: origin.y,
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
                    }}
                >
                    <div className="cvd-tag">
                        <span
                            className={
                                "cvd-fname" + (frameSelected ? " selected" : "")
                            }
                            onMouseEnter={() => setFrameNameHover(true)}
                            onMouseLeave={() => setFrameNameHover(false)}
                            onClick={(e) => {
                                e.stopPropagation()
                                setFrameSelected((s) => !s)
                                setSelectedEl(null)
                            }}
                        >
                            {frameName}
                        </span>
                        <button
                            ref={versionBtnRef}
                            className={"cvd-vbtn" + (panelOpen ? " open" : "")}
                            aria-expanded={panelOpen}
                            aria-label="Toggle version history"
                            onClick={(e) => {
                                e.stopPropagation()
                                setPanelOpen((o) => !o)
                            }}
                        >
                            <span>{dv.num}</span>
                            <svg
                                width="9"
                                height="9"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M6 9l6 6 6-6" />
                            </svg>
                        </button>
                        {displayIndex !== current && (
                            <span className="cvd-chip">Preview</span>
                        )}
                    </div>

                    <div
                        ref={frameRef}
                        className="cvd-frame"
                        onMouseOver={onFrameMouseOver}
                        onMouseLeave={() => setHoveredEl(null)}
                        onClick={onFrameClick}
                    >
                        <Design k={dv.key} team={team} />
                    </div>
                </div>
            </div>

            <Box r={boxes.hover} />
            <Box r={boxes.frame} handles={frameSelected} />
            <Box r={boxes.elem} handles />

            {panelOpen && (
                <aside
                    ref={panelRef}
                    className="cvd-panel"
                    aria-label="Version history"
                    style={{ left: panelLeft, top: panelTop }}
                >
                    <div className="cvd-cards">
                        <div ref={selBgRef} className="cvd-selbg" />
                        <div ref={listRef} className="cvd-list">
                            {versions
                                .map((v, i) => ({ v, i }))
                                .reverse()
                                .map(({ v, i }) => {
                                    const ed = editorInfo(v)
                                    const isSel = i === selected
                                    const isCur = i === current
                                    return (
                                        <div
                                            key={v.num}
                                            className={
                                                "cvd-vcard" +
                                                (isSel ? " selected" : "") +
                                                (isCur ? " is-current" : "")
                                            }
                                            role="button"
                                            aria-label={
                                                "Select " +
                                                longNum(v.num) +
                                                ", " +
                                                relTime(v.at)
                                            }
                                            onClick={(e) => {
                                                const t =
                                                    e.target as HTMLElement
                                                if (
                                                    t.closest(".cvd-restore") ||
                                                    t.closest(".cvd-compare")
                                                )
                                                    return
                                                setSelected(i)
                                            }}
                                        >
                                            <div className="cvd-row1">
                                                <span className="cvd-vnum">
                                                    {v.num}
                                                </span>
                                                <span className="cvd-stamp">
                                                    {shortTime(v.at)}
                                                </span>
                                                {isCur && (
                                                    <span className="cvd-cur">
                                                        Current
                                                    </span>
                                                )}
                                            </div>
                                            <div className="cvd-editor">
                                                {ed.photo ? (
                                                    <span
                                                        className="cvd-av"
                                                        style={{
                                                            backgroundImage: `url(${ed.photo})`,
                                                        }}
                                                    />
                                                ) : (
                                                    <span
                                                        className="cvd-av"
                                                        style={{
                                                            background:
                                                                ed.color,
                                                        }}
                                                    >
                                                        {initials(ed.name)}
                                                    </span>
                                                )}
                                                <span className="cvd-ename">
                                                    {ed.name}
                                                </span>
                                            </div>
                                            {v.restoredFrom && (
                                                <div className="cvd-origin">
                                                    <svg
                                                        width="10"
                                                        height="10"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2.4"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    >
                                                        <path d="M3 12a9 9 0 1 0 3-6.7" />
                                                        <path d="M3 4v5h5" />
                                                    </svg>
                                                    Restored from{" "}
                                                    {longNum(v.restoredFrom)}
                                                </div>
                                            )}
                                            <div className="cvd-note">
                                                {v.note}
                                            </div>
                                            {isSel &&
                                                (i > 0 || i !== current) && (
                                                    <div className="cvd-actions">
                                                        {i > 0 && (
                                                            <button
                                                                className={
                                                                    "cvd-compare" +
                                                                    (comparing
                                                                        ? " held"
                                                                        : "")
                                                                }
                                                                aria-label="Hold to compare with previous version"
                                                                onPointerDown={(
                                                                    e
                                                                ) => {
                                                                    e.preventDefault()
                                                                    e.stopPropagation()
                                                                    setComparing(
                                                                        true
                                                                    )
                                                                }}
                                                            >
                                                                <svg viewBox="0 0 24 24">
                                                                    <path
                                                                        className="hl"
                                                                        d="M12,3 A9,9 0 0,0 12,21 Z"
                                                                    />
                                                                    <path
                                                                        className="hr"
                                                                        d="M12,3 A9,9 0 0,1 12,21 Z"
                                                                    />
                                                                </svg>
                                                            </button>
                                                        )}
                                                        {i !== current && (
                                                            <button
                                                                className="cvd-restore"
                                                                onClick={
                                                                    restore
                                                                }
                                                            >
                                                                Restore
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                        </div>
                                    )
                                })}
                        </div>
                    </div>
                </aside>
            )}

            <div className={"cvd-toast" + (toast ? " show" : "")} role="status">
                {toast?.msg}
            </div>
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* Framer property controls                                            */
/* ------------------------------------------------------------------ */

addPropertyControls(CanvasVersionDiff, {
    frameName: {
        type: ControlType.String,
        title: "Frame name",
        defaultValue: "Onboarding card",
    },
    background: {
        type: ControlType.Color,
        title: "Canvas",
        defaultValue: "#ffffff",
    },
    borderColor: {
        type: ControlType.Color,
        title: "Border",
        defaultValue: "#e5e5e5",
    },
    borderWidth: {
        type: ControlType.Number,
        title: "Border width",
        defaultValue: 1,
        min: 0,
        max: 24,
        step: 1,
        unit: "px",
        displayStepper: true,
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 16,
        min: 0,
        max: 96,
        step: 1,
        unit: "px",
    },
    accent: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#1d6fe0",
    },
    accentSoft: {
        type: ControlType.Color,
        title: "Accent soft",
        defaultValue: "#e6eefc",
    },
    selectColor: {
        type: ControlType.Color,
        title: "Selection",
        defaultValue: "#008FF0",
    },
    selectHover: {
        type: ControlType.Color,
        title: "Selection hover",
        defaultValue: "#86B7F4",
    },
    editorOneName: {
        type: ControlType.String,
        title: "Editor 1 name",
        defaultValue: "Maya Chen",
    },
    editorOnePhoto: {
        type: ControlType.Image,
        title: "Editor 1 photo",
        description: "Leave empty to use the built-in photo.",
    },
    editorTwoName: {
        type: ControlType.String,
        title: "Editor 2 name",
        defaultValue: "Jordan Lee",
    },
    editorTwoPhoto: {
        type: ControlType.Image,
        title: "Editor 2 photo",
        description: "Leave empty to use the built-in photo.",
    },
    team1: { type: ControlType.Image, title: "Team photo 1" },
    team2: { type: ControlType.Image, title: "Team photo 2" },
    team3: { type: ControlType.Image, title: "Team photo 3" },
})
