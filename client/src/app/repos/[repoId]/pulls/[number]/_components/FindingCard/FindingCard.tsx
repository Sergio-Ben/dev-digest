/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import {
  SEV_COLOR,
  SEV_COLOR_FALLBACK,
  TARGET_SCROLL_BEHAVIOR,
  TARGET_SCROLL_BLOCK,
} from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/utils/githubUrls";
import { useEvalCaseFromFinding } from "../../../../../../../lib/hooks/evals";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  targeted,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** This card is the deep-link target (`?finding=<id>`, e.g. clicked in the
   *  Smart Diff): expand it, scroll it into view and flash it once. */
  targeted?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? targeted ?? false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Scoped to this finding's own id (mirrors `useDeleteReview(prId)`): each
  // card instance owns its own "turn into eval case" mutation state. AC-4
  // ("decide first") is enforced server-side — this just calls through and
  // surfaces whatever the server responds with, success or rejection.
  const evalCase = useEvalCaseFromFinding(f.id);

  // Deep-link arrival: the card may mount long after the URL changed (the tab
  // switches, the accordion opens, then this renders), so drive it off the
  // prop rather than a one-shot on mount.
  React.useEffect(() => {
    if (!targeted) return;
    setExpanded(true);
    rootRef.current?.scrollIntoView({ behavior: TARGET_SCROLL_BEHAVIOR, block: TARGET_SCROLL_BLOCK });
  }, [targeted]);

  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div ref={rootRef} data-finding-id={f.id} style={s.card(!!focused, sevColor, muted, !!targeted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={pending || evalCase.isPending}
              loading={evalCase.isPending}
              onClick={() => evalCase.mutate()}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
          </div>

          {evalCase.isError && (
            <div role="alert" style={s.evalCaseError}>
              {evalCase.error instanceof Error
                ? evalCase.error.message
                : t("finding.evalCaseError")}
            </div>
          )}
          {evalCase.isSuccess && (
            <div role="status" style={s.evalCaseSuccess}>
              {!evalCase.data.created && evalCase.data.reason === "undecided"
                ? evalCase.data.message
                : !evalCase.data.created && evalCase.data.reason === "exists"
                  ? t("finding.evalCaseExists")
                  : t("finding.evalCaseCreated")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
