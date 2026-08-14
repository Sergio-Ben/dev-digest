/**
 * Run-time spec-path resolver for the project-context injection pipeline.
 *
 * AC-19: the union of agent paths + loaded-skill paths is deduped by exact
 * repo-relative path string, keeping the FIRST occurrence.
 * AC-21: order is deterministic — agent paths first (in given order), then each
 * loaded skill in load order with its paths in given order.
 *
 * This is a pure function with zero I/O. It trusts that `loadedSkills` has
 * already been filtered to only enabled/loaded skills by the caller (T10).
 */

/**
 * Build the ordered, deduped list of repo-relative spec paths to inject.
 *
 * Order:
 *   1. Agent paths (in the order they appear in `agentPaths`)
 *   2. For each loaded skill (in load order), its paths (in given order)
 *
 * Deduplication: exact string match; the FIRST occurrence wins and all later
 * occurrences of the same path are silently dropped.
 *
 * @param input.agentPaths    Ordered repo-relative paths attached to the agent.
 * @param input.loadedSkills  Enabled skills in load order, each carrying their
 *                            ordered attached paths.
 * @returns Deduped, ordered list of repo-relative paths. Empty array when all
 *          inputs are empty.
 */
export function resolveSpecPaths(input: {
  agentPaths: string[];
  loadedSkills: { paths: string[] }[];
}): string[] {
  const { agentPaths, loadedSkills } = input;

  const seen = new Set<string>();
  const result: string[] = [];

  for (const p of agentPaths) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }

  for (const skill of loadedSkills) {
    for (const p of skill.paths) {
      if (!seen.has(p)) {
        seen.add(p);
        result.push(p);
      }
    }
  }

  return result;
}
