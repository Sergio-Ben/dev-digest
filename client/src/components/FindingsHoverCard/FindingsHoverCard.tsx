/* FindingsHoverCard — the findings preview that hangs off the PR list's
   FINDINGS counts and off a timeline run row.

   Its header repeats the severity counts as toggles: clicking a level narrows
   the list below to that level only, clicking it again clears. Position comes
   from `useHoverCard`; the card is portalled to <body> so the row's
   `overflow: hidden` can't clip it. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon, SEV, CategoryTag, MonoLink, ConfidenceNum, type Category } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_CHIPS, bySeverity, countBySeverity } from "@/lib/severity";
import type { CardPos } from "./useHoverCard";
import { s } from "./styles";

/** Line label for a finding: "12" for one line, "45-52" for a range. */
function lineLabel(f: FindingRecord): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

export function FindingsHoverCard({
  pos,
  findings,
  loading,
  label,
  hoverProps,
}: {
  /** null while closed — nothing renders. */
  pos: CardPos | null;
  findings: FindingRecord[];
  loading?: boolean;
  /** Header text, e.g. "6 findings" or "2 findings in this run". */
  label?: string;
  /** Spread from `useHoverCard` so the card keeps itself open while hovered. */
  hoverProps?: { onMouseEnter: () => void; onMouseLeave: () => void };
}) {
  const t = useTranslations("prReview");
  const [severity, setSeverity] = React.useState<Severity | null>(null);

  if (pos == null) return null;

  const counts = countBySeverity(findings);
  const levels = SEVERITY_CHIPS.filter((sev) => counts[sev] > 0);
  const shown = findings
    .filter((f) => !severity || f.severity === severity)
    .slice()
    .sort(bySeverity);

  const card = (
    // Clicks inside would otherwise bubble to the row (React portals propagate
    // along the React tree, not the DOM tree) and navigate away.
    <div style={s.card(pos)} onClick={(e) => e.stopPropagation()} {...hoverProps}>
      <div style={s.head}>
        <span style={s.headLabel}>
          <Icon.AlertOctagon size={13} />
          {label ?? t("findingsCard.count", { count: findings.length })}
        </span>
        {levels.map((sev) => (
          <span
            key={sev}
            role="button"
            aria-pressed={severity === sev}
            title={SEV[sev].label}
            onClick={() => setSeverity((cur) => (cur === sev ? null : sev))}
            style={s.filterBtn(SEV[sev].c, severity === sev)}
          >
            {React.createElement(Icon[SEV[sev].icon], { size: 12 })}
            <span className="tnum">{counts[sev]}</span>
          </span>
        ))}
      </div>

      {loading ? (
        <div style={s.note}>{t("findingsCard.loading")}</div>
      ) : shown.length === 0 ? (
        <div style={s.note}>{t("findingsCard.empty")}</div>
      ) : (
        shown.map((f, i) => {
          const sev = SEV[f.severity as Severity];
          return (
            <div key={f.id} style={i === 0 ? s.itemFirst : s.item}>
              <div style={s.titleRow}>
                {React.createElement(Icon[sev?.icon ?? "Info"], {
                  size: 14,
                  style: { color: sev?.c ?? "var(--text-muted)" },
                })}
                <span style={s.title(sev?.c ?? "var(--text-primary)")}>{f.title}</span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={s.metaRow}>
                <MonoLink>
                  {f.file}:{lineLabel(f)}
                </MonoLink>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div style={s.rationale}>{f.rationale}</div>
            </div>
          );
        })
      )}
    </div>
  );

  return createPortal(card, document.body);
}

export default FindingsHoverCard;
