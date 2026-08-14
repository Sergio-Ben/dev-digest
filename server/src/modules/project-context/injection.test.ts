/**
 * Unit tests for injection.ts — resolveSpecPaths()
 *
 * AC-19: union of agent paths + loaded-skill paths is deduped (first-wins)
 * AC-21: order is deterministic — agent paths first, then loaded skills in load order
 */

import { describe, it, expect } from 'vitest';
import { resolveSpecPaths } from './injection.js';

describe('resolveSpecPaths()', () => {
  it('returns empty array when all inputs are empty', () => {
    // empty inputs must produce an empty result
    const result = resolveSpecPaths({ agentPaths: [], loadedSkills: [] });
    expect(result).toEqual([]);
  });

  it('returns only agent paths when no skills are loaded', () => {
    // agent paths with no skills — paths returned in agent order
    const result = resolveSpecPaths({
      agentPaths: ['a.md', 'b.md'],
      loadedSkills: [],
    });
    expect(result).toEqual(['a.md', 'b.md']);
  });

  it('returns only skill paths when agent has no attached docs', () => {
    // skill paths with no agent paths — paths returned in skill-load order
    const result = resolveSpecPaths({
      agentPaths: [],
      loadedSkills: [{ paths: ['c.md', 'd.md'] }],
    });
    expect(result).toEqual(['c.md', 'd.md']);
  });

  it('agent [a,b] + skill1 [b,c] + skill2 [a,d] → [a,b,c,d] (AC-19/AC-21)', () => {
    // first-wins deduplication: "a" appears in agent and skill2, "b" in agent and skill1
    // agent paths come first, then skill1 then skill2 in load order
    const result = resolveSpecPaths({
      agentPaths: ['a', 'b'],
      loadedSkills: [
        { paths: ['b', 'c'] },
        { paths: ['a', 'd'] },
      ],
    });
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('deduplicates exact string matches, first occurrence wins (AC-19)', () => {
    // "specs/arch.md" appears in agent AND skill1 — agent's occurrence wins (comes first)
    const result = resolveSpecPaths({
      agentPaths: ['specs/arch.md', 'docs/api.md'],
      loadedSkills: [
        { paths: ['specs/arch.md', 'docs/security.md'] },
      ],
    });
    // specs/arch.md deduped; all others kept; agent paths first
    expect(result).toEqual(['specs/arch.md', 'docs/api.md', 'docs/security.md']);
  });

  it('deterministic: multiple skills, each with multiple paths', () => {
    // skill1 [b,c], skill2 [a,d]: skill1 comes first in load order → b,c before a (new),d
    const result = resolveSpecPaths({
      agentPaths: ['a'],
      loadedSkills: [
        { paths: ['b', 'c'] },
        { paths: ['a', 'd'] },
      ],
    });
    // a from agent, then b, c from skill1, then d from skill2 (a already seen)
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a skill with empty paths array contributes nothing', () => {
    // skills with no attached docs should be silently skipped
    const result = resolveSpecPaths({
      agentPaths: ['x.md'],
      loadedSkills: [
        { paths: [] },
        { paths: ['y.md'] },
      ],
    });
    expect(result).toEqual(['x.md', 'y.md']);
  });

  it('preserves exact relative path strings (no normalisation)', () => {
    // path strings are treated as opaque — no normalisation
    const result = resolveSpecPaths({
      agentPaths: ['docs/sub/file.md'],
      loadedSkills: [{ paths: ['specs/another.md'] }],
    });
    expect(result).toEqual(['docs/sub/file.md', 'specs/another.md']);
  });
});
