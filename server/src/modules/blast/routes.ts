import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { BlastService } from "./service.js";

const BlastQuery = z.object({
  // Opt-in is the only thing that matters, so anything that isn't an explicit
  // "1"/"true" simply means off — `?summary=0` shouldn't be a 422.
  summary: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    "/pulls/:id/blast",
    { schema: { params: IdParams, querystring: BlastQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getForPr(req.params.id, workspaceId, {
        summary: req.query.summary,
      });
    },
  );
}
