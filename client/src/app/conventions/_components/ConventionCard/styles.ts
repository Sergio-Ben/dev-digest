import type { CSSProperties } from "react";
import type { ConventionStatus } from "@devdigest/shared";

/** Left accent border carries the triage state — green once accepted. */
const accent = (status: ConventionStatus): string =>
  status === "accepted" ? "var(--ok)" : status === "rejected" ? "var(--border)" : "var(--border)";

export const s = {
  card: (status: ConventionStatus): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    borderLeft: "3px solid " + accent(status),
    background: "var(--bg-elevated)",
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  ruleRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  rule: {
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
    cursor: "text",
  } satisfies CSSProperties,
  category: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    padding: "1px 7px",
    borderRadius: 4,
    flexShrink: 0,
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  evidenceLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  snippet: {
    margin: "6px 0 0",
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    fontSize: 12,
    lineHeight: 1.5,
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  confidenceBar: { flex: 1, maxWidth: 180 } satisfies CSSProperties,
  confidenceValue: (color: string): CSSProperties => ({
    fontWeight: 600,
    color,
  }),
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
    width: 128,
  } satisfies CSSProperties,
} as const;
