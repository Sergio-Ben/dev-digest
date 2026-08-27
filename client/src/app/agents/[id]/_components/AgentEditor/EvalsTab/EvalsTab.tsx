/* EvalsTab (T10, Capability B/E) — AgentEditor "Evals" tab: batch metrics +
   trend + run history (MetricsPanel), and the eval-case list with per-row
   run/edit/delete + header "New case"/"Run all evals" (AC-7,8,9,30,31).

   Case creation/editing opens `EvalCaseEditorModal` (design-fidelity
   reconciliation: the editor is a centered modal, not a standalone route) —
   this tab owns the open/selected-case state and passes it straight through,
   it never navigates to a `/eval/cases/*` route. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import { useDeleteEvalCase, useEvalCases, useEvalDashboard, useRunAgentEvals, useRunEvalCase } from "@/lib/hooks/evals";
import { ApiError } from "@/lib/api";
import { EvalCaseEditorModal } from "@/app/eval/cases/_components/EvalCaseEditor";
import { CaseRow } from "./CaseRow";
import { MetricsPanel } from "./MetricsPanel";
import { latestRunFor, passingCount } from "./helpers";

/** Which case (if any) the "New case"/"Edit" actions have opened the modal
 *  for — `"new"` = blank case, an id = editing that existing case. */
type ModalTarget = "new" | string | null;

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const [modalTarget, setModalTarget] = React.useState<ModalTarget>(null);

  const {
    data: cases,
    isLoading: casesLoading,
    isError: casesError,
    error: casesLoadError,
    refetch: refetchCases,
  } = useEvalCases(agentId);
  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError } = useEvalDashboard(agentId);

  const runCase = useRunEvalCase();
  const runAll = useRunAgentEvals(agentId);
  const deleteCase = useDeleteEvalCase();

  // Tracks which single row is running so only that row's button shows the
  // loading state — `useRunEvalCase()` is one shared mutation for every row.
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);

  const list = cases ?? [];

  const handleRun = (id: string) => {
    setRunningCaseId(id);
    runCase.mutate({ id, agentId }, { onSettled: () => setRunningCaseId(null) });
  };

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(t("evalsTab.deleteConfirm", { name }))) return;
    deleteCase.mutate({ id, agentId });
  };

  const handleNew = () => setModalTarget("new");
  const handleEdit = (id: string) => setModalTarget(id);
  const closeModal = () => setModalTarget(null);

  if (casesLoading) {
    return (
      <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={90} />
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (casesError) {
    return (
      <ErrorState
        body={casesLoadError instanceof ApiError ? casesLoadError.message : t("evalsTab.loadError")}
        onRetry={() => refetchCases()}
      />
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <MetricsPanel agentId={agentId} dashboard={dashboard} isLoading={dashboardLoading} isError={dashboardError} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.casesHeading")}</h3>
        <Badge color="var(--ok)" bg="var(--ok-bg)">
          {t("evalsTab.passingSummary", { passed: passingCount(list, dashboard?.recent_runs), total: list.length })}
        </Badge>
        <div style={{ flex: 1 }} />
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          loading={runAll.isPending}
          disabled={list.length === 0}
          onClick={() => runAll.mutate()}
        >
          {runAll.isPending ? t("dashboard.running") : t("evalsTab.runAll")}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={handleNew}>
          {t("evalsTab.newCase")}
        </Button>
      </div>

      {list.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 0" }}>
          {t("evalsTab.emptyCases")}
        </p>
      ) : (
        <div role="list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((c) => (
            <CaseRow
              key={c.id}
              evalCase={c}
              latestRun={latestRunFor(c.id, dashboard?.recent_runs)}
              isRunning={runningCaseId === c.id}
              onRun={() => handleRun(c.id)}
              onEdit={() => handleEdit(c.id)}
              onDelete={() => handleDelete(c.id, c.name)}
            />
          ))}
        </div>
      )}

      {modalTarget !== null && (
        <EvalCaseEditorModal
          agentId={agentId}
          caseId={modalTarget === "new" ? null : modalTarget}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
