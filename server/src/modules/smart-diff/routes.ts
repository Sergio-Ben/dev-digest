import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiff } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * smart-diff module routes.
 *
 * GET /pulls/:id/smart-diff → SmartDiff (role-grouped files + split suggestion)
 *
 * Onion layer: presentation — thin handler: getContext → one service call →
 * reply. No business logic here (see `service.ts` / `helpers.ts` /
 * `classifier.ts`).
 *
 * No rate limit: unlike `intent`, this route makes NO LLM call and NO
 * outbound network call — it only reads already-persisted `pr_files` +
 * `findings` and derives the response with pure, cheap functions, so there's
 * no per-request cost to protect against.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new SmartDiffService(app.container);
      return service.build(workspaceId, req.params.id);
    },
  );
}
