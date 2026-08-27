/* Pure helpers for the eval case editor — no React, unit-testable. */
import { ExpectedFinding } from "@devdigest/shared";

export interface ParsedExpectedOutput {
  data: ExpectedFinding[] | null;
  /** "syntax" = not valid JSON at all; "shape" = valid JSON but fails the
   *  ExpectedFinding[] schema (AC-10 distinguishes neither in the UI, but the
   *  caller can use this to pick a message). */
  error: "syntax" | "shape" | null;
}

const ExpectedOutputArray = ExpectedFinding.array();

/**
 * Parse + validate the expected-output textarea value against the shared
 * `ExpectedFinding[]` schema (AC-10). Pure and cheap — safe to call directly
 * during render every keystroke instead of caching it in state.
 */
export function parseExpectedOutput(text: string): ParsedExpectedOutput {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { data: null, error: "syntax" };
  }
  const result = ExpectedOutputArray.safeParse(json);
  if (!result.success) {
    return { data: null, error: "shape" };
  }
  return { data: result.data, error: null };
}

/** Count findings in an `unknown` per-trace expected/actual payload. */
export function countFindings(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export interface InputMeta {
  title: string;
  body: string;
}

/** The case's `input_meta` is `unknown` on the wire — narrow it defensively
 *  for the PR-meta tab (a case created before this shape existed, or one
 *  captured from a `must_not_flag` finding, may carry a different shape). */
export function readInputMeta(meta: unknown): InputMeta {
  if (meta && typeof meta === "object") {
    const m = meta as Record<string, unknown>;
    return {
      title: typeof m.title === "string" ? m.title : "",
      body: typeof m.body === "string" ? m.body : "",
    };
  }
  return { title: "", body: "" };
}

/** Files tab is unknown-shaped on the wire (`input_files: z.unknown()`) —
 *  unlike expected_output there's no schema to validate against, so a
 *  malformed edit doesn't block Save; it's saved as `null` instead of
 *  silently keeping stale data. */
export function parseFilesInput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export type DiffLineKind = "hunk" | "fileHeader" | "add" | "del" | "ctx";

export interface DiffLine {
  text: string;
  kind: DiffLineKind;
}

function classifyDiffLine(raw: string): DiffLineKind {
  if (raw.startsWith("@@")) return "hunk";
  if (raw.startsWith("+++") || raw.startsWith("---")) return "fileHeader";
  if (raw.startsWith("+")) return "add";
  if (raw.startsWith("-")) return "del";
  return "ctx";
}

/**
 * Classify each line of a raw unified-diff string for the colorized diff
 * view (design fidelity: "+" rows get a green background, the "@@" hunk
 * header gets the accent color, context lines are muted). Pure and
 * unit-testable — the textarea overlay component just maps this over rows.
 */
export function parseDiffLines(text: string): DiffLine[] {
  return text.split("\n").map((raw) => ({ text: raw, kind: classifyDiffLine(raw) }));
}

/** Template inserted by the modal's "+ Finding skeleton" button — the
 *  minimal shape a user fills in by hand, matching the `ExpectedFinding`
 *  schema (AC-10) field-for-field. */
const FINDING_SKELETON: ExpectedFinding = {
  severity: "WARNING",
  category: "",
  title: "",
  file: "",
  start_line: 1,
};

/**
 * Appends one finding-skeleton object into the expected-output JSON text.
 * If the current text isn't a valid JSON array (empty, malformed, or a
 * non-array value), starts a fresh single-item array instead of blocking the
 * button on whatever state the editor happens to be in.
 */
export function insertFindingSkeleton(text: string): string {
  let arr: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    /* malformed JSON — fall back to a fresh array */
  }
  arr.push({ ...FINDING_SKELETON });
  return JSON.stringify(arr, null, 2);
}
