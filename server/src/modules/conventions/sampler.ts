import type { Container } from '../../platform/container.js';
import { CONFIG_FILES, MAX_FILE_BYTES, SAMPLE_FILE_COUNT } from './constants.js';

/**
 * File sampling for the conventions extractor.
 *
 * Deliberately NO model call: which files to read is decided by fixed config
 * globs plus repo-intel's rank ordering. One extraction = exactly one
 * `completeStructured`.
 */

export interface SampledFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface SampleSet {
  repoFullName: string;
  files: SampledFile[];
}

/**
 * Read the config files and the top-ranked source files for `repoId`.
 *
 * Degrades rather than throws: an unreadable file is skipped, and an unindexed
 * repo (repo-intel returns `[]`) yields configs only. The caller decides what
 * an empty sample set means — the service turns it into a user-facing error.
 */
export async function collectSamples(
  container: Container,
  workspaceId: string,
  repoId: string,
): Promise<SampleSet | null> {
  const repo = await container.conventionsRepo.getRepo(workspaceId, repoId);
  if (!repo) return null;

  const ref = { owner: repo.owner, name: repo.name };
  const rankedPaths = await container.repoIntel.getConventionSamples(
    repoId,
    SAMPLE_FILE_COUNT,
  );

  // Config files first: they carry the mechanical rules and are cheap.
  const paths = [...CONFIG_FILES, ...rankedPaths];
  const seen = new Set<string>();
  const files: SampledFile[] = [];

  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    let raw: string;
    try {
      raw = await container.git.readFile(ref, path);
    } catch {
      // Missing/unreadable file — `readFile` throws for absent paths, and most
      // repos have only a few of the CONFIG_FILES.
      continue;
    }
    // An empty read is "absent" too: some GitClient impls return '' instead of
    // throwing, and a blank file is worthless as evidence either way.
    if (raw.trim() === '') continue;
    files.push(truncate(path, raw));
  }

  return { repoFullName: repo.fullName, files };
}

function truncate(path: string, content: string): SampledFile {
  if (Buffer.byteLength(content, 'utf8') <= MAX_FILE_BYTES) {
    return { path, content, truncated: false };
  }
  // Byte-bounded slice; the tail is what gets dropped so line 1 stays line 1
  // (the verifier recomputes line numbers against THIS truncated content).
  const kept = Buffer.from(content, 'utf8').subarray(0, MAX_FILE_BYTES).toString('utf8');
  return { path, content: kept, truncated: true };
}
