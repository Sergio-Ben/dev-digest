"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Badge } from "@devdigest/ui";
import { useBrief } from "@/lib/hooks/brief";
import { ReviewFocusList } from "./ReviewFocusList";

interface ReviewFocusCardProps {
  prId: string | number | null;
  onOpenFileLine: (file: string, line: number) => void;
}

/**
 * Standalone "Review focus — read these first" card (AC-36), rendered below
 * the Intent/Blast grid rather than nested inside `PrBriefCard` — a reviewer
 * scans risk level → intent/blast context → the read-these-first list, in
 * that reading order. Reuses `useBrief(prId)`; React Query dedupes the
 * identical query key against `PrBriefCard`'s own call, so this costs no
 * extra request. Renders nothing while loading/erroring/empty — `PrBriefCard`
 * already surfaces those states, so a second skeleton/error here would only
 * be noise.
 */
export function ReviewFocusCard({ prId, onOpenFileLine }: ReviewFocusCardProps) {
  const t = useTranslations("brief");
  const { data } = useBrief(prId);

  const items = data?.brief.review_focus ?? [];
  if (items.length === 0) return null;

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel
        icon="ListChecks"
        right={<Badge>{items.length}</Badge>}
      >
        {t("reviewFocus.heading")}
      </SectionLabel>
      <ReviewFocusList items={items} onOpenFileLine={onOpenFileLine} />
    </Card>
  );
}
