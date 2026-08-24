/* DocumentRow — one selectable item in the Project Context file list (left
   pane). Shows a file icon, filename, folder path (to disambiguate the many
   same-named files such as README.md), and a bucket badge (top-level folder,
   colour + text label for WCAG AA). Clicking selects the document. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Bucket badge
// ---------------------------------------------------------------------------

/** Per-bucket visual tokens. Colour + text label = WCAG 2.1 AA (not colour
 *  alone). The bucket is the document's top-level folder, so it is free-form:
 *  known folders get bespoke colours, anything else falls back to neutral. */
const BUCKET_META: Record<string, { color: string; bg: string }> = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--ok)", bg: "color-mix(in srgb, var(--ok) 12%, transparent)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

const BUCKET_META_FALLBACK = {
  color: "var(--text-secondary)",
  bg: "var(--bg-surface)",
};

function BucketBadge({ bucket }: { bucket: string }) {
  const meta = BUCKET_META[bucket] ?? BUCKET_META_FALLBACK;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: meta.color,
        background: meta.bg,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {bucket}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split "client/src/vendor/ui/README.md" → { filename, folder }. */
function splitPath(path: string): { filename: string; folder: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { filename: path, folder: "" };
  return {
    filename: path.slice(idx + 1),
    folder: path.slice(0, idx + 1),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentRow({
  doc,
  selected,
  onSelect,
}: {
  doc: DiscoveredDocument;
  selected: boolean;
  onSelect: () => void;
}) {
  const { filename, folder } = splitPath(doc.path);

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{ ...s.row, ...(selected ? s.rowSelected : null) }}
    >
      <Icon.FileText
        size={15}
        style={{ color: selected ? "var(--accent)" : "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={s.filename}>{filename}</span>
        {folder && <span style={s.folder}>{folder}</span>}
      </span>
      <BucketBadge bucket={doc.bucket} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    width: "100%",
    padding: "8px 12px",
    // Use the `border` shorthand in BOTH states (never mix with `borderColor`),
    // otherwise React cannot clear the border when selection moves and a stale
    // outline is left on previously-selected tiles.
    border: "1px solid transparent",
    borderRadius: 6,
    background: "transparent",
    outline: "none",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background .1s, border-color .1s",
  } satisfies React.CSSProperties,

  rowSelected: {
    background: "var(--bg-hover)",
    border: "1px solid var(--border-strong)",
  } satisfies React.CSSProperties,

  filename: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies React.CSSProperties,

  folder: {
    display: "block",
    fontSize: 10,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    marginTop: 2,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies React.CSSProperties,
};
