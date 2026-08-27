/* /eval — cross-agent Eval Dashboard (Capability G). Mirrors the
   AppShell + "use client" view pattern used by app/skills/SkillsListView:
   the route's page.tsx stays a thin server component, all data + layout
   live here.

   Lists every reviewer agent once with its latest batch's recall/precision/
   citation, model badge, last-run version+timestamp+pass count, and a recall
   trend sparkline (AC-36); a most-recent-first "recent eval runs · all
   agents" list across agents (AC-37); a never-evaluated agent renders the
   "no runs yet" state rather than blank/fabricated metrics (AC-38, handled
   inside AgentSummaryCard); and a "Run all agents" action that triggers the
   server-bounded batch run for every agent with ≥1 eval case (AC-39). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useEvalDashboardCross, useRunAllAgents } from "../../../../lib/hooks/evals";
import { ApiError } from "../../../../lib/api";
import { AgentSummaryCard } from "./_components/AgentSummaryCard";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { agentNameMap } from "./helpers";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, error, refetch } = useEvalDashboardCross();
  const runAll = useRunAllAgents();

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px", maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 22 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t("dashboard.defaultTitle")}</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              {t("dashboard.subtitle")}
            </p>
          </div>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            loading={runAll.isPending}
            disabled={runAll.isPending || isLoading || isError}
            onClick={() => runAll.mutate()}
          >
            {runAll.isPending ? t("dashboard.runningAll") : t("dashboard.runAll")}
          </Button>
        </div>

        {isLoading && <Skeleton height={220} />}

        {isError && (
          <ErrorState
            body={error instanceof ApiError ? error.message : t("dashboard.loadError")}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && data && (
          <>
            {data.agents.length === 0 ? (
              <EmptyState icon="Cpu" title={t("dashboard.noAgents")} />
            ) : (
              <>
                <SectionLabel icon={<Icon.Cpu size={13} />} text={t("dashboard.agentsSection")} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 30 }}>
                  {data.agents.map((agent) => (
                    <AgentSummaryCard key={agent.agent_id} agent={agent} />
                  ))}
                </div>
              </>
            )}

            <SectionLabel icon={<Icon.History size={13} />} text={t("dashboard.recentRunsAllAgents")} />
            <RecentRunsTable batches={data.recent_batches} agentNames={agentNameMap(data.agents)} />
          </>
        )}
      </div>
    </AppShell>
  );
}

/** Small uppercase section header with a leading icon (AGENTS / RECENT EVAL RUNS). */
function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: "var(--text-muted)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 12,
      }}
    >
      {icon}
      {text}
    </div>
  );
}
