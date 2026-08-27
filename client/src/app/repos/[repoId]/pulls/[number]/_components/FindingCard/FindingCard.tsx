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

  // "Captured into an eval case" is persisted on the finding (`eval_case_id`,
  // derived server-side) so it survives a reload — OR it's the result of the
  // capture we just fired this session, so the button flips immediately without
  // waiting for the reviews query to refetch. `undecided` is a success too but
  // creates nothing, so it must NOT count as captured. (The `evalCase.isSuccess`
  // guard is what narrows `evalCase.data` off the mutation's discriminated union.)
  const justCaptured =
    evalCase.isSuccess &&
    (evalCase.data.created === true ||
      (evalCase.data.created === false && evalCase.data.reason === "exists"));
  const captured = !!f.eval_case_id || justCaptured;
  const undecidedMessage =
    evalCase.isSuccess && evalCase.data.created === false && evalCase.data.reason === "undecided"
      ? evalCase.data.message
      : null;
  const capturedMessage = !captured
    ? null
    : evalCase.isSuccess && evalCase.data.created === false && evalCase.data.reason === "exists"
      ? t("finding.evalCaseExists")
      : t("finding.evalCaseCreated");

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
            {captured && <span style={s.evalCaseTag}>{t("finding.evalCaseTag")}</span>}
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
              // Already captured → keep it visibly "done" and non-repeatable,
              // the same way accept/dismiss reflect their persisted state.
              disabled={pending || evalCase.isPending || captured}
              loading={evalCase.isPending}
              active={captured}
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
          {undecidedMessage && (
            <div role="status" style={s.evalCaseSuccess}>
              {undecidedMessage}
            </div>
          )}
          {capturedMessage && (
            <div role="status" style={s.evalCaseSuccess}>
              {capturedMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
