import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

const BriefBody = z.object({ force: z.boolean().default(false) }).default({});

/**
 * brief module routes.
 *
 * GET  /pulls/:id/brief  → lazy compose-on-read (cache hit is a single row read)
 * POST /pulls/:id/brief  → force (or lazy) compose, `{ force: true }` bypasses the cache
 *
 * Onion layer: presentation — thin handlers: getContext → one service call → reply.
 * No business logic here. `BriefService` is constructed per-request (not once at
 * plugin-registration time) because it needs `req.log` for AC-43..AC-45, mirroring
 * `intent/routes.ts:25,40`.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // ---- GET: lazy compose-on-read -------------------------------------------
  app.get(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: BriefResponse } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BriefService(app.container, req.log);
      return service.getOrCompose(workspaceId, req.params.id);
    },
  );

  // ---- POST: compose, optionally forcing a bypass of the cache -------------
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: BriefBody, response: { 200: BriefResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BriefService(app.container, req.log);
      const result = await service.compose(workspaceId, req.params.id, { force: req.body.force });
      reply.status(200);
      return result;
    },
  );
}
