import type { CSSProperties } from "react";

/** Co-located styles for the Smart Diff viewer. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: { display: "flex", alignItems: "center", gap: 8, padding: "0 2px" } satisfies CSSProperties,
  roleSquare: { width: 9, height: 9, borderRadius: 2, flexShrink: 0 } satisfies CSSProperties,
  roleLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  roleDescription: { fontSize: 12, color: "var(--text-muted)", flex: 1, minWidth: 0 } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  findingsBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "none",
    borderRadius: 999,
    padding: "2px 9px",
    cursor: "pointer",
  } satisfies CSSProperties,
  splitCallout: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  splitTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 } satisfies CSSProperties,
  splitList: { margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
} as const;
