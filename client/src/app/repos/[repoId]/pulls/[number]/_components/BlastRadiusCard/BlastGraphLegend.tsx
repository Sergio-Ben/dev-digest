"use client";

import React from "react";
import { useTranslations } from "next-intl";

/** Legend for the blast graph. Shared by the inline card and the lightbox so
 *  the two can't describe the same colours differently. Swatches mirror
 *  `BlastGraph`'s FILL/STROKE maps: filled accent = changed symbol, filled grey
 *  = caller, accent ring = endpoint. */
const ITEMS = [
  {
    key: "legendSymbol",
    style: { backgroundColor: "var(--accent-text)" },
  },
  {
    key: "legendCallers",
    style: { backgroundColor: "var(--border-strong)" },
  },
  {
    key: "legendEndpoints",
    style: {
      backgroundColor: "var(--bg-elevated)",
      border: "1.5px solid var(--accent-text)",
    },
  },
] as const;

export function BlastGraphLegend({ className = "" }: { className?: string }) {
  const t = useTranslations("prReview.blastRadius");

  return (
    <div
      className={`flex items-center gap-4 text-[11px] text-[var(--text-muted)] ${className}`}
    >
      {ITEMS.map((item) => (
        <span key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0 box-border"
            style={item.style}
          />
          {t(item.key)}
        </span>
      ))}
    </div>
  );
}
