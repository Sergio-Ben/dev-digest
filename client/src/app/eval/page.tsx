import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (cross-agent Eval Dashboard). Thin route entry — the view and
   its sub-components are colocated under _components/EvalDashboardView. */
export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
