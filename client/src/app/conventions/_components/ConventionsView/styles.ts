import type { CSSProperties } from "react";

export const s = {
  page: { padding: "24px 32px", maxWidth: 960, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
  } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700 } satisfies CSSProperties,
  repoName: { color: "var(--accent)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 6,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  actionBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    marginBottom: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  count: { flex: 1, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
