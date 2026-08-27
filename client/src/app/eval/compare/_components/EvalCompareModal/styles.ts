import type { CSSProperties } from "react";

export const s = {
  body: { padding: "20px 24px" } as CSSProperties,
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 6,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    marginBottom: 16,
  } as CSSProperties,
  // Visually-hidden but still in the a11y tree (standard clip technique) —
  // the approved design has no visible "Metric deltas" heading above the
  // delta cards (verified against the screenshot), but the section still
  // needs a heading for screen-reader structure.
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } as CSSProperties,
  sectionHeading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } as CSSProperties,
  deltaCardsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 20,
  } as CSSProperties,
  deltaCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--bg-surface)",
    minWidth: 0,
  } as CSSProperties,
  deltaCardLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } as CSSProperties,
  // The row is plain inline text flow (not flex) on purpose: differently
  // sized/weighted spans (old value, arrow, new value, delta chip) need to
  // baseline-align the way normal text does, and a flex container would
  // collapse the plain-text space characters between them.
  deltaCardRow: { wordBreak: "break-word" } as CSSProperties,
  deltaOld: { fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" } as CSSProperties,
  deltaArrow: { fontSize: 13, color: "var(--text-muted)" } as CSSProperties,
  deltaNew: (accent: string): CSSProperties => ({
    fontSize: 19,
    fontWeight: 700,
    color: accent,
  }),
  deltaChip: (sign: "up" | "down" | "flat"): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color:
      sign === "up" ? "var(--ok)" : sign === "down" ? "var(--crit)" : "var(--text-secondary)",
  }),
  legend: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    marginBottom: 10,
    fontSize: 12,
    color: "var(--text-secondary)",
  } as CSSProperties,
  legendItem: { display: "flex", alignItems: "center", gap: 6 } as CSSProperties,
  // Tinted `-bg` fill + solid-colour border — matches the app's existing
  // severity-badge convention (see `SEV` in vendor/ui/primitives/tokens.ts)
  // and the muted swatch fill sampled from the design (not a solid fill).
  legendSwatch: (kind: "old" | "new"): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 2,
    background: kind === "old" ? "var(--crit-bg)" : "var(--ok-bg)",
    border: `1px solid ${kind === "old" ? "var(--crit)" : "var(--ok)"}`,
    flexShrink: 0,
  }),
  diffBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    maxHeight: 260,
    overflow: "auto",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
  } as CSSProperties,
  diffLineRow: { lineHeight: 1.7 } as CSSProperties,
  // Inline-block so the highlight hugs the line's own text width (as in the
  // design) instead of stretching a full-width background across the block.
  // Text stays bright/neutral — only the background carries the added vs.
  // removed signal, reinforced for a11y by an `srOnly` label sibling (see
  // EvalCompareModal.tsx) since the design itself has no +/- glyph.
  diffLine: (kind: "added" | "removed"): CSSProperties => ({
    display: "inline-block",
    color: "var(--text-primary)",
    background: kind === "added" ? "var(--ok-bg)" : "var(--crit-bg)",
    padding: "1px 6px",
    borderRadius: 4,
    whiteSpace: "pre-wrap",
  }),
  promoteHint: { fontSize: 12, color: "var(--text-muted)" } as CSSProperties,
  successBanner: { fontSize: 12.5, color: "var(--ok)" } as CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
  } as CSSProperties,
  footerRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  } as CSSProperties,
};
