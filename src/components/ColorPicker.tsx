import { useRef, useState, useEffect } from "react";
import { Pipette, X } from "lucide-react";
import { hsvToRgb, rgbToHex, hexToRgb, rgbToHsv } from "../editor/color";

// Ported from reference/color_picker.tsx and made controlled: the editor
// owns the color (`hex`, `alpha`) and hears every change via onChange.
// All styling is inline, palette matched to the editor's sidebar.

export interface ColorPickerProps {
  hex: string;
  alpha: number; // 0–100
  onChange: (hex: string, alpha: number) => void;
}

const SIZE = 260;
const PAD = 16;
const MAP = 56;
const MAP_INSET = 12;
const REST_LEFT = SIZE - MAP - MAP_INSET;
const MIN_SPAN = 4;
const ANIM_MS = 380;
const EASE = "cubic-bezier(0.22,1,0.36,1)";

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpRgb(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}
const rgbCss = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`;

interface Zoom {
  sMin: number;
  sMax: number;
  vMin: number;
  vMax: number;
}
const FULL_ZOOM: Zoom = { sMin: 0, sMax: 100, vMin: 0, vMax: 100 };
const LIGHTS_ZOOM: Zoom = { sMin: 0, sMax: 10, vMin: 67, vMax: 100 };
interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface AnimState {
  phase: "start" | "end";
  oldBg: string;
}
type DragMode = "move" | "nw" | "ne" | "sw" | "se" | null;

// Value display: on a format switch the new value slides in with a quick
// fade — hex (and its #) arrives from the left, rgb arrives from the right,
// so the two formats feel like they pass each other.
function ValueMorph({
  text,
  switchKey,
  direction,
  prefix,
}: {
  text: string;
  switchKey: number;
  direction: "left" | "right";
  prefix?: string;
}) {
  return (
    <span
      key={switchKey}
      className={
        switchKey > 0
          ? direction === "left"
            ? "cp-swap-in-left"
            : "cp-swap-in-right"
          : undefined
      }
      style={{ display: "inline-block", whiteSpace: "pre" }}
    >
      {prefix && (
        <span style={{ color: "var(--text-3)", marginRight: 4 }}>{prefix}</span>
      )}
      {text}
    </span>
  );
}

const CHECKER: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
};

const handleDotStyle: React.CSSProperties = {
  position: "absolute",
  width: 8,
  height: 8,
  background: "#fff",
  border: "1px solid #9a9a9a",
  borderRadius: "50%",
  transform: "translate(-50%, -50%)",
};

const sliderTrackStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  appearance: "none",
  WebkitAppearance: "none",
  background: "transparent",
  cursor: "pointer",
  margin: 0,
};

const SLIDER_THUMB_CSS = `
  .cp-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    border: 2px solid #d1d5db;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    cursor: pointer;
  }
  .cp-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    border: 2px solid #d1d5db;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    cursor: pointer;
  }
  .cp-btn {
    transition: background-color 150ms ease;
  }
  .cp-btn:hover {
    background-color: var(--surface-3) !important;
  }
  .cp-square .cp-tint {
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .cp-square:hover .cp-tint {
    opacity: 1;
  }
  @keyframes cpBgFade {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes cpSwapInLeft {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes cpSwapInRight {
    from { opacity: 0; transform: translateX(10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .cp-swap-in-left { animation: cpSwapInLeft 200ms ease both; }
  .cp-swap-in-right { animation: cpSwapInRight 200ms ease both; }
`;

export default function ColorPicker({
  hex: hexProp,
  alpha,
  onChange,
}: ColorPickerProps) {
  const squareRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const initial = rgbToHsv(...hexToRgb(hexProp));
  const [hue, setHue] = useState(initial[0]);
  const [sat, setSat] = useState(initial[1]);
  const [val, setVal] = useState(initial[2]);
  const [zoom, setZoom] = useState<Zoom>(FULL_ZOOM);
  const [rgb, setRgb] = useState<[number, number, number]>(hexToRgb(hexProp));

  // Report our color upward; alpha is owned entirely by the parent.
  const setAlpha = (a: number) => onChange(rgbToHex(...rgb), a);
  const lastEmitted = useRef(hexProp.toLowerCase());
  useEffect(() => {
    const h = rgbToHex(...rgb);
    if (h !== lastEmitted.current) {
      lastEmitted.current = h;
      onChange(h, alpha);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rgb]);
  // External change (undo, new selection): adopt it without disturbing hue
  // when the incoming color is a gray.
  useEffect(() => {
    const incoming = hexProp.toLowerCase();
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    const [r, g, b] = hexToRgb(incoming);
    const [h, s, v] = rgbToHsv(r, g, b);
    if (s > 0) setHue(h);
    setSat(s);
    setVal(v);
    setRgb([r, g, b]);
  }, [hexProp]);
  const [dragging, setDragging] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selRect, setSelRect] = useState<Rect | null>(null);
  const [anim, setAnim] = useState<AnimState | null>(null);
  const [closing, setClosing] = useState<"start" | "end" | null>(null);
  const [morphing, setMorphing] = useState(0);
  const [inputMode, setInputMode] = useState<"hex" | "rgb">("hex");
  const [inputDraft, setInputDraft] = useState<string | null>(null);
  const [editingText, setEditingText] = useState(false);
  const [modeSwitchKey, setModeSwitchKey] = useState(0);
  const [bgFade, setBgFade] = useState<{ bg: string; key: number } | null>(
    null,
  );
  const selRectRef = useRef<Rect | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startZoom: Zoom;
  }>({
    mode: null,
    startX: 0,
    startY: 0,
    startZoom: FULL_ZOOM,
  });

  const eyedropperSupported =
    typeof window !== "undefined" && "EyeDropper" in window;
  const hex = rgbToHex(...rgb);
  const isZoomed =
    zoom.sMin !== 0 ||
    zoom.sMax !== 100 ||
    zoom.vMin !== 0 ||
    zoom.vMax !== 100;

  const white: [number, number, number] = [255, 255, 255];
  function hueColorOf(h: number) {
    return hsvToRgb(h, 100, 100);
  }
  function computeSquareBg(z: Zoom, h: number) {
    const hc = hueColorOf(h);
    const cA = lerpRgb(white, hc, z.sMin / 100);
    const cB = lerpRgb(white, hc, z.sMax / 100);
    const aTop = clamp(1 - z.vMax / 100, 0, 1);
    const aBottom = clamp(1 - z.vMin / 100, 0, 1);
    return `linear-gradient(to top, rgba(0,0,0,${aBottom}), rgba(0,0,0,${aTop})), linear-gradient(to right, ${rgbCss(cA)}, ${rgbCss(cB)})`;
  }

  function pixelToSV(px: number, py: number) {
    const s = zoom.sMin + (px / SIZE) * (zoom.sMax - zoom.sMin);
    const v = zoom.vMax - (py / SIZE) * (zoom.vMax - zoom.vMin);
    return [clamp(s, 0, 100), clamp(v, 0, 100)];
  }

  function svToPixel(s: number, v: number) {
    const x = ((s - zoom.sMin) / (zoom.sMax - zoom.sMin)) * SIZE;
    const y = (1 - (v - zoom.vMin) / (zoom.vMax - zoom.vMin)) * SIZE;
    return [clamp(x, 0, SIZE), clamp(y, 0, SIZE)];
  }

  function localPos(clientX: number, clientY: number) {
    const rect = squareRef.current!.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left, 0, SIZE),
      y: clamp(clientY - rect.top, 0, SIZE),
    };
  }

  function updateColorFromSquare(clientX: number, clientY: number) {
    const { x, y } = localPos(clientX, clientY);
    const [s, v] = pixelToSV(x, y);
    setSat(s);
    setVal(v);
    setRgb(hsvToRgb(hue, s, v));
  }

  function handleSquareDown(e: React.MouseEvent) {
    e.preventDefault();
    if (e.shiftKey) {
      const { x, y } = localPos(e.clientX, e.clientY);
      const r = { x1: x, y1: y, x2: x, y2: y };
      selRectRef.current = r;
      setSelRect(r);
      setSelecting(true);
    } else {
      setDragging(true);
      updateColorFromSquare(e.clientX, e.clientY);
    }
  }

  useEffect(() => {
    if (!dragging && !selecting) return;
    function onMove(e: MouseEvent) {
      if (dragging) {
        updateColorFromSquare(e.clientX, e.clientY);
      } else if (selecting) {
        const { x, y } = localPos(e.clientX, e.clientY);
        const r = { ...(selRectRef.current as Rect), x2: x, y2: y };
        selRectRef.current = r;
        setSelRect(r);
      }
    }
    function onUp() {
      if (selecting && selRectRef.current) {
        const r = selRectRef.current;
        const x1 = Math.min(r.x1, r.x2),
          x2 = Math.max(r.x1, r.x2);
        const y1 = Math.min(r.y1, r.y2),
          y2 = Math.max(r.y1, r.y2);
        if (x2 - x1 > 8 && y2 - y1 > 8) {
          const [sA, vA] = pixelToSV(x1, y1);
          const [sB, vB] = pixelToSV(x2, y2);
          const newZoom: Zoom = {
            sMin: Math.min(sA, sB),
            sMax: Math.max(sA, sB),
            vMin: Math.min(vA, vB),
            vMax: Math.max(vA, vB),
          };
          applyZoom(newZoom);
        }
      }
      selRectRef.current = null;
      setSelRect(null);
      setDragging(false);
      setSelecting(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, selecting, zoom, hue, isZoomed]);

  useEffect(() => {
    if (morphing === 0) return;
    const t = setTimeout(() => setMorphing(0), ANIM_MS + 50);
    return () => clearTimeout(t);
  }, [morphing]);

  useEffect(() => {
    if (!anim || anim.phase !== "start") return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() =>
        setAnim((a) => (a ? { ...a, phase: "end" } : a)),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [anim]);

  useEffect(() => {
    if (closing !== "start") return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() =>
        setClosing((c) => (c === "start" ? "end" : c)),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [closing]);

  function handleMinimapTransitionEnd(
    e: React.TransitionEvent<HTMLDivElement>,
  ) {
    if (e.propertyName === "transform" && anim && anim.phase === "end") {
      setAnim(null);
    }
  }

  function handleZoomOutTransitionEnd(
    e: React.TransitionEvent<HTMLDivElement>,
  ) {
    if (e.propertyName === "transform" && closing === "end") {
      setZoom(FULL_ZOOM);
      setClosing(null);
    }
  }

  function startDrag(mode: DragMode, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMorphing(0);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startZoom: zoom,
    };
  }

  useEffect(() => {
    function mapPointToSV(clientX: number, clientY: number) {
      const rect = mapRef.current!.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, MAP);
      const y = clamp(clientY - rect.top, 0, MAP);
      return [
        clamp((x / MAP) * 100, 0, 100),
        clamp(100 - (y / MAP) * 100, 0, 100),
      ];
    }
    function onMove(e: MouseEvent) {
      const mode = dragRef.current.mode;
      if (!mode) return;
      const start = dragRef.current.startZoom;
      if (mode === "move") {
        const dxPct = ((e.clientX - dragRef.current.startX) / MAP) * 100;
        const dyPct = -((e.clientY - dragRef.current.startY) / MAP) * 100;
        const width = start.sMax - start.sMin;
        const height = start.vMax - start.vMin;
        let sMin = start.sMin + dxPct;
        let sMax = sMin + width;
        if (sMin < 0) {
          sMin = 0;
          sMax = width;
        }
        if (sMax > 100) {
          sMax = 100;
          sMin = 100 - width;
        }
        let vMin = start.vMin + dyPct;
        let vMax = vMin + height;
        if (vMin < 0) {
          vMin = 0;
          vMax = height;
        }
        if (vMax > 100) {
          vMax = 100;
          vMin = 100 - height;
        }
        setZoom({ sMin, sMax, vMin, vMax });
      } else {
        const [s, v] = mapPointToSV(e.clientX, e.clientY);
        let { sMin, sMax, vMin, vMax } = start;
        if (mode === "nw") {
          sMin = clamp(s, 0, start.sMax - MIN_SPAN);
          vMax = clamp(v, start.vMin + MIN_SPAN, 100);
        }
        if (mode === "ne") {
          sMax = clamp(s, start.sMin + MIN_SPAN, 100);
          vMax = clamp(v, start.vMin + MIN_SPAN, 100);
        }
        if (mode === "sw") {
          sMin = clamp(s, 0, start.sMax - MIN_SPAN);
          vMin = clamp(v, 0, start.vMax - MIN_SPAN);
        }
        if (mode === "se") {
          sMax = clamp(s, start.sMin + MIN_SPAN, 100);
          vMin = clamp(v, 0, start.vMax - MIN_SPAN);
        }
        setZoom({ sMin, sMax, vMin, vMax });
      }
    }
    function onUp() {
      dragRef.current.mode = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function applyZoom(newZoom: Zoom) {
    if (isZoomed) {
      setBgFade({ bg: computeSquareBg(zoom, hue), key: Date.now() });
      setZoom(newZoom);
      setMorphing((m) => m + 1);
    } else {
      const oldBg = computeSquareBg(zoom, hue);
      setZoom(newZoom);
      setAnim({ phase: "start", oldBg });
    }
  }

  const GRAY_PRESETS: { label: string; zoom: Zoom }[] = [
    { label: "Lights", zoom: LIGHTS_ZOOM },
    { label: "Midtones", zoom: { sMin: 0, sMax: 10, vMin: 33, vMax: 67 } },
    { label: "Shadows", zoom: { sMin: 0, sMax: 10, vMin: 0, vMax: 32 } },
  ];

  function setColorFromRgb(r: number, g: number, b: number) {
    const [h, s, v] = rgbToHsv(r, g, b);
    setHue(h);
    setSat(s);
    setVal(v);
    setRgb([r, g, b]);
  }

  function toggleInputMode() {
    setInputDraft(null);
    setEditingText(false);
    setModeSwitchKey((k) => k + 1);
    setInputMode((m) => (m === "hex" ? "rgb" : "hex"));
  }

  function commitInput() {
    setEditingText(false);
    if (inputDraft === null) return;
    const text = inputDraft.trim();
    setInputDraft(null);
    if (inputMode === "hex") {
      const cleaned = text.replace(/^#/, "");
      if (
        /^[0-9a-fA-F]{3}$/.test(cleaned) ||
        /^[0-9a-fA-F]{6}$/.test(cleaned)
      ) {
        const [r, g, b] = hexToRgb(cleaned);
        setColorFromRgb(r, g, b);
      }
    } else {
      const m = text.match(
        /^\s*(?:rgb\s*\(\s*)?(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?\s*$/i,
      );
      if (m) {
        const r = clamp(parseInt(m[1]), 0, 255);
        const g = clamp(parseInt(m[2]), 0, 255);
        const b = clamp(parseInt(m[3]), 0, 255);
        setColorFromRgb(r, g, b);
      }
    }
  }

  function handleClearCrop() {
    setClosing("start");
  }

  function onHueChange(h: number) {
    setHue(h);
    setRgb(hsvToRgb(h, sat, val));
  }

  async function useEyedropper() {
    if (!eyedropperSupported) return;
    try {
      // @ts-ignore - EyeDropper is not yet in TS lib defs
      const result = await new (window as any).EyeDropper().open();
      const [r, g, b] = hexToRgb(result.sRGBHex);
      const [h, s, v] = rgbToHsv(r, g, b);
      setHue(h);
      setSat(s);
      setVal(v);
      setRgb([r, g, b]);
      setZoom(FULL_ZOOM);
    } catch {
      // cancelled
    }
  }

  const hueColor = hueColorOf(hue);
  const squareBg = computeSquareBg(zoom, hue);
  const mapBg = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${rgbCss(hueColor)})`;
  const [hx, hy] = svToPixel(sat, val);

  const rx = (zoom.sMin / 100) * MAP;
  const ry = ((100 - zoom.vMax) / 100) * MAP;
  const rw = ((zoom.sMax - zoom.sMin) / 100) * MAP;
  const rh = ((zoom.vMax - zoom.vMin) / 100) * MAP;

  const fullBg = computeSquareBg(FULL_ZOOM, hue);
  const cropX = (zoom.sMin / 100) * SIZE;
  const cropY = ((100 - zoom.vMax) / 100) * SIZE;
  const cropW = ((zoom.sMax - zoom.sMin) / 100) * SIZE;
  const cropH = ((zoom.vMax - zoom.vMin) / 100) * SIZE;
  const zoomOutStart = `scale(${SIZE / cropW}, ${SIZE / cropH}) translate(${-cropX}px, ${-cropY}px)`;
  const dotFullX = (sat / 100) * SIZE;
  const dotFullY = (1 - val / 100) * SIZE;

  const transitionAll = `transform ${ANIM_MS}ms ${EASE}, width ${ANIM_MS}ms ${EASE}, height ${ANIM_MS}ms ${EASE}`;
  const fadeInOut = (
    visible: boolean,
    animated: boolean,
  ): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    pointerEvents: anim || closing ? "none" : "auto",
    transition: animated ? `opacity ${ANIM_MS}ms ${EASE}` : "none",
  });

  const overlayVisible = closing
    ? closing === "start"
    : anim
      ? anim.phase === "end"
      : true;
  const overlayAnimated = Boolean(closing || anim);

  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        boxShadow: "0 12px 28px rgba(0,0,0,.14)",
        width: SIZE + PAD * 2,
        padding: PAD,
        boxSizing: "border-box",
        fontFamily: "inherit",
        userSelect: "none",
      }}
    >
      <style>{SLIDER_THUMB_CSS}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            ...CHECKER,
            position: "relative",
            width: 36,
            height: 36,
            borderRadius: 8,
            border: "1px solid var(--line)",
            flexShrink: 0,
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: `rgba(${rgb.join(",")},${alpha / 100})`,
              transition: "background-color 150ms ease",
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            borderRadius: 8,
            border: "1px solid var(--line)",
            padding: "0 4px 0 8px",
            height: 36,
            minWidth: 0,
            boxSizing: "border-box",
          }}
        >
          {editingText ? (
            <>
              {inputMode === "hex" && (
                <span style={{ color: "var(--text-3)", fontSize: 14 }}>#</span>
              )}
              <input
                type="text"
                autoFocus
                spellCheck={false}
                value={
                  inputDraft !== null
                    ? inputDraft
                    : inputMode === "hex"
                      ? hex.replace("#", "").toUpperCase()
                      : rgb.join(", ")
                }
                onChange={(e) => setInputDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={commitInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setInputDraft(null);
                    setEditingText(false);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text)",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              />
            </>
          ) : (
            <div
              onClick={() => setEditingText(true)}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text)",
                cursor: "text",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              <ValueMorph
                switchKey={modeSwitchKey}
                direction={inputMode === "hex" ? "left" : "right"}
                prefix={inputMode === "hex" ? "#" : undefined}
                text={
                  inputMode === "hex"
                    ? hex.replace("#", "").toUpperCase()
                    : rgb.join(", ")
                }
              />
            </div>
          )}
          <button
            type="button"
            className="cp-btn"
            onClick={toggleInputMode}
            data-cursor="pointer"
            title="Switch color format"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: "var(--text-2)",
              background: "var(--surface-2)",
              border: "none",
              borderRadius: 5,
              padding: "4px 6px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {inputMode === "hex" ? "HEX" : "RGB"}
          </button>
        </div>
        <button
          type="button"
          className="cp-btn"
          onClick={useEyedropper}
          disabled={!eyedropperSupported}
          data-cursor={eyedropperSupported ? "pointer" : undefined}
          title={
            eyedropperSupported
              ? "Pick from screen"
              : "Not supported in this browser"
          }
          style={{
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            border: "1px solid var(--line)",
            color: "var(--text)",
            background: "var(--surface)",
            cursor: eyedropperSupported ? "pointer" : "default",
            opacity: eyedropperSupported ? 1 : 0.4,
            flexShrink: 0,
            padding: 0,
          }}
        >
          <Pipette size={16} />
        </button>
      </div>

      <div
        ref={squareRef}
        onMouseDown={handleSquareDown}
        data-cursor="picker-pick"
        className="cp-square"
        style={{
          position: "relative",
          borderRadius: 6,
          cursor: "crosshair",
          width: "100%",
          height: SIZE,
          background: squareBg,
          overflow: "hidden",
        }}
      >
        {bgFade && (
          <div
            key={bgFade.key}
            onAnimationEnd={() => setBgFade(null)}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: bgFade.bg,
              animation: "cpBgFade 100ms ease forwards",
              zIndex: 5,
            }}
          />
        )}
        <div
          className="cp-tint"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "rgba(0,0,0,0.025)",
            zIndex: 6,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "2px solid #fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            pointerEvents: "none",
            transform: "translate(-50%, -50%)",
            left: closing === "end" ? dotFullX : hx,
            top: closing === "end" ? dotFullY : hy,
            background: hex,
            zIndex: 30,
            transition: closing
              ? `left ${ANIM_MS}ms ${EASE}, top ${ANIM_MS}ms ${EASE}, background-color 150ms ease`
              : "background-color 150ms ease",
            boxSizing: "border-box",
          }}
        />

        {closing && (
          <div
            onTransitionEnd={handleZoomOutTransitionEnd}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: fullBg,
              transformOrigin: "0 0",
              transform: closing === "start" ? zoomOutStart : "none",
              transition:
                closing === "start" ? "none" : `transform ${ANIM_MS}ms ${EASE}`,
              zIndex: 10,
            }}
          />
        )}

        {selecting && selRect && (
          <div
            style={{
              position: "absolute",
              pointerEvents: "none",
              border: "1px solid #fff",
              left: Math.min(selRect.x1, selRect.x2),
              top: Math.min(selRect.y1, selRect.y2),
              width: Math.abs(selRect.x2 - selRect.x1),
              height: Math.abs(selRect.y2 - selRect.y1),
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
              boxSizing: "border-box",
            }}
          />
        )}

        {(isZoomed || anim || closing) && (
          <div
            ref={mapRef}
            onTransitionEnd={handleMinimapTransitionEnd}
            style={
              anim
                ? {
                    position: "absolute",
                    borderRadius: 4,
                    left: 0,
                    top: 0,
                    transform:
                      anim.phase === "start"
                        ? "translate(0px, 0px)"
                        : `translate(${REST_LEFT}px, ${MAP_INSET}px)`,
                    width: anim.phase === "start" ? SIZE : MAP,
                    height: anim.phase === "start" ? SIZE : MAP,
                    background: anim.oldBg,
                    boxShadow:
                      anim.phase === "start"
                        ? "none"
                        : "0 2px 6px rgba(0,0,0,0.2)",
                    transition:
                      transitionAll + `, box-shadow ${ANIM_MS}ms ${EASE}`,
                    overflow: "visible",
                    zIndex: 20,
                  }
                : closing
                  ? {
                      position: "absolute",
                      borderRadius: 4,
                      left: 0,
                      top: 0,
                      transform: `translate(${REST_LEFT}px, ${MAP_INSET}px)`,
                      width: MAP,
                      height: MAP,
                      background: mapBg,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                      opacity: closing === "start" ? 1 : 0,
                      transition:
                        closing === "start"
                          ? "none"
                          : `opacity ${ANIM_MS}ms ${EASE}`,
                      overflow: "visible",
                      zIndex: 20,
                    }
                  : {
                      position: "absolute",
                      borderRadius: 4,
                      left: 0,
                      top: 0,
                      transform: `translate(${REST_LEFT}px, ${MAP_INSET}px)`,
                      width: MAP,
                      height: MAP,
                      background: mapBg,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                      transition: "none",
                      overflow: "visible",
                      zIndex: 20,
                    }
            }
          >
            <div
              onMouseDown={(e) => {
                if (!anim && !closing) startDrag("move", e);
              }}
              data-cursor="picker-move"
              style={{
                position: "absolute",
                border: "1px solid #fff",
                cursor: "move",
                left: rx,
                top: ry,
                width: rw,
                height: rh,
                background: "rgba(255,255,255,0.1)",
                boxSizing: "border-box",
                ...fadeInOut(overlayVisible, overlayAnimated),
                ...(morphing > 0 && !anim && !closing
                  ? {
                      transition: `left ${ANIM_MS}ms ${EASE}, top ${ANIM_MS}ms ${EASE}, width ${ANIM_MS}ms ${EASE}, height ${ANIM_MS}ms ${EASE}`,
                    }
                  : {}),
              }}
            >
              <div
                data-cursor="picker-resize-nwse"
                style={{
                  ...handleDotStyle,
                  left: 0,
                  top: 0,
                  cursor: "nwse-resize",
                }}
                onMouseDown={(e) => {
                  if (!anim && !closing) startDrag("nw", e);
                }}
              />
              <div
                data-cursor="picker-resize-nesw"
                style={{
                  ...handleDotStyle,
                  left: "100%",
                  top: 0,
                  cursor: "nesw-resize",
                }}
                onMouseDown={(e) => {
                  if (!anim && !closing) startDrag("ne", e);
                }}
              />
              <div
                data-cursor="picker-resize-nesw"
                style={{
                  ...handleDotStyle,
                  left: 0,
                  top: "100%",
                  cursor: "nesw-resize",
                }}
                onMouseDown={(e) => {
                  if (!anim && !closing) startDrag("sw", e);
                }}
              />
              <div
                data-cursor="picker-resize-nwse"
                style={{
                  ...handleDotStyle,
                  left: "100%",
                  top: "100%",
                  cursor: "nwse-resize",
                }}
                onMouseDown={(e) => {
                  if (!anim && !closing) startDrag("se", e);
                }}
              />
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleClearCrop}
              data-cursor="pointer"
              title="Clear crop"
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "var(--surface)",
                color: "var(--text)",
                border: "none",
                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
                ...fadeInOut(overlayVisible, overlayAnimated),
              }}
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        {GRAY_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="cp-btn"
            onClick={() => applyZoom(p.zoom)}
            data-cursor="pointer"
            style={{
              flex: 1,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text)",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "5px 0",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ position: "relative", height: 12, marginTop: 12 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 9999,
            background:
              "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          }}
        />
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={hue}
          onChange={(e) => onHueChange(parseInt(e.target.value))}
          className="cp-slider"
          style={sliderTrackStyle}
        />
      </div>

      <div style={{ position: "relative", height: 12, marginTop: 12 }}>
        <div
          style={{
            ...CHECKER,
            position: "absolute",
            inset: 0,
            borderRadius: 9999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 9999,
              background: `linear-gradient(to right, rgba(${rgb.join(",")},0), rgba(${rgb.join(",")},1))`,
            }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={alpha}
          onChange={(e) => setAlpha(parseInt(e.target.value))}
          className="cp-slider"
          style={sliderTrackStyle}
        />
      </div>
    </div>
  );
}
