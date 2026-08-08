/** Constants for FindingCard. */

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";

/** `scrollIntoView` options used when a card is the `?finding=` deep-link
 *  target (e.g. arriving from a Smart Diff finding badge). */
export const TARGET_SCROLL_BEHAVIOR: ScrollBehavior = "smooth";
export const TARGET_SCROLL_BLOCK: ScrollLogicalPosition = "center";
