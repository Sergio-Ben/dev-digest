/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findingLines,
  anchorPrefix,
  open: openProp,
  onToggleOpen,
  badge,
  onFindingLineClick,
  findingLineTitle,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Smart Diff: new-side line numbers to highlight in this file. */
  findingLines?: number[];
  /** Smart Diff: when set, each rendered line gets `${anchorPrefix}-L${newNo}`
   *  as its DOM id, so a "N findings" badge can scroll to it. */
  anchorPrefix?: string;
  /** Smart Diff (controlled mode): when provided (even `false`), the parent
   *  owns open/closed state and `onToggleOpen` must be provided too. When
   *  `undefined`, falls back to the original uncontrolled behaviour. */
  open?: boolean;
  onToggleOpen?: () => void;
  /** Smart Diff: rendered in the header next to the +/− stat (e.g. a
   *  "N findings" chip). */
  badge?: React.ReactNode;
  /** Smart Diff: when set, every highlighted (finding) line gets a small
   *  "go to this finding" affordance calling back with its new-side number. */
  onFindingLineClick?: (line: number) => void;
  /** Label/tooltip for that affordance — passed in so this shared component
   *  stays free of route-specific copy. */
  findingLineTitle?: string;
}) {
  const t = useTranslations("shell");
  const [openState, setOpenState] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const toggleOpen = () => {
    if (isControlled) onToggleOpen?.();
    else setOpenState((o) => !o);
  };
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const findingSet = React.useMemo(() => new Set(findingLines ?? []), [findingLines]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={toggleOpen} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {badge}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const flagged = ln.newNo != null && findingSet.has(ln.newNo);
              return (
                <CodeLine
                  key={i}
                  ln={ln}
                  path={file.path}
                  threads={threadsForLine(ln, matched)}
                  commenting={commenting}
                  highlight={flagged}
                  anchorId={anchorPrefix && ln.newNo != null ? `${anchorPrefix}-L${ln.newNo}` : undefined}
                  onFindingClick={
                    flagged && onFindingLineClick && ln.newNo != null
                      ? () => onFindingLineClick(ln.newNo!)
                      : undefined
                  }
                  findingTitle={findingLineTitle}
                />
              );
            })
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
