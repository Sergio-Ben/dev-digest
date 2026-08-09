/* SmartDiffViewer — "Files changed" in Smart order: the server-computed
   Smart Diff groups files by role (core/wiring/boilerplate) and flags
   finding lines; this component joins that grouping onto the real PrFile
   patches and renders them with the shared FileCard/CodeLine (no forked
   diff renderer — see client/INSIGHTS.md on drifting-copy pain). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SmartDiff, SmartDiffFile } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { DiffCommentApi } from "@/components/diff-viewer";
import {
  ROLE_META,
  SCROLL_BEHAVIOR,
  SCROLL_BLOCK,
  SCROLL_RETRY_MS,
  SCROLL_MAX_ATTEMPTS,
  FINDING_FLASH_MS,
} from "./constants";
import { shouldStartOpen, fileAnchorId, findingIdAtLine, indexFilesByPath } from "./helpers";
import { s } from "./styles";

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  files: PrFile[];
  commenting?: DiffCommentApi;
  onOpenFinding?: (findingId: string) => void;
}

/** Scroll to (and briefly flash) a file's first finding line, retrying a few
 *  times since the line only exists in the DOM once the file card commits
 *  its just-opened state. */
function scrollToFinding(anchorId: string, attempt = 0) {
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
    window.setTimeout(() => scrollToFinding(anchorId, attempt + 1), SCROLL_RETRY_MS);
  }
}

export function SmartDiffViewer({ smartDiff, files, commenting, onOpenFinding }: SmartDiffViewerProps) {
  const t = useTranslations("brief");
  const filesByPath = React.useMemo(() => indexFilesByPath(files), [files]);

  // path -> open. Initialized lazily from the first Smart Diff snapshot, then
  // ONLY grown with genuinely-new paths on later renders (e.g. a refetch
  // after a new review finishes) — never reset wholesale, or every card
  // would slam shut/reopen on each poll (see client/INSIGHTS.md's
  // FindingsPanel.focusIdx bug for the same trap).
  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of smartDiff.groups) for (const f of g.files) init[f.path] = shouldStartOpen(f, g.role);
    return init;
  });
  const knownPaths = React.useRef<Set<string>>(new Set(Object.keys(openMap)));

  const newlySeen: Array<{ path: string; open: boolean }> = [];
  for (const g of smartDiff.groups) {
    for (const f of g.files) {
      if (!knownPaths.current.has(f.path)) newlySeen.push({ path: f.path, open: shouldStartOpen(f, g.role) });
    }
  }
  if (newlySeen.length > 0) {
    // React-sanctioned "adjust state during render" pattern: merge only the
    // new keys in, guarded so it settles after one extra render.
    for (const item of newlySeen) knownPaths.current.add(item.path);
    setOpenMap((prev) => {
      const next = { ...prev };
      for (const item of newlySeen) if (!(item.path in next)) next[item.path] = item.open;
      return next;
    });
  }

  const toggle = (path: string) => setOpenMap((prev) => ({ ...prev, [path]: !prev[path] }));

  const jumpToFirstFinding = (file: SmartDiffFile) => {
    const line = file.finding_lines[0];
    if (line == null) return;
    setOpenMap((prev) => ({ ...prev, [file.path]: true }));
    window.setTimeout(() => scrollToFinding(`${fileAnchorId(file.path)}-L${line}`), 0);
  };

  const openFinding = (file: SmartDiffFile, findingId: string | undefined) => {
    if (onOpenFinding && findingId) onOpenFinding(findingId);
    else jumpToFirstFinding(file);
  };

  const hasGroups = smartDiff.groups.some((g) => g.files.length > 0);
  if (!hasGroups) {
    return <div style={s.empty}>{t("smartDiff.empty")}</div>;
  }

  return (
    <div style={s.wrap}>
      {smartDiff.groups.map((group) => {
        if (group.files.length === 0) return null;
        const meta = ROLE_META[group.role];
        return (
          <div key={group.role} style={s.group}>
            <div style={s.groupHeader}>
              <span style={{ ...s.roleSquare, background: meta.color }} />
              <span style={s.roleLabel}>{t(meta.label)}</span>
              <span style={s.roleDescription}>{t(meta.description)}</span>
              <span style={s.groupCount} className="mono tnum">
                {t("smartDiff.filesCount", { count: group.files.length })}
              </span>
            </div>
            <div style={s.list}>
              {group.files.map((file) => {
                // Defensive: the SmartDiff can list a path `files` doesn't
                // have (e.g. a rename edge case) — skip rather than crash.
                const prFile = filesByPath.get(file.path);
                if (!prFile) return null;
                const hasFindings = file.finding_lines.length > 0;
                return (
                  <FileCard
                    key={file.path}
                    file={prFile}
                    commenting={commenting}
                    findingLines={file.finding_lines}
                    anchorPrefix={fileAnchorId(file.path)}
                    open={openMap[file.path] ?? shouldStartOpen(file, group.role)}
                    onToggleOpen={() => toggle(file.path)}
                    onFindingLineClick={
                      onOpenFinding
                        ? (line) => openFinding(file, findingIdAtLine(file, line))
                        : undefined
                    }
                    findingLineTitle={t("smartDiff.viewFinding")}
                    badge={
                      hasFindings ? (
                        <button
                          type="button"
                          aria-label={t("smartDiff.findingsCount", { count: file.finding_lines.length })}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Header badge stays an in-file jump: expand this
                            // card and scroll to its first flagged line. Only
                            // the per-line "View finding" button routes away.
                            jumpToFirstFinding(file);
                          }}
                          style={s.findingsBadge}
                        >
                          <Icon.AlertTriangle size={11} />
                          {t("smartDiff.findingsCount", { count: file.finding_lines.length })}
                        </button>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {smartDiff.split_suggestion.too_big && (
        <div style={s.splitCallout}>
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <div>
            <div style={s.splitTitle}>
              {t("smartDiff.splitSuggestion.title", { count: smartDiff.split_suggestion.total_lines })}
            </div>
            <ul style={s.splitList}>
              {smartDiff.split_suggestion.proposed_splits.map((split) => (
                <li key={split.name}>
                  <strong>{split.name}</strong> — {split.files.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
