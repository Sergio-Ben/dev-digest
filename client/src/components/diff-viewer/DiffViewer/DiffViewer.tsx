/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { fileAnchorId, lineAnchorId, scrollToDiffLine } from "../anchors";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  focusFile,
  focusLine,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** `?file=&line=` deep-link target: expand that file and scroll to the line. */
  focusFile?: string | null;
  focusLine?: number | null;
}) {
  const t = useTranslations("shell");

  // Only the deep-link target is taken under control; every other card keeps
  // FileCard's own uncontrolled open/closed behaviour (see its `openProp !==
  // undefined` check). Kept as state, not derived, so the user can still
  // collapse the card they were sent to.
  const [openOverride, setOpenOverride] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!focusFile || focusLine == null) return;
    setOpenOverride((prev) => (prev[focusFile] ? prev : { ...prev, [focusFile]: true }));
    const id = window.setTimeout(
      () => scrollToDiffLine(lineAnchorId(focusFile, focusLine)),
      0,
    );
    return () => window.clearTimeout(id);
  }, [focusFile, focusLine]);

  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => {
        const controlled = f.path in openOverride;
        return (
          <FileCard
            key={f.path}
            file={f}
            commenting={commenting}
            anchorPrefix={fileAnchorId(f.path)}
            open={controlled ? openOverride[f.path] : undefined}
            onToggleOpen={
              controlled
                ? () => setOpenOverride((prev) => ({ ...prev, [f.path]: !prev[f.path] }))
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
