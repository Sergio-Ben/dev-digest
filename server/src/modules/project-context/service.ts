import fs from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import { RepoRepository } from '../repos/repository.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type {
  DiscoveredDocument,
  DiscoverySummary,
  DocumentContent,
} from '@devdigest/shared';
import { discover } from './discovery.js';
import { readDocument, writeDocument } from './documents.js';

export interface ProjectContextList {
  documents: DiscoveredDocument[];
  summary: DiscoverySummary;
}

/**
 * T7 — project-context service. Orchestrates discovery, document I/O, and
 * `used_by_agents` enrichment. No HTTP, no raw SQL.
 */
export class ProjectContextService {
  private repoRepo: RepoRepository;

  constructor(private container: Container) {
    this.repoRepo = new RepoRepository(container.db);
  }

  /**
   * Discover all markdown documents in a repo's clone tree and enrich each
   * with `used_by_agents`: the count of workspace agents that have the path
   * in their `attached_doc_paths`.
   *
   * Clone availability: prefer an `fs.stat` check over relying on the nullable
   * `repos.clone_path` column — if the directory has been deleted from disk
   * the column may still contain a stale path. `discover()` handles
   * `cloneRoot === null` and a missing directory gracefully (returns
   * `clone_available: false`).
   */
  async listForRepo(workspaceId: string, repoId: string): Promise<ProjectContextList> {
    const repo = await this.repoRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Prefer fs.stat over relying on the nullable clone_path column.
    // If clone_path is set but the directory no longer exists on disk we treat
    // it as absent so discover() returns clone_available: false.
    let cloneRoot: string | null = null;
    if (repo.clonePath) {
      try {
        await fs.stat(repo.clonePath);
        cloneRoot = repo.clonePath;
      } catch {
        cloneRoot = null;
      }
    }

    const { documents, summary } = await discover(cloneRoot, this.container.tokenizer);

    // Enrich each document with the count of workspace agents that reference it.
    const agents = await this.container.agentsRepo.list(workspaceId);

    const enriched: DiscoveredDocument[] = documents.map((doc) => {
      const usedByAgents = agents.filter((a) =>
        (a.attachedDocPaths as string[]).includes(doc.path),
      ).length;
      return { ...doc, used_by_agents: usedByAgents };
    });

    return { documents: enriched, summary };
  }

  /**
   * Read a single document from the clone working tree.
   *
   * @throws {ValidationError} if the path is absolute, contains `..`, or
   *   resolves outside the clone root.
   * @throws {NotFoundError}   if the repo is not found.
   * @throws {Error}           if the file does not exist or is unreadable
   *   (callers map this to 404).
   */
  async readDocument(workspaceId: string, repoId: string, filePath: string): Promise<DocumentContent> {
    const repo = await this.repoRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const repoRef = { owner: repo.owner, name: repo.name };
    const text = await readDocument(this.container.git, repoRef, filePath);
    return { path: filePath, text };
  }

  /**
   * Write a document to the clone working tree.
   *
   * @throws {ValidationError} if the path is absolute, contains `..`, or
   *   resolves outside the clone root.
   * @throws {NotFoundError}   if the repo is not found.
   * @throws {Error}           if the parent directory does not exist or the
   *   file is not writable.
   */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    filePath: string,
    text: string,
  ): Promise<DocumentContent> {
    const repo = await this.repoRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const repoRef = { owner: repo.owner, name: repo.name };
    await writeDocument(this.container.git, repoRef, filePath, text);
    return { path: filePath, text };
  }
}
