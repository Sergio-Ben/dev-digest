/* constants.ts — per-`risk_level` presentation metadata for the PR Brief card.
 *
 * `label` stores the i18n KEY PATH under the `brief` namespace, not literal
 * copy — `RiskLevelBadge` calls `t(meta.label)` at render. This keeps config
 * (which colour/key goes with which level) in constants while satisfying
 * "no hardcoded UI strings" (client/INSIGHTS.md 2026-08-07).
 *
 * Colours use the theme-aware `--warn`/`--warn-bg`, `--crit`/`--crit-bg`, and
 * `--accent-text`/`--accent-bg` pairs (vendor/ui/styles.css:10-67) — raw
 * Tailwind hues (`bg-amber-500/15` etc.) are dark-mode-only and unreadable in
 * light mode (client/INSIGHTS.md 2026-08-10).
 */
import type { BriefRiskLevel } from "@devdigest/shared";

export interface RiskLevelMeta {
  /** i18n key path, e.g. "riskLevel.high". */
  label: string;
  color: string;
  bg: string;
}

export const RISK_LEVEL_META: Record<BriefRiskLevel, RiskLevelMeta> = {
  high: { label: "riskLevel.high", color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { label: "riskLevel.medium", color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { label: "riskLevel.low", color: "var(--accent-text)", bg: "var(--accent-bg)" },
};
