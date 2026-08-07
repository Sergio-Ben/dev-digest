import type { CSSProperties } from "react";

export const s = {
  body: { padding: "20px 22px", maxHeight: "62vh", overflowY: "auto" } satisfies CSSProperties,
  banner: {
    padding: "10px 12px",
    marginBottom: 18,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-hover)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  enabledRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  tokens: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  } satisfies CSSProperties,
} as const;
