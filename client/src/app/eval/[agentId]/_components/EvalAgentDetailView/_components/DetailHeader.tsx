/* DetailHeader — top of the per-agent Eval Dashboard detail page: a "‹ All
   agents" back link, the agent name + model badge + subtitle, and the
   top-right controls (agent-selector dropdown, a static "30 days" range
   label, and the primary "Run eval" action). Purely presentational — the
   parent view owns navigation (`onSelectAgent`) and the run mutation
   (`isRunning`/`onRunEval`), this component only renders. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, SelectInput } from "@devdigest/ui";
import type { Agent, EvalBatchRow, EvalDashboard } from "@devdigest/shared";

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function DetailHeader({
  agent,
  agents,
  dashboard,
  isRunning,
  onRunEval,
  onSelectAgent,
}: {
  agent: Agent;
  agents: Agent[];
  dashboard: (EvalDashboard & { batches: EvalBatchRow[] }) | undefined;
  isRunning: boolean;
  onRunEval: () => void;
  onSelectAgent: (id: string) => void;
}) {
  const t = useTranslations("eval");
  const runsCount = dashboard?.batches.length ?? 0;
  const tracesCount = dashboard?.cases_total ?? 0;

  return (
    <div style={{ marginBottom: 20 }}>
      <Link
        href="/eval"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--text-muted)",
          textDecoration: "none",
          marginBottom: 10,
        }}
      >
        <Icon.ChevronLeft size={14} aria-hidden="true" />
        {t("detail.backToAgents")}
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{agent.name}</h1>
            {/* Model badge in the design is a bordered, transparent, monospace
                chip with NO icon — unlike Badge's default filled pill, so the
                fill/border/icon are overridden here rather than changing the
                shared primitive's default look for every other caller. */}
            <Badge
              mono
              color="var(--text-muted)"
              style={{ background: "transparent", border: "1px solid var(--border-strong)" }}
            >
              {agent.model}
            </Badge>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>
            {t("detail.subtitle", { runs: runsCount, traces: tracesCount })}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ minWidth: 180 }}>
            <span style={visuallyHidden}>{t("detail.switchAgent")}</span>
            <SelectInput
              value={agent.id}
              onChange={onSelectAgent}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
              mono={false}
            />
          </label>

          {/* Static "30 days" range indicator — matches the SelectInput/Button
              chrome (bordered box, same height) rather than the compact Badge
              pill, since the design shows it as a third control alongside the
              dropdown and the primary action, not an inline status chip. */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 12px",
              borderRadius: 7,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-elevated)",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            <Icon.Calendar size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
            {t("detail.rangeFilter")}
          </span>

          <Button
            kind="primary"
            size="sm"
            icon="Play"
            loading={isRunning}
            disabled={isRunning}
            onClick={onRunEval}
            style={{ padding: "10px 16px", borderRadius: 7 }}
          >
            {isRunning ? t("dashboard.running") : t("detail.runEval")}
          </Button>
        </div>
      </div>
    </div>
  );
}
