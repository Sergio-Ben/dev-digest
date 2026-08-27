import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCase } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CaptureService } from './capture.service.js';

/**
 * T5 — capture-a-case-from-a-finding routes (Capability A).
 *
 *   POST /findings/:id/eval-case → turn a DECIDED finding (accepted or
 *   dismissed) into a frozen `eval_cases` row (AC-1..6, AC-40). An undecided
 *   finding is NOT an error — it's answered with a 200 "decide first" prompt
 *   so the UI can nudge the reviewer (AC-4); a successful capture returns 201
 *   with the created `EvalCase`. A repeat capture of an already-captured finding
 *   is idempotent — it returns 200 with the EXISTING case (`reason: 'exists'`)
 *   rather than creating a duplicate, so a page reload cannot double-add.
 *
 * Onion layer: presentation only — thin handler: getContext → one service
 * call → status + body. All derivation (must_find/must_not_flag, frozen
 * diff, workspace/agent verification, idempotency) lives in `CaptureService`.
 */
const CaptureCaseCreated = z.object({ created: z.literal(true), case: EvalCase });
const CaptureCaseExists = z.object({
  created: z.literal(false),
  reason: z.literal('exists'),
  case: EvalCase,
});
const CaptureCaseRejected = z.object({
  created: z.literal(false),
  reason: z.literal('undecided'),
  message: z.string(),
});
const CaptureCaseNotCreated = z.discriminatedUnion('reason', [
  CaptureCaseExists,
  CaptureCaseRejected,
]);

const captureRoutes: FastifyPluginAsync = async (appBase) => {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CaptureService(app.container);

  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        response: { 200: CaptureCaseNotCreated, 201: CaptureCaseCreated },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.createCaseFromFinding(workspaceId, req.params.id);
      reply.status(result.created ? 201 : 200);
      return result;
    },
  );
};

export default captureRoutes;
