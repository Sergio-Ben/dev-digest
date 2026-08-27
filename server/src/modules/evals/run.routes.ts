import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { runBatchForAgent } from './run-executor.js';

/**
 * T6 — run-executor route.
 *
 *   POST /agents/:id/eval-runs → run the agent against EVERY eval case it
 *   owns through the real reviewer-core engine, producing one `eval_runs` row
 *   per case sharing a fresh `batch_id` (Capability C). Rate-limited: a batch
 *   can fan out to many LLM calls (one per case), same per-route
 *   `config.rateLimit` mechanism as `POST /pulls/:id/review`
 *   (`modules/reviews/routes.ts`).
 *
 * Response shape is `{ batch: EvalRun; runs: EvalRunRecord[] }` — matches the
 * client's `useRunAgentEvals` hook (`client/src/lib/hooks/evals.ts`).
 */
export default async function runRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams },
      // Tight per-route limit: each call fans out to one LLM call per eval
      // case, so a batch is far more expensive than a single review run.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return runBatchForAgent(app.container, app.container.evalsRepo, workspaceId, req.params.id);
    },
  );
}
