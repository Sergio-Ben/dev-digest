/* ConventionCard — one extracted rule with its evidence.

   The rule text is click-to-edit (user story 4): Enter commits, Escape reverts,
   blur commits. Evidence is rendered read-only — the line range came from the
   server's verification pass, not from the model. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, ProgressBar, TextInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

/** Same thresholds as ConfidenceNum, so the two never disagree. */
function confidenceColor(pct: number): string {
  return pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--crit)";
}

function evidenceLocation(c: ConventionCandidate): string {
  if (c.evidenceStartLine == null) return c.evidencePath;
  const end = c.evidenceEndLine;
  const range =
    end == null || end === c.evidenceStartLine
      ? `${c.evidenceStartLine}`
      : `${c.evidenceStartLine}-${end}`;
  return `${c.evidencePath}:${range}`;
}

export function ConventionCard({
  candidate,
  evidenceHref,
  onAccept,
  onReject,
  onEditRule,
  busy,
}: {
  candidate: ConventionCandidate;
  /** github.com blob link for the evidence; omitted when the repo is unknown. */
  evidenceHref?: string | null;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onEditRule?: (id: string, rule: string) => void;
  busy?: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);

  const pct = Math.round(candidate.confidence * 100);
  const color = confidenceColor(pct);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== candidate.rule) onEditRule?.(candidate.id, next);
    else setDraft(candidate.rule);
  };
  const cancel = () => {
    setDraft(candidate.rule);
    setEditing(false);
  };

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.main}>
        <div style={s.ruleRow}>
          {candidate.category && <span style={s.category}>{candidate.category}</span>}
          {editing ? (
            <TextInput
              value={draft}
              onChange={setDraft}
              autoFocus
              aria-label={t("card.editRule")}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
            />
          ) : (
            <span
              style={s.rule}
              title={t("card.editRule")}
              onClick={() => {
                setDraft(candidate.rule);
                setEditing(true);
              }}
            >
              {candidate.rule}
            </span>
          )}
        </div>

        <div style={s.evidenceHeader}>
          {evidenceHref ? (
            <a
              className="mono"
              href={evidenceHref}
              target="_blank"
              rel="noreferrer"
              title={t("card.openOnGitHub")}
              style={s.evidenceLink}
            >
              {evidenceLocation(candidate)}
              <Icon.ExternalLink size={11} />
            </a>
          ) : (
            <span className="mono">{evidenceLocation(candidate)}</span>
          )}
          <IconBtn
            icon="Copy"
            label={t("card.copySnippet")}
            size={22}
            onClick={() => navigator.clipboard?.writeText(candidate.evidenceSnippet)}
          />
        </div>
        <pre className="mono" style={s.snippet}>
          {candidate.evidenceSnippet}
        </pre>

        <div style={s.confidenceRow}>
          <span>{t("card.confidence")}</span>
          <span style={s.confidenceBar}>
            <ProgressBar value={pct} color={color} />
          </span>
          <span className="mono tnum" style={s.confidenceValue(color)}>
            {pct}%
          </span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={candidate.status === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          disabled={busy}
          onClick={() => onAccept?.(candidate.id)}
        >
          {t("card.accepted")}
        </Button>
        <Button
          kind={candidate.status === "rejected" ? "primary" : "secondary"}
          size="sm"
          icon="X"
          disabled={busy}
          onClick={() => onReject?.(candidate.id)}
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
