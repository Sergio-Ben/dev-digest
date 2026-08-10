"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";
import type { BlastRadiusResult } from "@devdigest/shared";
import type { BlastView } from "./helpers";
import { BLAST_VIEWS } from "./helpers";

interface SummaryBarProps {
  symbolCount: number;
  callerCount: number;
  endpointCount: number;
  cronCount: number;
  degraded: boolean;
  reason?: BlastRadiusResult["reason"];
  view: BlastView;
  onViewChange: (view: BlastView) => void;
}

/** One `<icon> <count> <noun>` stat. Count is emphasised, noun stays quiet. */
function Stat({
  icon,
  iconClass,
  count,
  label,
}: {
  icon: IconName;
  iconClass: string;
  count: number;
  label: string;
}) {
  const I = Icon[icon];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <I size={12} className={iconClass} />
      <span className="font-semibold text-[var(--text-primary)]">{count}</span>
      {label}
    </span>
  );
}

export function SummaryBar({
  symbolCount,
  callerCount,
  endpointCount,
  cronCount,
  degraded,
  reason,
  view,
  onViewChange,
}: SummaryBarProps) {
  const t = useTranslations("prReview.blastRadius");

  // Two different stories, so two different badges. `index_partial` means the
  // map below is real but may be missing callers (some files were never
  // indexed) — amber, "incomplete". Anything else degraded means the map
  // couldn't be built from the index at all — red, "don't trust this".
  const partial = degraded && reason === "index_partial";

  return (
    <div className="flex items-center gap-x-3.5 gap-y-2 flex-wrap">
      <Stat
        icon="Code"
        iconClass="text-[var(--text-muted)]"
        count={symbolCount}
        label={t("symbols", { count: symbolCount })}
      />
      <Stat
        icon="CornerDownRight"
        iconClass="text-[var(--text-muted)]"
        count={callerCount}
        label={t("callers", { count: callerCount })}
      />
      <Stat
        icon="Globe"
        iconClass="text-[var(--accent-text)]"
        count={endpointCount}
        label={t("endpoints", { count: endpointCount })}
      />
      {cronCount > 0 && (
        <Stat
          icon="Clock"
          iconClass="text-[var(--warn)]"
          count={cronCount}
          label={t("crons", { count: cronCount })}
        />
      )}
      {partial && (
        <span
          title={t("partialHint")}
          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-semibold uppercase tracking-wide"
        >
          {t("partial")}
        </span>
      )}
      {degraded && !partial && (
        <span
          title={t("degradedHint")}
          className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/15 text-red-400 font-semibold uppercase tracking-wide"
        >
          {t("degraded")}
        </span>
      )}

      <div
        role="group"
        aria-label={t("viewMode")}
        className="ml-auto flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5"
      >
        {BLAST_VIEWS.map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              onClick={() => onViewChange(v)}
              className={`px-2.5 py-0.5 text-[11px] rounded border-none cursor-pointer transition-colors ${
                active
                  ? "bg-[var(--border)] text-[var(--text-primary)] font-semibold"
                  : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
