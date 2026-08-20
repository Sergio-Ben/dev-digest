"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Skeleton, CircularScore } from "@devdigest/ui";
import { parseFileRef, type BriefRisk, type BriefTokens } from "@devdigest/shared";
import { useBrief, useRegenerateBrief } from "@/lib/hooks/brief";
import { RunCostBadge } from "@/components/RunCostBadge";
import { formatTokens } from "../../RunTraceDrawer/helpers";
import { RiskLevelBadge } from "./RiskLevelBadge";

interface PrBriefCardProps {
  prId: string | number | null;
  /** The PR's latest-review score/cost (existing review-verdict data — not
   *  part of the `Brief` schema) — shown alongside the brief at the user's
   *  explicit request, reusing the same `CircularScore`/`RunCostBadge`
   *  components and formatting the PR list already uses. */
  score: number | null;
  costUsd: number | null;
  onOpenFileLine: (file: string, line: number) => void;
}

const scoreColStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
  paddingLeft: 20,
  borderLeft: "1px solid var(--border)",
};

const scoreLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const costRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  marginTop: 4,
};

/**
 * Score/cost/tokens column: the existing per-PR review score + cost (`score`,
 * `costUsd` props — not part of the `Brief` schema), plus the brief's OWN
 * header-only-vs-full-diff token estimate (`tokens`, from `BriefResponse`,
 * already computed for AC-45's log line — reusing it here finally gives US-6's
 * cost-visibility promise a UI home). Each piece renders independently so a
 * PR with no review yet still shows its brief's own token savings.
 */
function ScoreColumn({
  score,
  costUsd,
  tokens,
}: {
  score: number | null;
  costUsd: number | null;
  tokens: BriefTokens | null;
}) {
  const t = useTranslations("brief");
  if (score == null && costUsd == null && tokens == null) return null;

  return (
    <div style={scoreColStyle}>
      {score != null && (
        <>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={scoreLabelStyle}>{t("card.prScore")}</span>
        </>
      )}
      {(costUsd != null || tokens != null) && (
        <div style={costRowStyle}>
          {costUsd != null && <RunCostBadge variant="compact" cost={costUsd} />}
          {tokens != null && (
            <span
              className="mono tnum"
              style={{ fontSize: 11, color: "var(--text-muted)" }}
              title={t("card.tokensSavedLabel")}
            >
              {formatTokens(tokens.full_diff, tokens.header_only)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: "0 0 6px 0",
};

const proseStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  margin: 0,
  lineHeight: 1.6,
};

const riskRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "8px 0",
  borderBottom: "1px solid var(--border)",
};

const riskTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const riskFileRefStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--accent-text)",
  background: "var(--accent-bg)",
  border: "none",
  borderRadius: 4,
  padding: "2px 6px",
  cursor: "pointer",
};

/**
 * One risk row: title + explanation prose + its file references, each as a
 * `<button>` (AC-35, AC-38). Colocated helper rather than its own file — it
 * has a single caller and no independent state (react-best-practices: small
 * colocated internal helpers are fine).
 */
function RiskRow({
  risk,
  onOpenFileLine,
}: {
  risk: BriefRisk;
  onOpenFileLine: (file: string, line: number) => void;
}) {
  const t = useTranslations("brief");
  return (
    <li style={riskRowStyle}>
      <p style={riskTitleStyle}>{risk.title}</p>
      <p style={proseStyle}>{risk.explanation}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
        {risk.file_refs.map((ref, i) => {
          const { file, line } = parseFileRef(ref);
          return (
            <button
              key={`${ref}-${i}`}
              type="button"
              onClick={() => onOpenFileLine(file, line ?? 1)}
              aria-label={t("card.riskFileAriaLabel", { file })}
              className="mono"
              style={riskFileRefStyle}
            >
              {ref}
            </button>
          );
        })}
      </div>
    </li>
  );
}

/**
 * PR Brief card: what/why prose, an overall risk level, and the grounded
 * risks list — plus a Regenerate control. The "review focus" list is its own
 * card (`ReviewFocusCard`), rendered by `OverviewTab` below the Intent/Blast
 * grid rather than nested here, to match the reviewer-facing design (a
 * reviewer scans risk level → intent/blast context → read-these-first list,
 * in that order). Renders its own `SectionLabel` inside the `Card` (matching
 * `IntentCard`), so it must NOT also get one from its parent
 * (client/INSIGHTS.md 2026-08-10).
 */
export function PrBriefCard({ prId, score, costUsd, onOpenFileLine }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = useBrief(prId);
  const regenerate = useRegenerateBrief(prId);

  const regenerateButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={regenerate.isPending}
      disabled={regenerate.isPending}
      aria-label={t("regenerateAriaLabel")}
      onClick={() => regenerate.mutate()}
    >
      {t("regenerate")}
    </Button>
  );

  // Mutually-exclusive states (AC-40, AC-41) computed once so the JSX below
  // stays a flat branch rather than nested ternaries.
  let body: React.ReactNode;

  if (isLoading) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton height={16} width="60%" />
        <Skeleton height={14} width="90%" />
        <Skeleton height={14} width="80%" />
      </div>
    );
  } else if (isError) {
    // A failed fetch is distinct from "no brief yet" — offer a retry rather
    // than silently falling through to the unavailable copy below.
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <p style={{ fontSize: 13, color: "var(--crit)", margin: 0 }}>{t("error")}</p>
        <Button kind="secondary" size="sm" onClick={() => refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  } else if (!data) {
    // Defensive: query settled with no error but also no data (e.g. prId not
    // yet resolved). Distinct from the AC-41 no-changed-files state below.
    body = (
      <div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("unavailable")}</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0 0" }}>
          {t("unavailableHint")}
        </p>
      </div>
    );
  } else if ((data.degraded_inputs ?? []).includes("no_changed_files")) {
    // AC-41: the brief could not be composed because the PR has zero changed
    // files — a dedicated message, not a generic empty card.
    body = (
      <div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {t("noChangedFiles")}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0 0" }}>
          {t("noChangedFilesHint")}
        </p>
      </div>
    );
  } else {
    const { brief } = data;
    body = (
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 0 }}>
          <RiskLevelBadge level={brief.risk_level} />

          {brief.what && (
            <div>
              <p style={labelStyle}>{t("card.whatLabel")}</p>
              <p style={proseStyle}>{brief.what}</p>
            </div>
          )}

          {brief.why && (
            <div>
              <p style={labelStyle}>{t("card.whyLabel")}</p>
              <p style={proseStyle}>{brief.why}</p>
            </div>
          )}

          <div>
            <p style={labelStyle}>{t("card.risksLabel")}</p>
            {brief.risks.length > 0 ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {brief.risks.map((risk, i) => (
                  <RiskRow
                    key={`${risk.kind}-${risk.title}-${i}`}
                    risk={risk}
                    onOpenFileLine={onOpenFileLine}
                  />
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("noRisks")}</p>
            )}
          </div>
        </div>

        <ScoreColumn score={score} costUsd={costUsd} tokens={data.tokens} />
      </div>
    );
  }

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel icon="FileText" right={regenerateButton}>
        {t("card.sectionLabel")}
      </SectionLabel>
      {body}
    </Card>
  );
}
