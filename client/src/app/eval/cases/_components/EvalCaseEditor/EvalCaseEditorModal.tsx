"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, FormField, TextInput, Toggle, Skeleton } from "@devdigest/ui";
import type { EvalCase, EvalRunResult } from "@devdigest/shared";
import { useAgent, useCreateEvalCase, useUpdateEvalCase, useRunEvalCase } from "@/lib/hooks";
import { useEvalCase } from "../../_hooks/useEvalCase";
import { ExpectedOutputField } from "./ExpectedOutputField";
import { InputTabs, type InputTabKey } from "./InputTabs";
import { RunResultFooter } from "./RunResultFooter";
import { insertFindingSkeleton, parseExpectedOutput, parseFilesInput, readInputMeta } from "./helpers";

const MODAL_WIDTH = 880;

/**
 * Focusable-element query used by both the initial-focus and Tab-cycling
 * focus-trap logic below — visible, non-disabled interactive elements only.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard accessibility for the modal (focus trap, Esc-to-close, a labelled
 * dialog) implemented locally rather than in the shared `Modal` primitive
 * (`@devdigest/ui`) — that component is used across the app by other
 * concurrently-developed features and is outside this task's owned paths, so
 * it isn't touched here. `Modal` already renders `role="dialog"
 * aria-modal="true"`; this hook adds an `aria-label` once mounted, moves
 * initial focus inside the dialog, and traps Tab/Shift+Tab within it.
 */
function useModalA11y(onClose: () => void, label: string) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = wrapRef.current;
    if (!container) return;
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog && !dialog.getAttribute("aria-label")) {
      dialog.setAttribute("aria-label", label);
    }
    const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const container = wrapRef.current;
    if (!container) return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null,
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { wrapRef, onKeyDown };
}

/**
 * Eval case editor modal (Capability B, AC-10/AC-11) — create or edit one
 * eval case for an agent as a centered dialog: LEFT column is Name + the
 * frozen Diff/PR-meta input tabs, RIGHT column is the expected-output JSON
 * editor with a live valid/invalid indicator (blocks Save) and a "+ Finding
 * skeleton" template button, and the footer carries the per-case run result,
 * a "Run on save" toggle, and Cancel / Run case / Save.
 *
 * `caseId` is fetched here (via `useEvalCase`) rather than requiring the
 * caller to already hold the full `EvalCase` — so both the Evals tab (which
 * has the list loaded) and a per-agent detail page opening straight from a
 * run record can use the same component.
 */
export function EvalCaseEditorModal({
  agentId,
  caseId = null,
  onClose,
  onSaved,
}: {
  agentId: string;
  /** `null`/`undefined` = create a new case; otherwise edit this case id. */
  caseId?: string | null;
  onClose: () => void;
  onSaved?: (evalCase: EvalCase) => void;
}) {
  const t = useTranslations("eval");
  const { data: agent } = useAgent(agentId);
  const { data: initialCase, isLoading } = useEvalCase(caseId);
  const { wrapRef, onKeyDown } = useModalA11y(onClose, t("caseEditor.newCase"));

  if (caseId && isLoading) {
    return (
      <div ref={wrapRef} onKeyDown={onKeyDown}>
        <Modal width={MODAL_WIDTH} onClose={onClose}>
          <div style={{ padding: 24 }}>
            <Skeleton height={24} width={240} />
            <div style={{ marginTop: 16 }}>
              <Skeleton height={200} />
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <EvalCaseEditorModalBody
      key={initialCase?.id ?? "new"}
      agentId={agentId}
      agentName={agent?.name}
      initialCase={caseId ? initialCase : undefined}
      onClose={onClose}
      onSaved={onSaved}
      wrapRef={wrapRef}
      onKeyDown={onKeyDown}
    />
  );
}

function EvalCaseEditorModalBody({
  agentId,
  agentName,
  initialCase,
  onClose,
  onSaved,
  wrapRef,
  onKeyDown,
}: {
  agentId: string;
  agentName?: string;
  initialCase?: EvalCase;
  onClose: () => void;
  onSaved?: (evalCase: EvalCase) => void;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const t = useTranslations("eval");
  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase();

  const meta = readInputMeta(initialCase?.input_meta);

  const [caseId, setCaseId] = useState<string | null>(initialCase?.id ?? null);
  const [name, setName] = useState(initialCase?.name ?? "");
  const [inputTab, setInputTab] = useState<InputTabKey>("diff");
  const [diff, setDiff] = useState(initialCase?.input_diff ?? "");
  const [filesText, setFilesText] = useState(
    JSON.stringify(initialCase?.input_files ?? [], null, 2),
  );
  const [prTitle, setPrTitle] = useState(meta.title);
  const [prBody, setPrBody] = useState(meta.body);
  const [expectedText, setExpectedText] = useState(
    JSON.stringify(initialCase?.expected_output ?? [], null, 2),
  );
  const [runOnSave, setRunOnSave] = useState(false);
  const [lastRun, setLastRun] = useState<EvalRunResult | null>(null);

  // Derived, not stored: recompute validity from the raw text every render
  // (react-best-practices "derive, don't store" — AC-10 needs this LIVE).
  const { data: parsedExpected } = parseExpectedOutput(expectedText);
  const isValid = parsedExpected !== null;

  const isSaving = createCase.isPending || updateCase.isPending;
  const isRunning = runCase.isPending;
  const canSave = isValid && name.trim().length > 0 && !isSaving;

  function triggerRun(id: string) {
    runCase.mutate({ id, agentId }, { onSuccess: (result) => setLastRun(result) });
  }

  function handleSave() {
    if (!canSave || !parsedExpected) return;
    const patch = {
      name: name.trim(),
      input_diff: diff,
      input_files: parseFilesInput(filesText),
      input_meta: { title: prTitle, body: prBody },
      expected_output: parsedExpected,
    };
    if (caseId) {
      updateCase.mutate(
        { id: caseId, patch },
        {
          onSuccess: (updated) => {
            onSaved?.(updated);
            if (runOnSave) triggerRun(updated.id);
          },
        },
      );
    } else {
      createCase.mutate(
        { agentId, input: { owner_kind: "agent", owner_id: agentId, ...patch } },
        {
          onSuccess: (created) => {
            setCaseId(created.id);
            onSaved?.(created);
            if (runOnSave) triggerRun(created.id);
          },
        },
      );
    }
  }

  const title = name.trim() ? t("caseEditor.caseTitle", { name: name.trim() }) : t("caseEditor.newCase");
  const subtitle = agentName ? t("caseEditor.modalSubtitle", { agent: agentName }) : undefined;

  return (
    <div ref={wrapRef} onKeyDown={onKeyDown}>
      <Modal
        width={MODAL_WIDTH}
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <RunResultFooter result={lastRun} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Toggle on={runOnSave} onChange={setRunOnSave} />
              <span style={{ fontSize: 13, color: "var(--text-secondary)", flex: 1 }}>
                {t("caseEditor.runOnSave")}
              </span>
              <Button kind="ghost" onClick={onClose}>
                {t("caseEditor.cancel")}
              </Button>
              {caseId && (
                <Button
                  kind="secondary"
                  icon="Play"
                  loading={isRunning}
                  disabled={isRunning}
                  onClick={() => triggerRun(caseId)}
                >
                  {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
                </Button>
              )}
              <Button kind="primary" icon="Check" loading={isSaving} disabled={!canSave} onClick={handleSave}>
                {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
              </Button>
            </div>
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: 24 }}>
          <div>
            <FormField label={t("caseEditor.nameLabel")} required>
              <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
            </FormField>

            <InputTabs
              tab={inputTab}
              onTab={setInputTab}
              diff={diff}
              onDiff={setDiff}
              files={filesText}
              onFiles={setFilesText}
              title={prTitle}
              onTitle={setPrTitle}
              body={prBody}
              onBody={setPrBody}
            />
          </div>

          <div>
            <ExpectedOutputField
              value={expectedText}
              onChange={setExpectedText}
              isValid={isValid}
              onInsertSkeleton={() => setExpectedText(insertFindingSkeleton(expectedText))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
