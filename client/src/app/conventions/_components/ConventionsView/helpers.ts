import type { ConventionCandidate, Repo } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./constants";

/** Translator shape we need — keeps these helpers testable without next-intl. */
type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * "just now" / "12m ago" / "1h ago" / "3d ago". Deliberately coarse: the scan
 * subtitle only needs to answer "is this stale?".
 */
export function relativeTime(iso: string, t: T, now = Date.now()): string {
  const delta = now - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < MINUTE_MS) return t("time.justNow");
  if (delta < HOUR_MS) return t("time.minutes", { count: Math.floor(delta / MINUTE_MS) });
  if (delta < DAY_MS) return t("time.hours", { count: Math.floor(delta / HOUR_MS) });
  return t("time.days", { count: Math.floor(delta / DAY_MS) });
}

export function countAccepted(candidates: ConventionCandidate[]): number {
  return candidates.filter((c) => c.status === "accepted").length;
}

/**
 * github.com blob link for a candidate's evidence, anchored at the verified
 * line range. Pinned to the repo's default branch — a conventions scan has no
 * commit sha of its own (unlike a PR finding, which pins to the PR head), so a
 * later force-push can drift the anchor.
 *
 * Returns null when the repo isn't loaded yet: the path then renders as plain
 * text rather than a link to nowhere.
 */
export function evidenceUrl(
  repo: Pick<Repo, "full_name" | "default_branch"> | null | undefined,
  candidate: ConventionCandidate,
): string | null {
  if (!repo?.full_name) return null;
  return githubBlobUrl(
    repo.full_name,
    repo.default_branch || "HEAD",
    candidate.evidencePath,
    candidate.evidenceStartLine ?? undefined,
    candidate.evidenceEndLine ?? undefined,
  );
}
