interface FontDropdownProps {
    /** Font names to list. */
    options: string[]
    /** The selection's shared font, or "__mixed" for a mixed selection — nothing is highlighted then. */
    value: string
    onSelect: (font: string) => void
}

/**
 * Floating font list, opened beside the sidebar the same way the color
 * picker is (see Editor.tsx). Each option renders in its own typeface, so
 * picking a font is a preview of it, not just a label.
 */
export default function FontDropdown({ options, value, onSelect }: FontDropdownProps) {
    return (
        <div
            role="listbox"
            aria-label="Font"
            style={{
                width: 208,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 16px 40px rgba(0,0,0,.2)",
                padding: 6,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                fontFamily: "'Inter', system-ui, sans-serif",
            }}
        >
            {options.map((font) => {
                const active = font === value
                return (
                    <button
                        key={font}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => onSelect(font)}
                        style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            borderRadius: 8,
                            padding: "9px 10px",
                            background: active ? "var(--input-bg-hover)" : "transparent",
                            color: "var(--text)",
                            fontFamily: font,
                            fontSize: 13,
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                            if (!active) e.currentTarget.style.background = "var(--input-bg)"
                        }}
                        onMouseLeave={(e) => {
                            if (!active) e.currentTarget.style.background = "transparent"
                        }}
                    >
                        {font}
                    </button>
                )
            })}
        </div>
    )
}
