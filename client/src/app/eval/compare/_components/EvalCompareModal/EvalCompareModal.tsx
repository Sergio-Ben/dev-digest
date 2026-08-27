/* EvalCompareModal — Capability F compare view, reconciled to the approved
   "Compare runs · v6 → v7" MODAL design. Renders inside the shared
   `Modal` primitive (`@devdigest/ui`, dialog role + backdrop already wired
   there) instead of a standalone route — the caller (a per-agent detail
   page's Recent Runs table) picks the two batches and passes their ids in;
   this component only fetches + renders the comparison.

   Shows metric deltas older→newer (AC-32), a system-prompt diff (AC-33), a
   "prompt diff unavailable" note + disabled Promote when a snapshot is
   missing (AC-34), and a trace-count-mismatch notice (AC-35). Promote vN
   targets the NEWER batch's `agent_version`, behind an i18n `window.confirm`
   (native, so it's keyboard-operable for free), and is non-destructive
   (creates a new forward version equal to vN). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState, Badge, Button, Modal, Icon } from "@devdigest/ui";
import type { EvalCompareResult } from "@devdigest/shared";
import { useEvalCompare } from "@/lib/hooks/evals";
import { usePromoteAgentVersion } from "@/lib/hooks/agents";
import { ApiError } from "@/lib/api";
import { costDelta, formatCostParts, formatPercentParts, type DeltaParts } from "./helpers";
import { s } from "./styles";

const FileIcon = Icon.FileText;

export interface EvalCompareModalProps {
  /** Owning agent id. */
  agentId: string;
  /** Either selected batch id — order doesn't matter, the server sorts
   *  them into `older`/`newer` by `ran_at`. */
  batchA: string;
  batchB: string;
  /** Close the modal (also wired to Esc + the backdrop + the header X). */
  onClose: () => void;
}

export function EvalCompareModal({ agentId, batchA, batchB, onClose }: EvalCompareModalProps) {
  const t = useTranslations("eval.compare");
  const compare = useEvalCompare(agentId, batchA, batchB);
  const [promoteSuccess, setPromoteSuccess] = React.useState<number | null>(null);

  // The shared Modal primitive has no built-in keyboard handling — wire Esc
  // here rather than editing `@devdigest/ui` (outside this task's owned
  // paths).
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const result = compare.data;
  const title = result
    ? t("modalTitle", { older: result.older.agent_version, newer: result.newer.agent_version })
    : t("title");
  const subtitle = result ? t("modalSubtitle", { count: result.newer.traces_total }) : undefined;
  const snapshotMissing = result ? result.prompt_diff === null : false;

  return (
    <Modal
      width={680}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("footer.close")}
          </Button>
          {result && (
            <PromoteControl
              newerVersion={result.newer.agent_version}
              agentId={result.newer.agent_id}
              disabled={snapshotMissing}
              promoteSuccess={promoteSuccess}
              onPromoted={setPromoteSuccess}
            />
          )}
        </div>
      }
    >
      <CompareBody isLoading={compare.isLoading} isError={compare.isError} result={result} />
    </Modal>
  );
}

function CompareBody({
  isLoading,
  isError,
  result,
}: {
  isLoading: boolean;
  isError: boolean;
  result: EvalCompareResult | undefined;
}) {
  const t = useTranslations("eval.compare");

  if (isLoading) {
    return (
      <div style={s.body}>
        <Skeleton height={180} />
      </div>
    );
  }
  if (isError || !result) {
    return (
      <div style={s.body}>
        <ErrorState title={t("errorTitle")} />
      </div>
    );
  }

  const { older, newer, deltas, prompt_diff, trace_count_notice } = result;
  const cDelta = costDelta(older, newer);
  const snapshotMissing = prompt_diff === null;

  return (
    <div style={s.body}>
      {trace_count_notice && (
        <div style={s.notice} role="status">
          {trace_count_notice}
        </div>
      )}

      {/* The approved design has no visible "Metric deltas" heading above
          the cards — kept for screen-reader structure only (srOnly). */}
      <div style={s.srOnly}>{t("deltasHeading")}</div>
      <div style={s.deltaCardsRow}>
        <DeltaCard
          label={t("deltas.recall")}
          parts={formatPercentParts(older.recall, newer.recall, deltas.recall)}
          accent="var(--accent)"
        />
        <DeltaCard
          label={t("deltas.precision")}
          parts={formatPercentParts(older.precision, newer.precision, deltas.precision)}
          accent="var(--ok)"
        />
        <DeltaCard
          label={t("deltas.citation")}
          parts={formatPercentParts(older.citation_accuracy, newer.citation_accuracy, deltas.citation_accuracy)}
          accent="var(--warn)"
        />
        <DeltaCard
          label={t("deltas.cost")}
          parts={formatCostParts(older.cost_usd, newer.cost_usd, cDelta)}
          accent="var(--text-primary)"
        />
      </div>

      <div style={s.sectionHeading}>
        <FileIcon size={12} aria-hidden="true" />
        {t("promptDiff.title")}
      </div>
      {!snapshotMissing && (
        <div style={s.legend}>
          <span style={s.legendItem}>
            <span style={s.legendSwatch("old")} aria-hidden="true" />
            {t("legend.old", { version: older.agent_version })}
          </span>
          <span style={s.legendItem}>
            <span style={s.legendSwatch("new")} aria-hidden="true" />
            {t("legend.new", { version: newer.agent_version })}
          </span>
        </div>
      )}
      {snapshotMissing ? (
        <p style={s.promoteHint}>{t("promptDiff.unavailable")}</p>
      ) : prompt_diff.added.length === 0 && prompt_diff.removed.length === 0 ? (
        <p style={s.promoteHint}>{t("promptDiff.none")}</p>
      ) : (
        <div style={s.diffBlock}>
          {prompt_diff.removed.map((line, i) => (
            <div key={`rm-${i}`} style={s.diffLineRow}>
              <span style={s.srOnly}>{t("promptDiff.removedLabel")}: </span>
              <span style={s.diffLine("removed")}>{line}</span>
            </div>
          ))}
          {prompt_diff.added.map((line, i) => (
            <div key={`add-${i}`} style={s.diffLineRow}>
              <span style={s.srOnly}>{t("promptDiff.addedLabel")}: </span>
              <span style={s.diffLine("added")}>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeltaCard({ label, parts, accent }: { label: string; parts: DeltaParts; accent: string }) {
  // Composed back into the exact same flat string the old single-span
  // version rendered ("78% → 82% ▲4pt") via plain-text spacing between
  // spans — kept deliberately as inline text flow (not flex) so differently
  // sized/weighted spans still baseline-align like normal text, and so the
  // literal space characters between them aren't dropped as flex whitespace.
  // The sign glyph (▲/▼/–) lives INSIDE the delta chip's text so the
  // meaning survives even without colour (a11y: never colour-only).
  return (
    <div style={s.deltaCard}>
      <div style={s.deltaCardLabel}>{label}</div>
      <div style={s.deltaCardRow}>
        <span style={s.deltaOld}>{parts.oldText}</span>{" "}
        <span style={s.deltaArrow} aria-hidden="true">
          →
        </span>{" "}
        <span style={s.deltaNew(accent)}>{parts.newText}</span>
        {parts.deltaText && (
          <>
            {" "}
            <span style={s.deltaChip(parts.sign)}>{parts.deltaText}</span>
          </>
        )}
      </div>
    </div>
  );
}

function PromoteControl({
  newerVersion,
  agentId,
  disabled,
  promoteSuccess,
  onPromoted,
}: {
  newerVersion: number;
  agentId: string;
  disabled: boolean;
  promoteSuccess: number | null;
  onPromoted: (version: number) => void;
}) {
  const t = useTranslations("eval.compare");
  const promote = usePromoteAgentVersion();

  const handlePromote = () => {
    const confirmed = window.confirm(t("promote.confirmTitle", { version: newerVersion }));
    if (!confirmed) return;
    promote.mutate(
      { id: agentId, version: newerVersion },
      { onSuccess: (agent) => onPromoted(agent.version) },
    );
  };

  return (
    <div style={s.footerRight}>
      {disabled && <span style={s.promoteHint}>{t("promote.disabledHint")}</span>}
      {promote.isError && (
        <Badge color="var(--crit)">
          {promote.error instanceof ApiError ? promote.error.message : t("promote.errorGeneric")}
        </Badge>
      )}
      {promoteSuccess != null && (
        <span style={s.successBanner} role="status">
          {t("promote.success", { version: promoteSuccess })}
        </span>
      )}
      <Button
        kind="primary"
        icon="Play"
        onClick={handlePromote}
        disabled={disabled || promote.isPending}
        loading={promote.isPending}
        aria-label={t("promote.button", { version: newerVersion })}
      >
        {t("promote.button", { version: newerVersion })}
      </Button>
    </div>
  );
}
