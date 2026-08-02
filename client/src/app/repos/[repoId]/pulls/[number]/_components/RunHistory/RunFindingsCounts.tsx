/* RunFindingsCounts — severity counts for ONE timeline run row, with the same
   hover card the PR list uses. Rendered only when that run's findings are known
   (settled runs that produced a review). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsHoverCard, useHoverCard } from "@/components/FindingsHoverCard";
import { SEVERITY_CHIPS, countBySeverity } from "@/lib/severity";

const countStyle = (color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color,
  borderBottom: `1px dotted ${color}`,
  lineHeight: 1.3,
});

export function RunFindingsCounts({ findings }: { findings: FindingRecord[] }) {
  const t = useTranslations("prReview");
  const { anchorRef, pos, hoverProps } = useHoverCard<HTMLSpanElement>();

  const counts = countBySeverity(findings);
  const shown = SEVERITY_CHIPS.filter((sev) => counts[sev] > 0);
  if (shown.length === 0) return null;

  return (
    <span
      ref={anchorRef}
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
      {...hoverProps}
    >
      {shown.map((sev) => (
        <span key={sev} style={countStyle(SEV[sev].c)} title={SEV[sev].label}>
          {React.createElement(Icon[SEV[sev].icon], { size: 12 })}
          <span className="tnum">{counts[sev]}</span>
        </span>
      ))}
      <FindingsHoverCard
        pos={pos}
        findings={findings}
        label={t("findingsCard.inThisRun", { count: findings.length })}
        hoverProps={hoverProps}
      />
    </span>
  );
}

export default RunFindingsCounts;
