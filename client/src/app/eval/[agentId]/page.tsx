/* /eval/:agentId — per-agent Eval Dashboard detail page (design-fidelity
   reconciliation: the cross-agent dashboard's agent cards link here). Thin
   route entry mirroring `app/eval/page.tsx` → `EvalDashboardView` — all data
   + layout live in the colocated `EvalAgentDetailView` client component. */

import { EvalAgentDetailView } from "./_components/EvalAgentDetailView";

interface PageProps {
  params: Promise<{ agentId: string }>;
}

export default async function EvalAgentDetailPage({ params }: PageProps) {
  const { agentId } = await params;
  return <EvalAgentDetailView agentId={agentId} />;
}
