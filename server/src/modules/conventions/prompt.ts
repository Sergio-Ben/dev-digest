import { z } from 'zod';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { SampledFile } from './sampler.js';

/**
 * The extraction schema. Its NAME is load-bearing: `schemaName:
 * 'ConventionExtraction'` is what `MockLLMProvider` keys its fixtures off
 * (`src/adapters/mocks.ts`), so renaming it silently breaks every test.
 */
export const ConventionExtraction = z.object({
  candidates: z.array(
    z.object({
      category: z.string(),
      rule: z.string(),
      evidence_path: z.string(),
      evidence_snippet: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/** Upper bound on what we ask for; the UI stays readable and cost bounded. */
export const MAX_CANDIDATES = 12;

export async function conventionsSystemPrompt(): Promise<string> {
  return renderPrompt('conventions.system.md', {
    maxCandidates: String(MAX_CANDIDATES),
  });
}

/**
 * The user message: the repo name plus every sampled file, each wrapped as
 * untrusted data (file contents are attacker-controlled in the general case —
 * a repo can contain a README that tells the model what to do).
 */
export function conventionsUserPrompt(repoFullName: string, samples: SampledFile[]): string {
  const files = samples
    .map((s) =>
      wrapUntrusted(
        s.path,
        s.truncated ? `${s.content}\n… [truncated]` : s.content,
      ),
    )
    .join('\n\n');

  return [
    `Repository: ${repoFullName}`,
    '',
    `Sampled files (${samples.length}) — the ONLY paths you may cite:`,
    samples.map((s) => `- ${s.path}`).join('\n'),
    '',
    'File contents:',
    files,
  ].join('\n');
}
