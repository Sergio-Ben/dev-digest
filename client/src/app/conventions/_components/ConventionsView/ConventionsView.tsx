/* /conventions — Conventions extractor (Skills Lab).

   Scan the active repo, triage each detected rule (accept / reject / edit),
   then merge the accepted ones into one `<repo>-conventions` skill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/contexts";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { SKELETON_ROWS } from "./constants";
import { countAccepted, evidenceUrl, relativeTime } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const [creating, setCreating] = React.useState(false);

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);

  const repoName = activeRepo?.name ?? t("page.repoFallback");
  const candidates = data?.candidates ?? [];
  const accepted = countAccepted(candidates);
  const scan = data?.scan ?? null;

  const setStatus = (id: string, status: "pending" | "accepted" | "rejected") =>
    update.mutate({ id, patch: { status } });

  // "Accepted"/"Reject" are toggles: clicking the active one returns the card
  // to `pending`, which is also what Deselect all does in bulk.
  const toggle = (id: string, status: "accepted" | "rejected") => {
    const current = candidates.find((c) => c.id === id)?.status;
    setStatus(id, current === status ? "pending" : status);
  };

  const deselectAll = () => {
    for (const c of candidates) if (c.status === "accepted") setStatus(c.id, "pending");
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {creating && (
        <CreateSkillModal
          repoId={repoId}
          repoName={repoName}
          acceptedCount={accepted}
          onClose={() => setCreating(false)}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>
              {scan
                ? t("page.subtitleScan", {
                    count: scan.sample_count,
                    when: relativeTime(scan.created_at, t),
                  })
                : t("page.subtitle")}
            </p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extract.isPending}
            disabled={extract.isPending || !repoId}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>

        {isLoading && (
          <div>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <Skeleton height={140} />
              </div>
            ))}
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={extract.isPending ? t("page.scanning") : t("page.empty.cta")}
            onCta={() => extract.mutate()}
          />
        )}

        {candidates.length > 0 && (
          <>
            <div style={s.actionBar}>
              <Button
                kind="ghost"
                size="sm"
                onClick={deselectAll}
                disabled={accepted === 0 || update.isPending}
              >
                {t("page.deselectAll")}
              </Button>
              <span style={s.count}>
                {t("page.acceptedCount", { accepted, total: candidates.length })}
              </span>
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                disabled={accepted === 0}
                onClick={() => setCreating(true)}
              >
                {t("page.createSkill")}
              </Button>
            </div>

            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                evidenceHref={evidenceUrl(activeRepo, c)}
                busy={update.isPending}
                onAccept={(id) => toggle(id, "accepted")}
                onReject={(id) => toggle(id, "rejected")}
                onEditRule={(id, rule) => update.mutate({ id, patch: { rule } })}
              />
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
