/**
 * The three ways to run a case. Each composes runtime + artifacts; nothing here talks to the
 * SDK directly.
 *
 *   skillTask / agentTask — inject the artifact's content as system prompt, load NO on-disk
 *     config → measures the artifact's CONTENT in isolation.
 *   workflowTask — load the real on-disk harness (settingSources:["project"]) → measures the
 *     SYSTEMIC effect: does a skill activate, does a subagent dispatch, does CLAUDE.md matter.
 */

import { IS_BASELINE, WORKFLOW_ALLOWED_TOOLS } from "./config.js";
import { runClaude, type RunOptions } from "./runtime/run-claude.js";
import { skillContent, agentContent } from "./artifacts/load.js";

/**
 * Run a prompt with a skill's content injected (the 'candidate' condition). Under
 * EVAL_CONFIG=baseline the artifact is NOT injected — that is the benchmark's without-skill
 * baseline, i.e. the raw model, used to measure the skill's lift.
 */
export function skillTask(prompt: string, skillName: string, opts: RunOptions = {}) {
  const systemPrompt = IS_BASELINE ? undefined : skillContent(skillName);
  return runClaude(prompt, { ...opts, systemPrompt });
}

/** Run a prompt with a subagent's definition injected as the system prompt (baseline: none). */
export function agentTask(prompt: string, agentName: string, opts: RunOptions = {}) {
  const systemPrompt = IS_BASELINE ? undefined : agentContent(agentName);
  return runClaude(prompt, { ...opts, systemPrompt });
}

/**
 * Run a prompt against the REAL on-disk harness (CLAUDE.md + project skills/agents loaded).
 * Use for workflow-level evals: skill activation, subagent dispatch, CLAUDE.md effect.
 * Ignores EVAL_CONFIG — the workflow tier has its own control-vs-treatment design.
 *
 * Safety: keep allowedTools a read-only allow-list (no Bash/Write/Edit) — a fresh session
 * with bypassPermissions could otherwise take real actions in the repo.
 */
export function workflowTask(prompt: string, opts: RunOptions = {}) {
  return runClaude(prompt, {
    allowedTools: WORKFLOW_ALLOWED_TOOLS,
    ...opts,
    settingSources: ["project"],
  });
}
