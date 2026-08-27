import type { FastifyPluginAsync } from 'fastify';
import captureRoutes from './capture.routes.js';
import runRoutes from './run.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import casesRoutes from './cases.routes.js';

/**
 * T4 — evals module index. Registers the eval pipeline's sub-route plugins
 * (each owns its own path prefix internally, same shape as every other
 * module's `routes.ts`):
 *
 *   capture.routes.ts   → capture an eval case from a review finding (T5)
 *   run.routes.ts        → run-executor + batch run across an agent's cases (T6)
 *   dashboard.routes.ts  → dashboard/history/compare (T7)
 *   cases.routes.ts      → eval case CRUD + single-case run (T8)
 *
 * The four files above are currently STUBS (no-op Fastify plugins) — T5-T8
 * overwrite them wholesale with their real routes. This file only wires the
 * registry; it holds no route logic of its own.
 */
const evalsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(captureRoutes);
  await app.register(runRoutes);
  await app.register(dashboardRoutes);
  await app.register(casesRoutes);
};

export default evalsRoutes;
