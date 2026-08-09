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

/** `scrollIntoView` options used when jumping to a clicked finding. */
export const SCROLL_BEHAVIOR: ScrollBehavior = "smooth";
export const SCROLL_BLOCK: ScrollLogicalPosition = "center";

/** Retry interval (ms) while waiting for a just-expanded file's line to
 *  mount before we can scroll to it. */
export const SCROLL_RETRY_MS = 50;

/** Give up finding the anchor after this many retries (defensive — avoids an
 *  infinite retry loop if the line never mounts). */
export const SCROLL_MAX_ATTEMPTS = 20;

/** How long a jumped-to line keeps its highlight flash. */
export const FINDING_FLASH_MS = 1500;
