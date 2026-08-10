/** UI thresholds, role metadata, and scroll/timing constants for the Smart
 *  Diff viewer (Files changed tab, "Smart order"). */
import type { SmartDiffRole } from "@devdigest/shared";

/** Per-role display metadata. `label`/`description` are i18n KEY PATHS under
 *  the `brief.smartDiff` namespace (see messages/en/brief.json), not literal
 *  copy — keeping copy out of constants matches the rest of the codebase's
 *  "no hardcoded UI strings" convention (client/insights/INSIGHTS.md). */
export const ROLE_META: Record<SmartDiffRole, { label: string; description: string; color: string }> = {
  core: {
    label: "smartDiff.core.label",
    description: "smartDiff.core.description",
    color: "var(--accent)",
  },
  wiring: {
    label: "smartDiff.wiring.label",
    description: "smartDiff.wiring.description",
    color: "var(--ok)",
  },
  boilerplate: {
    label: "smartDiff.boilerplate.label",
    description: "smartDiff.boilerplate.description",
    color: "var(--text-muted)",
  },
};

/** Boilerplate files start collapsed regardless of size or role order —
 *  explicit acceptance criterion. */
export const DEFAULT_COLLAPSED_ROLES: SmartDiffRole[] = ["boilerplate"];

/* Scroll/anchor constants moved to `@/components/diff-viewer/anchors` — the
   Blast Radius card jumps to diff lines too, and two copies of the id scheme
   would silently drift apart. */
