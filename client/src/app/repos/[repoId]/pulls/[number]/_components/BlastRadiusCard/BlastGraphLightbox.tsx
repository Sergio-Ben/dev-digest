"use client";

import React, { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";
import { BlastGraph } from "./BlastGraph";
import { BlastGraphLegend } from "./BlastGraphLegend";

interface BlastGraphLightboxProps {
  data: BlastRadiusResult;
  onClose: () => void;
}

export function BlastGraphLightbox({ data, onClose }: BlastGraphLightboxProps) {
  const t = useTranslations("prReview.blastRadius");
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  // ESC to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Measure container for BlastGraph dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setDims({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Theme tokens, not slate-900: the graph paints its boxes with
          --bg-elevated, which is white in the light palette and would have sat
          on a permanently dark backdrop. */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("graphTitle")}
        className="relative w-[90vw] h-[90vh] rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-3 z-10 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl cursor-pointer bg-transparent border-0 leading-none p-1"
          onClick={onClose}
          aria-label={t("closeGraph")}
        >
          ×
        </button>

        {/* Graph */}
        <div className="flex-1 overflow-hidden">
          {dims.width > 0 && (
            <BlastGraph data={data} width={dims.width} height={dims.height} />
          )}
        </div>

        <BlastGraphLegend className="absolute bottom-4 left-4" />
      </div>
    </div>,
    document.body,
  );
}
