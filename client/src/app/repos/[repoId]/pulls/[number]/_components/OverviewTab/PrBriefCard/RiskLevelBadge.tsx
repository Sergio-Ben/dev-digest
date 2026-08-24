"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { BriefRiskLevel } from "@devdigest/shared";
import { RISK_LEVEL_META } from "./constants";

interface RiskLevelBadgeProps {
  level: BriefRiskLevel;
}

/**
 * The PR Brief's overall risk level, shown as text + colour — never colour
 * alone (AC-34). The badge's only child is the level word, so its rendered
 * text content already IS its accessible name; no separate `aria-label`
 * is needed to satisfy "the level's text label is in the accessible name".
 */
export function RiskLevelBadge({ level }: RiskLevelBadgeProps) {
  const t = useTranslations("brief");
  const meta = RISK_LEVEL_META[level];
  return (
    <Badge color={meta.color} bg={meta.bg}>
      {t(meta.label)}
    </Badge>
  );
}
