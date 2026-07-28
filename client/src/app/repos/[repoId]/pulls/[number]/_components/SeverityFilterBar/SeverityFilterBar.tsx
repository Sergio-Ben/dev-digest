/* SeverityFilterBar — "3 CRITICAL · 5 WARNING · 2 SUGGESTION" counters for the
   whole PR, rendered as single-select filter chips. Clicking a level shows only
   that level's findings; clicking the active chip again clears the filter. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { SEVERITY_CHIPS } from "@/lib/severity";
import { s } from "./styles";

export function SeverityFilterBar({
  counts,
  active,
  onChange,
}: {
  counts: Record<Severity, number>;
  /** null = no filter, every finding is shown. */
  active: Severity | null;
  onChange: (s: Severity | null) => void;
}) {
  const t = useTranslations("prReview");
  // Only levels that actually occur get a chip — a chip that filters to an
  // empty list is a dead end.
  const shown = SEVERITY_CHIPS.filter((sev) => counts[sev] > 0);
  if (shown.length === 0) return null;

  return (
    <div style={s.row} role="group" aria-label={t("severityFilter.ariaLabel")}>
      {shown.map((sev) => (
        <Chip
          key={sev}
          // SEV is the single source of severity icon/colour (@devdigest/ui
          // tokens) — Chip needs the raw icon + colour, SeverityBadge can't be
          // nested here because it has no click/active state.
          icon={SEV[sev].icon}
          color={SEV[sev].c}
          active={active === sev}
          onClick={() => onChange(active === sev ? null : sev)}
        >
          {t(`severityFilter.${sev}`, { count: counts[sev] })}
        </Chip>
      ))}
    </div>
  );
}

export default SeverityFilterBar;
