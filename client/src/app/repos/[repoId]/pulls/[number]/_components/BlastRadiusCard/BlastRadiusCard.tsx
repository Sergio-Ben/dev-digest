"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { BlastRadiusResult } from "@devdigest/shared";
import { SummaryBar } from "./SummaryBar";
import { SymbolList } from "./SymbolList";
import { PriorPrsAccordion } from "./PriorPrsAccordion";
import { BlastGraphPanel } from "./BlastGraphPanel";
import { BlastGraphLegend } from "./BlastGraphLegend";
import { BlastGraphLightbox } from "./BlastGraphLightbox";
import {
  buildCronSet,
  buildSymbolRows,
  distinctSymbolNames,
  type BlastView,
} from "./helpers";

interface BlastRadiusCardProps {
  blastRadius: BlastRadiusResult | undefined;
  isLoading: boolean;
  /** The request itself failed. Distinct from "the index had no answer" — see
   *  the error branch below. */
  isError?: boolean;
  changedPaths: Set<string>;
  repoFullName: string | null;
  headSha: string | null | undefined;
  onOpenFileLine: (file: string, line: number) => void;
}

/** Shared shell so loading / empty / loaded states are the same box.
 *  The height is DEFINITE on purpose: a repo can blast 100+ symbols, and
 *  `flex-1` inside the stretched Overview grid would let the tree push the card
 *  (and the row) to that full height instead of scrolling inside it. */
function CardShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex flex-col h-[400px] box-border overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

export function BlastRadiusCard({
  blastRadius,
  isLoading,
  isError = false,
  changedPaths,
  repoFullName,
  headSha,
  onOpenFileLine,
}: BlastRadiusCardProps) {
  const t = useTranslations("prReview.blastRadius");
  const [view, setView] = useState<BlastView>("tree");
  const [graphOpen, setGraphOpen] = useState(false);
  // Owned HERE, not in SymbolList: the Tree/Graph toggle unmounts SymbolList,
  // so state held down there is destroyed and the tree springs back to the
  // first symbol every time the user looks at the graph.
  // `undefined` = untouched (open the first symbol); `null` = deliberately
  // collapsed. Collapsing everything must not read as "use the default".
  const [openSymbol, setOpenSymbol] = useState<string | null | undefined>(
    undefined,
  );

  const header = <SectionLabel icon="Workflow">{t("title")}</SectionLabel>;

  if (isLoading) {
    return (
      <CardShell>
        {header}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-[var(--text-muted)]">
            {t("loadingTitle")}
          </span>
        </div>
      </CardShell>
    );
  }

  // A failed request is NOT an empty result. `useBlastRadius` doesn't
  // `throwOnError`, so the ErrorBoundary upstream never sees this — without its
  // own branch the card would fall through to the empty state below and report
  // "nothing to trace" for what is actually an unanswered question.
  if (isError) {
    return (
      <CardShell>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-2xl">⚠️</span>
          <span className="text-sm text-[var(--crit)] text-center">
            {t("error")}
          </span>
        </div>
      </CardShell>
    );
  }

  // Nothing to draw: the index knows of no symbol in the changed files (or the
  // response was empty). That gets an honest empty state rather than an empty
  // tree that reads as "no impact".
  if (!blastRadius || blastRadius.changedSymbols.length === 0) {
    return (
      <CardShell>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-2xl">📡</span>
          <span className="text-sm text-[var(--text-muted)] text-center">
            {t("emptyTitle")}
          </span>
          <span className="text-xs text-[var(--text-muted)] text-center max-w-[220px]">
            {blastRadius?.degraded ? t("emptyBodyUnindexed") : t("emptyBody")}
          </span>
        </div>
      </CardShell>
    );
  }

  const cronSet = buildCronSet(blastRadius.factsByFile);
  // Only symbols something calls; `hiddenCount` is what the filter removed, and
  // is reported below so the list can't be mistaken for the full change set.
  // Both counts are over DISTINCT NAMES — rows are deduped by name, so measuring
  // against raw `changedSymbols.length` would report a same-named twin as
  // "hidden, no callers" when its callers are in fact on screen.
  const symbolRows = buildSymbolRows(blastRadius);
  const distinctSymbols = distinctSymbolNames(blastRadius);
  const hiddenCount = distinctSymbols - symbolRows.length;

  // Fall back to the first symbol when the selection was never made, or when a
  // refetch dropped the symbol that was open (stale name → nothing expanded).
  const activeSymbol =
    openSymbol === undefined ||
    (openSymbol !== null && !symbolRows.some((r) => r.name === openSymbol))
      ? (symbolRows[0]?.name ?? null)
      : openSymbol;

  return (
    <CardShell className="gap-3">
      {header}

      <SummaryBar
        symbolCount={blastRadius.changedSymbols.length}
        callerCount={blastRadius.callers.length}
        endpointCount={blastRadius.impactedEndpoints.length}
        cronCount={cronSet.size}
        degraded={blastRadius.degraded ?? false}
        reason={blastRadius.reason}
        view={view}
        onViewChange={setView}
      />

      {blastRadius.summary && (
        <p className="m-0 text-xs text-[var(--text-secondary)] leading-relaxed">
          {blastRadius.summary}
        </p>
      )}

      <div
        className={`flex-1 min-h-0 ${view === "tree" ? "overflow-y-auto" : "overflow-hidden"}`}
      >
        {symbolRows.length === 0 ? (
          // Every changed symbol was filtered out. Both views would draw an
          // empty box, so say the thing that is actually true instead.
          <div className="h-full flex items-center justify-center px-4">
            <span className="text-xs text-[var(--text-muted)] text-center">
              {t("allNoCallers", { count: distinctSymbols })}
            </span>
          </div>
        ) : view === "tree" ? (
          <SymbolList
            rows={symbolRows}
            openSymbol={activeSymbol}
            onToggleSymbol={(name) =>
              setOpenSymbol(activeSymbol === name ? null : name)
            }
            changedPaths={changedPaths}
            repoFullName={repoFullName}
            headSha={headSha}
            onOpenFileLine={onOpenFileLine}
          />
        ) : (
          <BlastGraphPanel
            data={blastRadius}
            onExpand={() => setGraphOpen(true)}
          />
        )}
      </div>

      {view === "graph" && <BlastGraphLegend />}

      {hiddenCount > 0 && symbolRows.length > 0 && (
        <p className="m-0 text-[11px] text-[var(--text-muted)] italic">
          {t("hiddenNoCallers", { count: hiddenCount })}
        </p>
      )}

      <PriorPrsAccordion priorPrs={blastRadius.priorPrs ?? []} />

      {graphOpen && (
        <BlastGraphLightbox
          data={blastRadius}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </CardShell>
  );
}
