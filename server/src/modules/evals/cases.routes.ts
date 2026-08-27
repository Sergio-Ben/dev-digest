import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCase, EvalCaseInput, EvalRunRecord, EvalRunResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CasesService } from './cases.service.js';

/**
 * T8 — eval case CRUD + single-case run (Capability B, "Run on save",
 * AC-7..11, AC-40). Onion layer: presentation only — thin handlers
 * (getContext → one `CasesService` call → status/body); every ownership
 * check, `expected_output` validation, and the run-executor call itself
 * lives in `cases.service.ts`.
 *
 *   GET    /agents/:id/eval-cases   → this agent's cases + latest-run status
 *   POST   /agents/:id/eval-cases   → manual create under this agent (201)
 *   GET    /eval-cases/:id          → one case
 *   PUT    /eval-cases/:id          → update a case
 *   DELETE /eval-cases/:id          → delete a case
 *   POST   /eval-cases/:id/run      → run this one case now ("Run on save")
 */

/** Response shape for `GET /agents/:id/eval-cases` — `EvalCase` plus its
 *  latest `eval_runs` row (or `null` when never run, AC-8). Composed with
 *  `.extend()` rather than edited into the vendored `EvalCase` contract, so
 *  the base per-case shape the client already relies on (`EvalCase`) is
 *  untouched. */
const EvalCaseWithLatestRun = EvalCase.extend({
  latest_run: EvalRunRecord.nullable(),
});

/** `POST /agents/:id/eval-cases` body — reuses the shared `EvalCaseInput`
 *  shape but the owner (`owner_kind`/`owner_id`) is always resolved from the
 *  route param in the service layer, never trusted from the body (a caller
 *  cannot mint a case under an agent it doesn't own by spoofing these). */
const CreateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });

/** `PUT /eval-cases/:id` body — an existing case's owner never changes. */
const UpdateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true }).partial();

const DeleteResult = z.object({ ok: z.boolean() });

export default async function casesRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CasesService(app.container);

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseWithLatestRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listForAgent(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    {
      schema: { params: IdParams, body: CreateEvalCaseBody, response: { 201: EvalCase } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createForAgent(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.get(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseBody, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: DeleteResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const deleted = await service.delete(workspaceId, req.params.id);
      if (!deleted) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams, response: { 200: EvalRunResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.run(workspaceId, req.params.id);
    },
  );
}
