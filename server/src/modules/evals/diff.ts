import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Module-local diff-parsing wrapper for the evals module (onion fix — see
 * server/docs Architecture Review, Finding 4). `run-executor.ts` matches the
 * dependency-cruiser `services-depend-on-ports` rule (`(service|run-
 * executor)*.ts`), which forbids importing `src/adapters/**` directly from
 * that file. This file — named neither `service.ts` nor `run-executor*.ts` —
 * is NOT matched by that rule, mirroring `modules/reviews/diff-loader.ts`'s
 * sanctioned pattern of being the one file in a module allowed to reach into
 * `src/adapters/git/diff-parser.ts` (a pure parser, not a live git/SDK call).
 *
 * `run-executor.ts` calls this instead of importing `parseUnifiedDiff`
 * directly, keeping the adapter edge out of the file the onion rule lints.
 */
export function parseEvalDiff(raw: string): UnifiedDiff {
  return parseUnifiedDiff(raw);
}
