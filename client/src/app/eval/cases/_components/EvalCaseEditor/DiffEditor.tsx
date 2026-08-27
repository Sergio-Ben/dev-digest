"use client";

import { useRef } from "react";
import { parseDiffLines, type DiffLineKind } from "./helpers";

const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const PAD_V = 10;
const PAD_H = 12;
const ROWS = 12;
const HEIGHT = ROWS * LINE_HEIGHT + PAD_V * 2;

const OVERLAP_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  margin: 0,
  padding: `${PAD_V}px ${PAD_H}px`,
  fontSize: FONT_SIZE,
  lineHeight: `${LINE_HEIGHT}px`,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  border: "none",
  boxSizing: "border-box",
};

function styleFor(kind: DiffLineKind): React.CSSProperties {
  switch (kind) {
    case "hunk":
      return { color: "var(--accent-text)" };
    case "fileHeader":
      return { color: "var(--text-primary)", fontWeight: 600 };
    case "add":
      return { background: "var(--code-add)", color: "var(--text-primary)" };
    case "del":
      return { background: "var(--code-del)", color: "var(--text-primary)" };
    default:
      return { color: "var(--text-muted)" };
  }
}

function signColorFor(kind: DiffLineKind): string | undefined {
  if (kind === "add") return "var(--code-add-text)";
  if (kind === "del") return "var(--code-del-text)";
  return undefined;
}

/**
 * Colorized diff textarea (design fidelity — the "+" added line gets a
 * green row background, the "@@" hunk header gets the accent color, context
 * lines are muted). Implemented as the standard "highlighted textarea"
 * technique: a real, visually-transparent `<textarea>` stays the single
 * source of truth and the only interactive/scrollable element; a `<pre>`-like
 * overlay underneath renders the colored text and mirrors the textarea's
 * scroll position on every `onScroll` event so the coloring tracks typing
 * and scrolling. The overlay is `aria-hidden` + `pointerEvents: none` — the
 * textarea alone carries the accessible text content.
 */
export function DiffEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const lines = parseDiffLines(value);

  function syncScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (!overlayRef.current) return;
    overlayRef.current.scrollTop = e.currentTarget.scrollTop;
    overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  return (
    <div
      style={{
        position: "relative",
        height: HEIGHT,
        borderRadius: 7,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="mono"
        style={{ ...OVERLAP_STYLE, overflow: "hidden", pointerEvents: "none" }}
      >
        {lines.map((line, i) => (
          <div key={i} style={styleFor(line.kind)}>
            {line.kind === "add" || line.kind === "del" ? (
              <>
                <span style={{ color: signColorFor(line.kind) }}>{line.text.slice(0, 1)}</span>
                {line.text.slice(1) || " "}
              </>
            ) : (
              line.text || " "
            )}
          </div>
        ))}
      </div>
      <textarea
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          ...OVERLAP_STYLE,
          width: "100%",
          height: "100%",
          resize: "none",
          overflow: "auto",
          outline: "none",
          background: "transparent",
          color: "transparent",
          caretColor: "var(--text-primary)",
        }}
      />
    </div>
  );
}
