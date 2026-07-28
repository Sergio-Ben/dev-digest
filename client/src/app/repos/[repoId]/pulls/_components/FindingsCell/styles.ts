import type { CSSProperties } from "react";

export const s = {
  cell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  count: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12.5,
    color,
    borderBottom: `1px dotted ${color}`,
    lineHeight: 1.4,
  }),
  muted: { color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,
} as const;
