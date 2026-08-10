"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PriorPr } from "@devdigest/shared";

interface PriorPrsAccordionProps {
  priorPrs: PriorPr[];
}

export function PriorPrsAccordion({ priorPrs }: PriorPrsAccordionProps) {
  const t = useTranslations("prReview.blastRadius");
  const [open, setOpen] = useState(false);

  if (priorPrs.length === 0) return null;

  return (
    <div className="shrink-0 rounded-lg border border-[var(--border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="bg-transparent border-none cursor-pointer w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <Icon.History size={13} className="shrink-0 text-[var(--text-muted)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {t("priorPrs")}
        </span>
        <span className="rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
          {priorPrs.length}
        </span>
        <Icon.ChevronDown
          size={14}
          className={`ml-auto shrink-0 text-[var(--text-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-1 px-3 pb-2.5 pt-0.5">
          {priorPrs.map((pr) => (
            <div
              key={pr.id}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
            >
              <span className="text-[var(--text-muted)] shrink-0">
                #{pr.number}
              </span>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {pr.title}
              </span>
              {pr.openedAt && (
                <span className="text-[var(--text-muted)] shrink-0 text-[11px]">
                  {relativeDate(pr.openedAt)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
