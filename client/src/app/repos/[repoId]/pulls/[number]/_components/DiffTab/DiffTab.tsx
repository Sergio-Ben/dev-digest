"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/contexts/toast";
import type { PrFile } from "@devdigest/shared";

type DiffOrder = "smart" | "original";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("brief");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order by default; Original order renders the plain DiffViewer.
  const [order, setOrder] = React.useState<DiffOrder>("smart");
  const { data: smartDiff, isLoading: smartDiffLoading, isError: smartDiffError } = useSmartDiff(prId);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // Smart order falls back to the plain DiffViewer while loading is NOT the
  // right call (that would flash unsorted diffs then reflow) — show a
  // skeleton instead; but on error or an empty Smart Diff, fall back so the
  // tab is never left blank.
  const hasSmartGroups = !!smartDiff && smartDiff.groups.some((g) => g.files.length > 0);
  let diffArea: React.ReactNode;
  if (order === "original") {
    diffArea = <DiffViewer files={files} commenting={commenting} />;
  } else if (smartDiffLoading) {
    diffArea = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={110} />
        <Skeleton height={110} />
        <Skeleton height={110} />
      </div>
    );
  } else if (smartDiffError || !smartDiff || !hasSmartGroups) {
    diffArea = <DiffViewer files={files} commenting={commenting} />;
  } else {
    diffArea = <SmartDiffViewer smartDiff={smartDiff} files={files} commenting={commenting} />;
  }

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div role="group" aria-label={t("smartDiff.orderToggleLabel")} style={{ display: "flex", gap: 4 }}>
              <Button kind="tertiary" size="sm" active={order === "smart"} onClick={() => setOrder("smart")}>
                {t("smartDiff.order.smart")}
              </Button>
              <Button kind="tertiary" size="sm" active={order === "original"} onClick={() => setOrder("original")}>
                {t("smartDiff.order.original")}
              </Button>
            </div>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {diffArea}
    </section>
  );
}
