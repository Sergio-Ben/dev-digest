/**
 * constants.ts — shared brief-module constants.
 *
 * Onion layer: application constants (no DB, no HTTP, no LLM calls).
 */

/** Bump when the persisted brief schema shape changes incompatibly. */
export const BRIEF_SCHEMA_VERSION = 1;

/** Max number of review-focus entries surfaced in a brief. */
export const MAX_REVIEW_FOCUS = 6;

/** Total byte budget for resolved reference content included in a brief prompt. */
export const REFERENCE_BUDGET_BYTES = 12_000;

/** Marker appended when content is cut to fit a budget. */
export const TRUNCATION_MARKER = '\n…[truncated]';
