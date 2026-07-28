/* FindingsCell — the PR list's FINDINGS column: one icon+count per severity,
   worst first, with a hover card previewing the findings themselves.

   The counts come from the list endpoint (server-side rollup over every review
   of the PR). The card's finding bodies are NOT in that payload — they are
   fetched lazily from /pulls/:id/reviews on first hover, so a list of 50 PRs
   costs nothing until you point at one. */
"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { PrMeta, Severity } from "@devdigest/shared";
import { FindingsHoverCard, useHoverCard } from "@/components/FindingsHoverCard";
import { usePrReviews } from "@/lib/hooks/reviews";
import { SEVERITY_CHIPS } from "@/lib/severity";
import { s } from "./styles";

/** Wire counts are lowercase (server SeverityCounts); chips are uppercase. */
const COUNT_KEY: Record<Severity, "critical" | "warning" | "suggestion"> = {
  CRITICAL: "critical",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const { anchorRef, pos, hoverProps } = useHoverCard();
  // null prId keeps the query disabled — nothing is fetched until first hover.
  const { data: reviews, isLoading } = usePrReviews(pos ? pr.id ?? null : null);

  const counts = pr.findings ?? null;
  const shown = counts ? SEVERITY_CHIPS.filter((sev) => counts[COUNT_KEY[sev]] > 0) : [];
  if (shown.length === 0) return <span style={s.muted}>—</span>;

  const findings = (reviews ?? []).flatMap((r) => r.findings);

  return (
    <div ref={anchorRef} style={s.cell} {...hoverProps}>
      {shown.map((sev) => (
        <span key={sev} style={s.count(SEV[sev].c)} title={SEV[sev].label}>
          {React.createElement(Icon[SEV[sev].icon], { size: 13 })}
          <span className="tnum">{counts![COUNT_KEY[sev]]}</span>
        </span>
      ))}
      <FindingsHoverCard
        pos={pos}
        findings={findings}
        loading={isLoading}
        hoverProps={hoverProps}
      />
    </div>
  );
}

export default FindingsCell;
