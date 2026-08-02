/* CreateSkillModal — merge the accepted conventions into one skill.

   The body is GENERATED server-side (GET …/conventions/skill-draft) and then
   fully editable here; the server saves exactly what is submitted, so a user
   edit is never silently regenerated. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  ErrorState,
  FormField,
  Modal,
  SelectInput,
  Skeleton,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import {
  useConventionSkillDraft,
  useCreateSkillFromConventions,
} from "@/lib/hooks/conventions";
import { BODY_ROWS, DEFAULT_TYPE, MODAL_WIDTH, TYPE_OPTIONS, estimateTokens } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  repoName,
  acceptedCount,
  onClose,
}: {
  repoId: string | null;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const draft = useConventionSkillDraft(repoId, true);
  const create = useCreateSkillFromConventions(repoId);
  const { data: agents } = useAgents();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [enabled, setEnabled] = React.useState(true);
  const [agentId, setAgentId] = React.useState("");

  // Seed ONCE. A refetch must not clobber what the user has typed.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !draft.data) return;
    seeded.current = true;
    setName(draft.data.name);
    setDescription(draft.data.description);
    setBody(draft.data.body);
  }, [draft.data]);

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim(),
      description,
      body,
      enabled,
      type,
      ...(agentId ? { agent_id: agentId } : {}),
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={name || draft.data?.name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={submit}
            disabled={create.isPending || !name.trim() || !body.trim()}
          >
            {create.isPending ? t("modal.creating") : t("modal.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {draft.isLoading && <Skeleton height={280} />}
        {draft.isError && <ErrorState body={t("modal.loadError")} onRetry={() => draft.refetch()} />}
        {!draft.isLoading && !draft.isError && (
          <>
            <div style={s.banner}>
              {t("modal.banner", { count: acceptedCount, repo: repoName })}
            </div>

            <FormField label={t("modal.name")} required>
              <TextInput value={name} onChange={setName} />
            </FormField>
            <FormField label={t("modal.description")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("modal.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={TYPE_OPTIONS}
              />
            </FormField>
            <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
              <div style={s.enabledRow}>
                <Toggle on={enabled} onChange={setEnabled} size={16} />
              </div>
            </FormField>
            <FormField
              label={t("modal.body")}
              required
              right={
                <span style={s.tokens}>
                  {t("modal.bodyTokens", { count: estimateTokens(body) })}
                </span>
              }
            >
              <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
            </FormField>
            <FormField label={t("modal.agent")}>
              <SelectInput
                value={agentId}
                mono={false}
                onChange={setAgentId}
                options={[
                  { value: "", label: t("modal.agentNone") },
                  ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
