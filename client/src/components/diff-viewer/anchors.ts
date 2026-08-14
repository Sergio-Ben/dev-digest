/** Deep-linking into the diff: the per-line DOM anchor scheme plus the scroll
 *  behaviour used to jump to one. Shared by every surface that can send the
 *  user to a line (Smart Diff finding badges, Blast Radius callers, `?file=&line=`
 *  URLs) so they can't drift into two incompatible id schemes — the exact trap
 *  client/INSIGHTS.md records for forked diff-renderer copies. */

/** `scrollIntoView` options used when jumping to a line. */
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

/** Stable, DOM-safe id derived from a file path — used both as a FileCard
 *  anchor prefix and (joined with `-L{line}`) as a per-line scroll target. */
export function fileAnchorId(path: string): string {
  return `sd-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Per-line scroll target: `sd-src-lib-api-ts-L42`. `line` is a NEW-side line
 *  number — deleted lines carry no new-side number and so can't be targeted. */
export function lineAnchorId(path: string, line: number): string {
  return `${fileAnchorId(path)}-L${line}`;
}

/**
 * Scroll to (and briefly flash) an anchored diff line, retrying a few times
 * since the line only exists in the DOM once its file card commits its
 * just-opened state.
 */
export function scrollToDiffLine(anchorId: string, attempt = 0): void {
  const el = document.getElementById(anchorId);
  if (el) {
    el.scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: SCROLL_BLOCK });
    const prevBg = el.style.backgroundColor;
    const prevTransition = el.style.transition;
    el.style.transition = "background-color .2s";
    el.style.backgroundColor = "var(--warn-bg)";
    window.setTimeout(() => {
      el.style.backgroundColor = prevBg;
      el.style.transition = prevTransition;
    }, FINDING_FLASH_MS);
    return;
  }
  if (attempt < SCROLL_MAX_ATTEMPTS) {
    window.setTimeout(() => scrollToDiffLine(anchorId, attempt + 1), SCROLL_RETRY_MS);
  }
}
