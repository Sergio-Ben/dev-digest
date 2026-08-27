/* EvalAgentDetailView — /eval/:agentId, the per-agent Eval Dashboard detail
   page shown in the approved "Eval Dashboard › Security Reviewer" screenshot.
   Design-fidelity reconciliation: the cross-agent dashboard's agent cards
   (`AgentSummaryCard`) already link here, so this route completes that flow.

   Mirrors the AppShell + "use client" view pattern used by the cross-agent
   `EvalDashboardView`: header (back link, name, model, agent switcher, run
   action), an alert banner when the dashboard flags a regression, three
   metric cards with sparklines, a metric-trend chart, and a "Recent runs"
   table whose exactly-two-row selection opens the shared `EvalCompareModal`. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, MetricCard, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import { useEvalDashboard, useRunAgentEvals } from "@/lib/hooks/evals";
import { ApiError } from "@/lib/api";
import { EvalCompareModal } from "@/app/eval/compare/_components/EvalCompareModal";
import { AlertBanner } from "./_components/AlertBanner";
import { DetailHeader } from "./_components/DetailHeader";
import { MetricTrendPanel } from "./_components/MetricTrendPanel";
import { RunsTable } from "./_components/RunsTable";
import { deltaPoints, toggleBatchSelection } from "./helpers";

export function EvalAgentDetailView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();

  const { data: agent, isLoading: agentLoading, isError: agentIsError } = useAgent(agentId);
  const { data: agents } = useAgents();
  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError: dashboardIsError,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useEvalDashboard(agentId);
  const runEval = useRunAgentEvals(agentId);

  const [selected, setSelected] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);

  const isLoading = agentLoading || dashboardLoading;
  const isError = agentIsError || dashboardIsError;

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agent?.name ?? agentId },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px", maxWidth: 1080, margin: "0 auto" }}>
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={80} />
            <Skeleton height={220} />
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState
            body={dashboardError instanceof ApiError ? dashboardError.message : t("dashboard.loadError")}
            onRetry={() => refetchDashboard()}
          />
        )}

        {!isLoading && !isError && agent && dashboard && (
          <>
            <DetailHeader
              agent={agent}
              agents={agents ?? []}
              dashboard={dashboard}
              isRunning={runEval.isPending}
              onRunEval={() => runEval.mutate()}
              onSelectAgent={(id) => router.push(`/eval/${id}`)}
            />

            {dashboard.alert && <AlertBanner message={dashboard.alert} />}

            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={Math.round(dashboard.current.recall * 100)}
                suffix="%"
                delta={deltaPoints(dashboard.delta.recall)}
                color="var(--accent)"
                trend={dashboard.trend.map((p) => p.recall)}
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={Math.round(dashboard.current.precision * 100)}
                suffix="%"
                delta={deltaPoints(dashboard.delta.precision)}
                color="var(--ok)"
                trend={dashboard.trend.map((p) => p.precision)}
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={Math.round(dashboard.current.citation_accuracy * 100)}
                suffix="%"
                delta={deltaPoints(dashboard.delta.citation_accuracy)}
                color="var(--warn)"
                trend={dashboard.trend.map((p) => p.citation_accuracy)}
              />
            </div>

            <MetricTrendPanel trend={dashboard.trend} />

            <RunsTable
              batches={dashboard.batches}
              selected={selected}
              onToggle={(id) => setSelected((prev) => toggleBatchSelection(prev, id))}
              onCompare={() => setCompareOpen(true)}
            />
          </>
        )}
      </div>

      {compareOpen && selected.length === 2 && (
        <EvalCompareModal
          agentId={agentId}
          batchA={selected[0]!}
          batchB={selected[1]!}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </AppShell>
  );
}
