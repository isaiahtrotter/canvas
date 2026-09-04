// Color math shared by the engine and the color picker.

export type RGB = [number, number, number]

export function hsvToRgb(h: number, s: number, v: number): RGB {
    s /= 100
    v /= 100
    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c
    let r = 0,
        g = 0,
        b = 0
    if (h < 60) [r, g, b] = [c, x, 0]
    else if (h < 120) [r, g, b] = [x, c, 0]
    else if (h < 180) [r, g, b] = [0, c, x]
    else if (h < 240) [r, g, b] = [0, x, c]
    else if (h < 300) [r, g, b] = [x, 0, c]
    else [r, g, b] = [c, 0, x]
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ]
}

export function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
}

export function hexToRgb(hex: string): RGB {
    hex = hex.replace("#", "")
    if (hex.length === 3)
        hex = hex
            .split("")
            .map((c) => c + c)
            .join("")
    const n = parseInt(hex, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b)
    const d = max - min
    let h = 0
    if (d !== 0) {
        switch (max) {
            case r:
                h = 60 * (((g - b) / d) % 6)
                break
            case g:
                h = 60 * ((b - r) / d + 2)
                break
            default:
                h = 60 * ((r - g) / d + 4)
        }
    }
    if (h < 0) h += 360
    const v = max
    const s = max === 0 ? 0 : d / max
    return [Math.round(h), Math.round(s * 100), Math.round(v * 100)]
}

export function isHex(s: string) {
    return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)
}

/** CSS rgba() string for a hex fill at an alpha percentage (0–100). */
export function rgbaCss(hex: string, alpha: number) {
    const [r, g, b] = hexToRgb(hex)
    return `rgba(${r},${g},${b},${alpha / 100})`
}
