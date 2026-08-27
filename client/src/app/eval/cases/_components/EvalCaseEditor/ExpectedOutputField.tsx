"use client";

import { useTranslations } from "next-intl";
import { FormField, Textarea, Badge, Button } from "@devdigest/ui";

/**
 * Expected-output JSON editor + a LIVE valid/invalid indicator (AC-10), plus
 * a "+ Finding skeleton" button that inserts a template finding object into
 * the JSON text. Validity is computed by the caller during render (derive,
 * don't store) and passed in as `isValid` — this component is otherwise
 * presentational; skeleton insertion is delegated via `onInsertSkeleton`.
 */
export function ExpectedOutputField({
  value,
  onChange,
  isValid,
  onInsertSkeleton,
}: {
  value: string;
  onChange: (v: string) => void;
  isValid: boolean;
  onInsertSkeleton: () => void;
}) {
  const t = useTranslations("eval");
  return (
    <FormField
      label={t("caseEditor.expectedOutput")}
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge
            icon={isValid ? "Check" : "X"}
            color={isValid ? "var(--ok)" : "var(--crit)"}
            bg={isValid ? "var(--ok-bg)" : "var(--crit-bg)"}
          >
            {isValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
          </Badge>
          <Button kind="ghost" size="sm" icon="Plus" onClick={onInsertSkeleton}>
            {t("caseEditor.findingSkeleton")}
          </Button>
        </div>
      }
    >
      <Textarea mono rows={10} value={value} onChange={onChange} />
    </FormField>
  );
}
