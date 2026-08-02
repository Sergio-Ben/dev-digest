import type { SkillType } from "@devdigest/shared";

export const MODAL_WIDTH = 720;

/** Conventions produce a `convention` skill; the others stay reachable. */
export const DEFAULT_TYPE: SkillType = "convention";

export const TYPE_OPTIONS: SkillType[] = ["rubric", "convention", "security", "custom"];

export const BODY_ROWS = 16;

/** Same rough heuristic the skill editor's ConfigTab shows (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}
