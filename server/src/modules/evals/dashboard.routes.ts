import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalBatchRow, EvalCompareResult, EvalDashboard, EvalDashboardCross } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalDashboardService } from './dashboard.service.js';

/**
 * T7 — dashboard/history/compare/cross-agent + run-all routes. This file
 * OVERWRITES the T4 no-op stub wholesale (see the stub's own doc comment).
 *
 *   GET  /agents/:id/eval-dashboard        → per-agent metrics + history (AC-30/31)
 *   GET  /agents/:id/eval-compare?a=&b=    → two-batch compare (AC-32..35)
 *   GET  /eval/dashboard                    → cross-agent dashboard (AC-36..38)
 *   POST /eval/run-all                      → bounded run-all (AC-39, AC-43)
 *
 * The GET routes are read-only aggregation over already-persisted `eval_runs`
 * rows — no LLM call, so no rate limit. `POST /eval/run-all` is the only
 * LLM-invoking route here (it fans out to one batch — many LLM calls — per
 * eligible agent) and is both bounded (service-level concurrency limiter) AND
 * rate-limited, same `config.rateLimit` mechanism as `POST /agents/:id/eval-runs`
 * (`run.routes.ts`) and `POST /pulls/:id/review`.
 */

const EvalDashboardResponse = EvalDashboard.extend({ batches: z.array(EvalBatchRow) });

const CompareQuery = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
});

export default async function dashboardRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/agents/:id/eval-dashboard',
    {
      schema: {
        params: IdParams,
        response: { 200: EvalDashboardResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalDashboardService(app.container);
      return service.getAgentDashboard(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval-compare',
    {
      schema: {
        params: IdParams,
        querystring: CompareQuery,
        response: { 200: EvalCompareResult },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalDashboardService(app.container);
      return service.compareBatches(workspaceId, req.params.id, req.query.a, req.query.b);
    },
  );

  app.get(
    '/eval/dashboard',
    {
      schema: { response: { 200: EvalDashboardCross } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalDashboardService(app.container);
      return service.getCrossAgentDashboard(workspaceId);
    },
  );

  app.post(
    '/eval/run-all',
    {
      schema: { response: { 200: z.array(EvalBatchRow) } },
      // Fans out to one full batch (many LLM calls) PER eligible agent — tight
      // limit; the service itself also bounds concurrency (AC-43).
      config: { rateLimit: { max: 2, timeWindow: '5 minutes' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new EvalDashboardService(app.container);
      return service.runAll(workspaceId);
    },
  );
}
