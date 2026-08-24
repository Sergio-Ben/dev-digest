"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "react-error-boundary";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/pulls";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard, ReviewFocusCard } from "./PrBriefCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /** Paths this PR touches — decides whether a Blast Radius caller can be
   *  opened in the local diff or has to go to GitHub. */
  changedPaths: string[];
  /** "owner/repo" + head sha, for github.com blob links to callers outside the diff. */
  repoFullName: string | null;
  headSha: string | null | undefined;
  /** The PR's latest-review score/cost (existing review-verdict data, per
   *  `PrMeta`/`PrDetail`) — shown in the PR Brief card's header alongside its
   *  own risk level, at the user's explicit request to surface it there. */
  score: number | null;
  costUsd: number | null;
  onOpenFileLine: (file: string, line: number) => void;
}

export function OverviewTab({
  prBody,
  prId,
  changedPaths,
  repoFullName,
  headSha,
  score,
  costUsd,
  onOpenFileLine,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  const tBrief = useTranslations("brief");
  const {
    data: blastRadius,
    isLoading: blastLoading,
    isError: blastFailed,
  } = useBlastRadius(prId);
  const changedSet = React.useMemo(() => new Set(changedPaths), [changedPaths]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* PR Brief: full-width, first in DOM order (AC-33). Renders its own
          SectionLabel inside the card, so no parent label here — and no
          h-[400px]/definite-height wrapper: that constraint only applies to
          cards inside the alignItems:"stretch" grid below (client/INSIGHTS.md
          2026-08-10); this card is outside it and sizes to its own content. */}
      {prId && (
        <ErrorBoundary
          fallback={
            <div className="text-sm text-red-400 p-4">{tBrief("error")}</div>
          }
        >
          <PrBriefCard
            prId={prId}
            score={score}
            costUsd={costUsd}
            onOpenFileLine={onOpenFileLine}
          />
        </ErrorBoundary>
      )}

      {/* Two-column: Intent (left) + Blast Radius (right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        {prId && <IntentCard prId={prId} />}

        {/* No SectionLabel here — BlastRadiusCard renders its own header inside
            the card, the same way IntentCard does. */}
        <section style={{ display: "flex", flexDirection: "column" }}>
          <ErrorBoundary
            fallback={
              <div className="text-sm text-red-400 p-4">
                {t("blastRadius.error")}
              </div>
            }
          >
            <BlastRadiusCard
              blastRadius={blastRadius}
              isLoading={blastLoading}
              isError={blastFailed}
              changedPaths={changedSet}
              repoFullName={repoFullName}
              headSha={headSha}
              onOpenFileLine={onOpenFileLine}
            />
          </ErrorBoundary>
        </section>
      </div>

      {/* Review focus: its own full-width card below Intent/Blast, not nested
          inside PrBriefCard — matches the reviewer-facing read order (risk
          level → intent/blast context → read-these-first list). */}
      {prId && (
        <ErrorBoundary
          fallback={
            <div className="text-sm text-red-400 p-4">{tBrief("error")}</div>
          }
        >
          <ReviewFocusCard prId={prId} onOpenFileLine={onOpenFileLine} />
        </ErrorBoundary>
      )}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
