import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SaveDocumentBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

/**
 * T7 — project-context module routes.
 *   GET  /repos/:id/project-context                      → { documents, summary }
 *   GET  /repos/:id/project-context/document?path=...    → DocumentContent
 *   PUT  /repos/:id/project-context/document             → DocumentContent
 */

const DocumentPathQuery = z.object({
  path: z.string().min(1),
});

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  /** List all discovered markdown documents for a repo. */
  app.get(
    '/repos/:id/project-context',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listForRepo(workspaceId, req.params.id);
    },
  );

  /** Preview a single document by repo-relative path (query string). */
  app.get(
    '/repos/:id/project-context/document',
    { schema: { params: IdParams, querystring: DocumentPathQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await service.readDocument(workspaceId, req.params.id, req.query.path);
      } catch (err) {
        // ValidationError → 400 (path-guard violation)
        if (err instanceof ValidationError) throw err;
        // File not found / unreadable → 404
        throw new NotFoundError('Document not found');
      }
    },
  );

  /** Save (overwrite) a document in the clone working tree. */
  app.put(
    '/repos/:id/project-context/document',
    { schema: { params: IdParams, body: SaveDocumentBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await service.saveDocument(
          workspaceId,
          req.params.id,
          req.body.path,
          req.body.text,
        );
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw err;
      }
    },
  );
}
