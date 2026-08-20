"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const rowButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  borderLeft: "3px solid var(--border)",
  padding: "4px 0 4px 12px",
  cursor: "pointer",
  borderRadius: 2,
};

const locationStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--accent-text)",
};

const reasonStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
};

interface ReviewFocusListProps {
  items: ReviewFocusItem[];
  onOpenFileLine: (file: string, line: number) => void;
}

/**
 * AC-36: `review_focus[]` as an ORDERED list, rendered in the array's own
 * order (no sort) so it matches "stored order". AC-37/38: each row is a
 * keyboard-operable `<button>` that calls `onOpenFileLine`, with the file
 * path baked into its accessible name via `aria-label` (not just visible
 * text) so the path survives even if the label element order ever changes.
 * Pure list — the heading + count badge live in the wrapping `ReviewFocusCard`
 * (its own full-width card below the Intent/Blast grid, not nested inside
 * `PrBriefCard`) so it matches the reviewer-facing design.
 */
export function ReviewFocusList({ items, onOpenFileLine }: ReviewFocusListProps) {
  const t = useTranslations("brief");

  if (items.length === 0) return null;

  return (
    <div>
      <ol style={listStyle}>
        {items.map((item, i) => {
          // A row with no line still opens the file — line 1 is a safe
          // fallback, never a dead click target.
          const line = item.line ?? 1;
          const location =
            item.line != null
              ? t("reviewFocus.fileLineLabel", { file: item.file, line: item.line })
              : item.file;
          return (
            <li key={`${item.file}:${item.line ?? "x"}:${i}`}>
              <button
                type="button"
                onClick={() => onOpenFileLine(item.file, line)}
                aria-label={t("reviewFocus.openAriaLabel", { file: item.file })}
                style={rowButtonStyle}
              >
                <span className="mono" style={locationStyle}>
                  {location}
                </span>
                <span style={reasonStyle}>{item.reason}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
