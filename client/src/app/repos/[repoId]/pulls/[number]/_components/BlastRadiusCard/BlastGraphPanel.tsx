"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BlastRadiusResult } from "@devdigest/shared";
import { BlastGraph } from "./BlastGraph";

interface BlastGraphPanelProps {
  data: BlastRadiusResult;
  onExpand: () => void;
}

/**
 * The graph half of the Tree/Graph toggle. `BlastGraph` scales its diagram to
 * the box it is given, so it needs pixel dimensions up front: this measures its
 * own box first and only mounts the graph once it has a non-zero size.
 */
export function BlastGraphPanel({ data, onExpand }: BlastGraphPanelProps) {
  const t = useTranslations("prReview.blastRadius");
  const boxRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () =>
      setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden">
      {dims.width > 0 && dims.height > 0 && (
        <BlastGraph data={data} width={dims.width} height={dims.height} />
      )}
      <button
        type="button"
        onClick={onExpand}
        title={t("expandGraph")}
        aria-label={t("expandGraph")}
        className="absolute top-1.5 right-1.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-1 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Icon.ExternalLink size={12} />
      </button>
    </div>
  );
}
