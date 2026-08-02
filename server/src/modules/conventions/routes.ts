import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

const PatchConventionBody = z.object({
  rule: z.string().min(1).optional(),
  category: z.string().nullable().optional(),
  status: ConventionStatus.optional(),
});

const CreateConventionSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  type: SkillType.optional(),
  agent_id: z.string().uuid().optional(),
});

/**
 * Conventions extractor (Skills Lab).
 *   GET   /repos/:id/conventions              → { scan, candidates }
 *   POST  /repos/:id/conventions/extract      → re-scan (one model call)
 *   GET   /repos/:id/conventions/skill-draft  → generated skill draft
 *   POST  /repos/:id/conventions/skill        → create the skill (201)
 *   PATCH /conventions/:id                    → accept / reject / edit a rule
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  // Static sub-paths first — Fastify would otherwise try `extract` as a uuid
  // param on a `/conventions/:x` route (see skills/routes.ts:60).
  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillDraft(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateConventionSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const skill = await service.createSkill(workspaceId, req.params.id, {
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        body: body.body,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.agent_id !== undefined ? { agentId: body.agent_id } : {}),
      });
      reply.status(201);
      return skill;
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: PatchConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidate = await service.patch(workspaceId, req.params.id, req.body);
      if (!candidate) throw new NotFoundError('Convention not found');
      return candidate;
    },
  );
}
