// Relative + absolute time formatting for frame timestamps.

const MIN = 60000
const HOUR = 3600000
const DAY = 86400000

export function relTime(t: number) {
    const diff = Date.now() - t
    if (diff < MIN) return "now"
    if (diff < HOUR) return Math.floor(diff / MIN) + "m ago"
    if (diff < DAY) return Math.floor(diff / HOUR) + "h ago"
    return Math.floor(diff / DAY) + "d ago"
}

export function absTime(t: number) {
    return new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    })
}
