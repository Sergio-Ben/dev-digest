/* AlertBanner — the design's amber/warning strip on the per-agent detail
   page, driven by `EvalDashboard.alert` (e.g. "Precision dipped 2pts on v7
   ...", server-composed). Renders nothing when the caller doesn't render it
   (guarded by the parent on `dashboard.alert !== null`) — this component
   itself is unconditional once mounted, so callers must gate it. */
import React from "react";
import { Icon } from "@devdigest/ui";

export function AlertBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 8,
        background: "var(--warn-bg)",
        border: "1px solid var(--warn)",
        color: "var(--warn)",
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 20,
      }}
    >
      <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
