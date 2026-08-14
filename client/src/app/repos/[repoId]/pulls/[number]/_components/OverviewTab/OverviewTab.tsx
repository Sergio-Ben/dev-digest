"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "react-error-boundary";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/pulls";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /** Paths this PR touches — decides whether a Blast Radius caller can be
   *  opened in the local diff or has to go to GitHub. */
  changedPaths: string[];
  /** "owner/repo" + head sha, for github.com blob links to callers outside the diff. */
  repoFullName: string | null;
  headSha: string | null | undefined;
  onOpenFileLine: (file: string, line: number) => void;
}

export function OverviewTab({
  prBody,
  prId,
  changedPaths,
  repoFullName,
  headSha,
  onOpenFileLine,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  const {
    data: blastRadius,
    isLoading: blastLoading,
    isError: blastFailed,
  } = useBlastRadius(prId);
  const changedSet = React.useMemo(() => new Set(changedPaths), [changedPaths]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
