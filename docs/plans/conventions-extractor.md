# Implementation plan — Conventions Extractor (Skills Lab)

Status: ready to implement · Owner: TBD · Related: `server/src/modules/repo-intel/`, `server/src/modules/skills/`, `client/src/app/skills/`

Hand this document to the implementing agent. Every file path and line number below was verified against the
working tree at the time of writing — re-check before editing, but do not re-derive the map.

---

## 0. Goal (user stories)

As a user I can:

1. Run a Conventions scan on a repository.
2. See every detected convention (rule + evidence file/line + code snippet + confidence).
3. Accept / reject an individual candidate.
4. Edit an individual candidate's rule text.
5. Open a "create skill" modal seeded from the accepted candidates.
6. Edit the generated skill body and its metadata (name, description, type, enabled) before saving.
7. Save the skill (optionally linking it to an agent) or cancel.

Non-goal for v1: multiple skills per scan. One merged `<repo>-conventions` skill. The data model does not
prevent adding that later (candidates are individually addressable).

Visual reference: two screenshots in the task — the Conventions list page and the
"Create skill from conventions" modal. Match layout and copy where the existing i18n file already has keys.

---

## 1. What already exists (do NOT re-create)

This feature was scaffolded ahead of time. Reuse all of it.

| Thing | Location |
|---|---|
| `conventions` table | `server/src/db/schema/knowledge.ts:31-42`, DDL `server/src/db/migrations/0000_init.sql:96-105` |
| `ConventionCandidate` Zod contract | `server/src/vendor/shared/contracts/knowledge.ts:172-180` (+ identical client copy) |
| Feature-model id `conventions` | `server/src/vendor/shared/contracts/platform.ts:73-79` (default `openai` / `gpt-5.4`) |
| `resolveFeatureModel(container, wsId, id)` | `server/src/modules/settings/feature-models.ts:51-57` |
| `repoIntel.getConventionSamples(repoId, n)` | `server/src/modules/repo-intel/service.ts:629-632` — returns **paths only**, junk-filtered |
| `skills.evidence_files` jsonb column + repo insert support | `server/src/db/schema/skills.ts:19`, `server/src/modules/skills/repository.ts:79` |
| Agent↔skill link mechanism | `agent_skills` table `server/src/db/schema/agents.ts:51-63`; `POST /agents/:id/skills` `server/src/modules/agents/routes.ts:152-165` |
| Mock LLM keyed by `schemaName` | `server/src/adapters/mocks.ts:48-53, 91` — already documents `'ConventionExtraction'` |
| i18n namespace | `client/messages/en/conventions.json` (26 lines, zero consumers today) |
| Sidebar nav label | `client/messages/en/shell.json:23` → `"conventions": "Conventions"` |
| Active-nav-key mapping | `client/src/components/app-shell/helpers.ts:31` — already returns `"conventions"` for any path containing `/conventions` |
| `ListChecks` icon | `client/src/vendor/ui/icons.tsx:74,157` |

There is **no** `server/src/modules/conventions/` and **no** `client/src/app/conventions/` yet.

---

## 2. Architecture decisions (settled — do not re-litigate)

1. **Sampling is pure code, no model call.** Config files by fixed glob list + top-12 ranked source files from
   `repoIntel.getConventionSamples(repoId, 12)`. The mock's documented two-step
   (`ConventionFileSelection` → `ConventionExtraction`) is *available* but v1 uses only `ConventionExtraction`.
2. **Evidence verification is pure code and mandatory.** Every candidate the model returns is re-checked against
   the real clone: file must exist, snippet must be found in it. Unverifiable candidates are dropped, never shown.
   The line range is **recomputed from the real match**, not trusted from the model.
3. **Extraction is synchronous** (one HTTP request, one model call). Do not add a job. Existing i18n has a
   `"scanning"` state; the client shows a pending button. If it later proves too slow, the escape hatch is
   `container.jobs.enqueue` following `server/src/modules/repo-intel/routes.ts:44-56` — out of scope now.
4. **Tri-state status, not a boolean.** `pending | accepted | rejected`. The existing `accepted boolean` column
   and the `accepted: boolean` contract field are replaced. Safe: both currently have zero consumers.
5. **The skill body is generated server-side** by one pure function, exposed via a draft endpoint, then made
   fully editable in the modal. The client posts back whatever the user edited — the server does not regenerate.
6. **Skill creation goes through the conventions module**, not raw `POST /skills`, because it must also stamp
   `evidence_files`, optionally link an agent, and mark the source candidates as consumed — one transaction-ish
   unit, one place to test.

---

## 3. Server

### 3.1 Schema change

Edit `server/src/db/schema/knowledge.ts`. **Never hand-write migration SQL** (`server/INSIGHTS.md`); edit the
schema then run `npm run db:generate` and `npm run db:migrate` from `server/`.

New table `convention_scans` (drives the "Detected from 84 sample files · last scan 1h ago" subtitle and gives
per-scan cost accounting):

```ts
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    sampleCount: integer('sample_count').notNull(),
    candidateCount: integer('candidate_count').notNull(),
    droppedCount: integer('dropped_count').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.repoId) }),
);
```

Extend `conventions` (`knowledge.ts:31-42`):

- add `category text('category')` — free text from the model, normalised to lower-kebab in code.
- add `evidenceStartLine: integer('evidence_start_line')`, `evidenceEndLine: integer('evidence_end_line')`.
- add `status: text('status', { enum: ['pending','accepted','rejected'] }).notNull().default('pending')`.
- add `scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'set null' })`.
- add `skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' })` — set when a candidate is
  rolled into a skill. (`skills` is in a different schema file — import it; watch for a circular import, if it
  bites, drop the FK and keep a plain `uuid` column.)
- add `createdAt: now()`.
- **remove** `accepted boolean`.
- add `(t) => ({ repoIdx: index('conventions_repo_idx').on(t.repoId) })`.

Then update the barrel `server/src/db/schema.ts` (three places: `export *`, the named import block, and the
`schema` object used for `drizzle()` typing) and add row types in `server/src/db/rows.ts` alongside `SkillRow`
(`rows.ts:17-18`).

### 3.2 Contracts

Edit **both hand-maintained copies in lock-step** (`server/INSIGHTS.md` 2026-06-14):
`server/src/vendor/shared/contracts/knowledge.ts` and `client/src/vendor/shared/contracts/knowledge.ts`.
Convention: schema and inferred type share one PascalCase name; DTO fields are snake_case.

Replace the `ConventionCandidate` block at `:172-180` with:

```ts
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string().uuid(),
  category: z.string().nullable(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  evidence_start_line: z.number().int().nullable(),
  evidence_end_line: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  skill_id: z.string().uuid().nullable(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionScan = z.object({
  id: z.string().uuid(),
  sample_count: z.number().int(),
  candidate_count: z.number().int(),
  dropped_count: z.number().int(),
  model: z.string(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

export const ConventionsPayload = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsPayload = z.infer<typeof ConventionsPayload>;

export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  evidence_files: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;
```

Also extend `Skill`-creation inputs to carry evidence (see §3.6).

### 3.3 New module `server/src/modules/conventions/`

Follow the `skills` module anatomy exactly (routes → service → repository → pure helpers).

```
conventions/
  routes.ts       Fastify plugin (default export)
  service.ts      orchestration
  repository.ts   Drizzle, always workspace-scoped
  sampler.ts      pure-ish: which files to sample + read them
  verify.ts       PURE: evidence verification against file contents
  skill-body.ts   PURE: candidates -> markdown skill body + name/description
  prompt.ts       system prompt + the extraction Zod schema
  helpers.ts      row <-> DTO mapping
  constants.ts    SAMPLE_FILE_COUNT, CONFIG_GLOBS, MAX_FILE_BYTES, MIN_CONFIDENCE
```

Register in `server/src/modules/index.ts` — one import + one entry in the `modules` map (`index.ts:1-38`).
Add `conventionsRepo` getter to `server/src/platform/container.ts` mirroring `skillsRepo` (`container.ts:101-103`).

#### `constants.ts`

```ts
export const SAMPLE_FILE_COUNT = 12;
export const MAX_FILE_BYTES = 12_000;      // per sampled file, truncate tail
export const MIN_CONFIDENCE = 0.5;         // drop below this before persisting
export const CONFIG_FILES = [
  'package.json', 'tsconfig.json', '.prettierrc', '.prettierrc.json', '.prettierrc.js',
  'prettier.config.js', 'prettier.config.mjs', '.eslintrc', '.eslintrc.json', '.eslintrc.cjs',
  'eslint.config.js', 'eslint.config.mjs', '.editorconfig',
];
```

#### `sampler.ts`

```ts
export interface SampledFile { path: string; content: string; truncated: boolean }
export async function collectSamples(container, repoId): Promise<SampledFile[]>
```

- resolve the repo row for `RepoRef` (owner/name/clonePath) — `repos` table, or reuse
  `RepoIntelRepository.getRepoBasics` (`server/src/modules/repo-intel/repository.ts:136-148`).
- read each `CONFIG_FILES` entry via `container.git.readFile(repoRef, path)` — interface
  `server/src/vendor/shared/adapters.ts:226`, impl `server/src/adapters/git/simple-git.ts:129-131`. Missing files
  throw; catch per-file and skip. This is the mockable path (`MockGitClient`), so do **not** use `node:fs` directly.
- `const paths = await container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT)` then read each.
  It returns paths only, already filtered of tests/`.d.ts`/generated (`repo-intel/service.ts:713-720`).
- truncate each file to `MAX_FILE_BYTES`, flag `truncated`.
- degrade, never throw: if repo-intel is disabled/unindexed it returns `[]` — proceed with configs alone, and if
  the total sample set is empty, the service returns a `ValidationError` ("repo not indexed yet") rather than
  calling the model.

#### `prompt.ts`

- `ConventionExtraction` Zod schema — this exact name becomes `schemaName` (the mock keys off it):

```ts
export const ConventionExtraction = z.object({
  candidates: z.array(z.object({
    category: z.string(),
    rule: z.string(),
    evidence_path: z.string(),
    evidence_snippet: z.string(),
    confidence: z.number().min(0).max(1),
  })),
});
```

- System prompt: house-conventions extractor. Rules for the model: one rule per candidate, imperative voice,
  `evidence_path` must be one of the supplied paths verbatim, `evidence_snippet` must be **copied literally** from
  that file (2–10 lines), no invented code, no generic advice ("write tests") — only rules the sampled code
  actually demonstrates. Use `assemblePrompt` / `wrapUntrusted` from `server/src/platform/prompt.ts:6-11` — file
  contents are untrusted input and must be wrapped.
- Consider a `.md` system prompt file next to `server/src/prompts/onboarding.system.md` for consistency.

#### `verify.ts` (pure — the heart of the feature, test it hardest)

```ts
export interface VerifyResult { ok: boolean; startLine?: number; endLine?: number; reason?: string }
export function verifyEvidence(snippet: string, fileContent: string | null): VerifyResult
```

- `fileContent === null` (file absent from the sample set / unreadable) → `{ ok: false, reason: 'file_missing' }`.
- Normalise: split both into lines, `trimEnd()` each, drop leading/trailing blank lines from the snippet.
- Find the snippet's line sequence in the file's line array, comparing on `line.trim()` so indentation drift does
  not fail a real match. First match wins; return 1-based `startLine`/`endLine`.
- No match → `{ ok: false, reason: 'snippet_not_found' }`.
- Single-line snippets are allowed but must match a whole trimmed line — no substring matching (that is how
  hallucinated fragments sneak through).
- Verify **only against the sampled contents already in memory**; do not re-read from git (cheaper, and it
  guarantees the model could not cite a file it was never shown).

#### `skill-body.ts` (pure)

```ts
export function buildSkillDraft(repoName: string, accepted: ConventionCandidate[]): ConventionSkillDraft
```

Matching the modal screenshot:

- `name`: `` `${slug(repoName)}-conventions` `` (lower-kebab, e.g. `payments-api-conventions`).
- `description`: `` `${n} house conventions extracted from ${repoName}` `` (pluralise correctly).
- `body`:

```markdown
# payments-api-conventions

House conventions for `payments-api`. Flag changes that violate any rule below and cite
the offending `file:line`.

## async-await-then-chains
Always use async/await instead of .then() chains.

Detected in `src/api/users.ts:23-31`:

```ts
const user = await db.users.find(id);
```
```

- One `##` section per accepted candidate; heading = kebab-slug of the rule (dedupe with a numeric suffix on
  collision); body = the rule sentence, then the `Detected in \`path:start-end\`` line, then a fenced block with
  the snippet. Infer the fence language from the file extension.
- `evidence_files`: unique `evidence_path` values, in candidate order.

#### `repository.ts`

`constructor(private db: Db)`; every query `and(eq(t.conventions.workspaceId, workspaceId), …)`.

- `listByRepo(workspaceId, repoId): Promise<ConventionRow[]>` — order `status asc, confidence desc`.
- `latestScan(workspaceId, repoId): Promise<ConventionScanRow | undefined>`.
- `insertScan(values)`.
- `replacePending(workspaceId, repoId, scanId, rows)` — delete rows with `status = 'pending'` for that repo, then
  insert the new candidates. **Accepted and rejected rows survive a re-scan** (a rejected rule must not come back
  every scan). Dedupe: skip an incoming candidate whose normalised `rule` equals a surviving row's.
- `getById(workspaceId, id)`, `update(workspaceId, id, patch)` (rule / category / status).
- `markLinked(workspaceId, ids, skillId)`.

#### `service.ts`

```ts
class ConventionsService {
  constructor(private container: Container) { this.repo = container.conventionsRepo }
  list(workspaceId, repoId): Promise<ConventionsPayload>
  extract(workspaceId, repoId): Promise<ConventionsPayload>
  patch(workspaceId, id, input): Promise<ConventionCandidate | undefined>
  skillDraft(workspaceId, repoId): Promise<ConventionSkillDraft>
  createSkill(workspaceId, repoId, input): Promise<Skill>
}
```

`extract` flow:

1. `const samples = await collectSamples(container, repoId)`; empty → `ValidationError`.
2. `const choice = await resolveFeatureModel(container, workspaceId, 'conventions')`
   (`server/src/modules/settings/feature-models.ts:51-57`) — this feature is the registry's first real consumer.
3. `const llm = await container.llm(choice.provider)`;
   `llm.completeStructured({ model: choice.model, schema: ConventionExtraction, schemaName: 'ConventionExtraction', messages })`.
4. For each returned candidate: look up its `evidence_path` in `samples` → `verifyEvidence`. Drop on failure or
   on `confidence < MIN_CONFIDENCE`. Count drops.
5. Insert the scan row (with `tokensIn/tokensOut/costUsd` from `StructuredResult`,
   `server/src/vendor/shared/adapters.ts:72-80`), then `replacePending`.
6. Return `{ scan, candidates }`.

`createSkill` flow: build the skill via `container.skillsRepo.insert({ … type: 'convention', source: 'extracted',
evidenceFiles })` (insert already supports `evidenceFiles` — `skills/repository.ts:79`), optionally
`container.agentsRepo.linkSkill(agentId, skill.id, order)` (`agents/repository.ts:208-216`), then `markLinked`.
Prefer calling `SkillsService.create` over the repo directly if it stays a one-liner — keep skill-versioning logic
in one place.

#### `routes.ts`

Mount as a Fastify plugin, `app.withTypeProvider<ZodTypeProvider>()`, tenancy via
`getContext(app.container, req)` (`server/src/modules/_shared/context.ts:14-23`), params via `IdParams`
(`_shared/schemas.ts:11`).

```
GET   /repos/:id/conventions              → ConventionsPayload
POST  /repos/:id/conventions/extract      → ConventionsPayload   (200)
GET   /repos/:id/conventions/skill-draft  → ConventionSkillDraft
POST  /repos/:id/conventions/skill        → Skill                (201)
PATCH /conventions/:id                    → ConventionCandidate  ({ rule?, category?, status? })
```

**Route-order gotcha** (`server/INSIGHTS.md`, mirrored at `skills/routes.ts:60-65`): register the static
`/conventions/extract`, `/conventions/skill-draft`, `/conventions/skill` paths **before** any `/conventions/:id`
route. `PATCH /conventions/:id` is a different prefix so it is safe, but keep the ordering habit.

`POST /repos/:id/conventions/skill` body:

```ts
z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  type: SkillType.optional(),        // default 'convention'
  agent_id: z.string().uuid().optional(),
})
```

Unknown id → `NotFoundError` (mapped by the app-level error handler, `server/src/app.ts:113-157`).

### 3.4 Skills module touch-up

`CreateSkillBody` (`server/src/modules/skills/routes.ts:15-22`) and `CreateSkillInput`
(`server/src/modules/skills/service.ts:11-18`) do not carry `evidence_files`, though the repository and the DTO
mapper already do (`repository.ts:79`, `helpers.ts:19`). Add `evidence_files: z.array(z.string()).optional()` to
the body and `evidenceFiles?: string[]` through the service into the insert. Small, additive, no migration.

### 3.5 Server tests (`server/test/`, Vitest)

- `conventions-verify.test.ts` — pure, no DB. Cases: exact match; indentation drift; snippet not present →
  dropped; file missing → dropped; multi-line match returns the correct 1-based range; single-line substring
  must NOT match.
- `conventions-skill-body.test.ts` — pure. Slug collisions, pluralisation, fence language, `evidence_files`
  dedupe, snapshot of the rendered markdown.
- `conventions.it.test.ts` — Testcontainers, following `server/test/settings-models.it.test.ts` and
  `server/test/reviews.it.test.ts`. Build the app with overrides:
  `MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: fixture } })` plus a `MockGitClient`
  whose `readFile` returns the fixture file contents, and a stub `repoIntel` with
  `getConventionSamples: async () => [...]` (`container.ts:120-124` honours `overrides.repoIntel`). Assert:
  extract persists only verified candidates; a fixture candidate with a fabricated snippet is dropped and counted
  in `dropped_count`; PATCH flips status and edits `rule`; re-scan preserves accepted/rejected rows;
  `POST …/conventions/skill` creates the skill with `evidence_files` and, with `agent_id`, an `agent_skills` row.
- Update `server/test/contracts.test.ts` if it asserts the old `ConventionCandidate` shape.

---

## 4. Client

### 4.1 Nav

`client/src/vendor/ui/nav.ts` — add to the `SKILLS LAB` group (currently `skills`, `agents` after the recent
move):

```ts
{ key: "conventions", label: "Conventions", icon: "ListChecks", href: "/conventions", gKey: "c" },
```

`key` must be exactly `"conventions"` — the sidebar label is looked up as `` t(`nav.${it.key}`) `` and
`client/messages/en/shell.json:23` already has it. Add `{ keys: "g c", label: "Go to Conventions", group:
"Navigation" }` to `SHORTCUTS` (`nav.ts:57-66`). `activeKeyFor` needs no change
(`client/src/components/app-shell/helpers.ts:31`).

### 4.2 Files

```
src/app/conventions/page.tsx                                    thin entry (see src/app/agents/page.tsx:1-7)
src/app/conventions/_components/ConventionsView/{ConventionsView.tsx,styles.ts,constants.ts,index.ts,ConventionsView.test.tsx}
src/app/conventions/_components/ConventionCard/{ConventionCard.tsx,styles.ts,index.ts,ConventionCard.test.tsx}
src/app/conventions/_components/CreateSkillModal/{CreateSkillModal.tsx,styles.ts,constants.ts,index.ts}
src/lib/hooks/conventions.ts
```

Follow the **agents** route conventions (`styles.ts` + `useTranslations`), not the skills route — the skills route
has drifted to inline styles and hardcoded English (`client/INSIGHTS.md`; `SkillsListView.tsx:28-96`).

### 4.3 Hooks — `src/lib/hooks/conventions.ts`

Model on `src/lib/hooks/skills.ts` (direct import, deliberately not in the `hooks/index.ts` barrel) and
`src/lib/hooks/repo-intel.ts:31-49`. All access through `api` from `src/lib/api.ts`.

```ts
useConventions(repoId: string | null)              // GET /repos/:id/conventions, enabled: !!repoId
useExtractConventions(repoId)                      // POST …/extract, onSuccess -> invalidate ["conventions", repoId]
useUpdateConvention(repoId)                        // PATCH /conventions/:id, invalidate
useConventionSkillDraft(repoId, enabled)           // GET …/skill-draft, enabled only when the modal is open
useCreateSkillFromConventions(repoId)              // POST …/skill, invalidate ["conventions", repoId] and ["skills"]
```

Query keys: `["conventions", repoId]`. Mutations get global error toasts for free
(`src/lib/providers.tsx:35-43`).

### 4.4 `ConventionsView`

- `useActiveRepo()` (`src/lib/repo-context.tsx:58-60`) for `repoId` / `activeRepo.name`; render
  `<RepoNotFound />` when the repo is missing.
- `AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}` — same call shape as
  `SkillsListView.tsx:28`.
- Heading `Conventions in <repo>` — `t("page.headingPrefix")` + repo name in accent mono, matching the screenshot.
- Subtitle: `Detected from {n} sample files · last scan {relative}` from `payload.scan`. **New i18n key needed**
  (`page.subtitleScan`); the existing `page.subtitle` covers the pre-scan state.
- Top-right `Re-scan` — `Button kind="secondary" icon="RefreshCw"`, label `t("page.rescan")`, `t("page.scanning")`
  while pending.
- Action bar: `Deselect all` (sets every accepted candidate back to `pending`), `{k} of {n} accepted`,
  `Create skill` (`Button kind="primary" icon="Sparkles"`, disabled when zero accepted) → opens the modal.
- States: `Skeleton` → `ErrorState` (`page.loadError`) → `EmptyState` (`page.empty.*`, cta runs extraction) →
  card list. Same triad as `SkillsListView.tsx:74-96`.

### 4.5 `ConventionCard`

Props: `{ candidate, onAccept, onReject, onEditRule, busy }`.

- Left accent border tinted by status (green `var(--ok)` when accepted, neutral `var(--border)` otherwise).
- Rule text as an italic heading; **click-to-edit** — swap to a `TextInput`, commit on Enter/blur, cancel on
  Escape, calls `onEditRule(id, rule)` (user story 4).
- Evidence header row: mono `path:start-end` + a copy `IconBtn icon="Copy"` (copies the snippet).
- Snippet in a `<pre>` on `var(--bg-hover)` — same treatment as `ImportDrawer.tsx:141-154`. No diff-viewer.
- Confidence: `ProgressBar` (`client/src/vendor/ui/primitives/ProgressBar.tsx:3-27`) with
  `value={confidence * 100}` and the threshold colours already used by `ConfidenceNum` (≥85 `--ok`,
  ≥65 `--warn`, else `--crit`), plus the `NN%` label. Label from `card.confidence`.
- Right column: `Accepted` (primary, `icon="Check"`) / `Reject` (secondary, `icon="X"`) — one is active per
  status. `card.accepted` exists; **`card.reject` must be added.**

### 4.6 `CreateSkillModal`

Copy the structure of `client/src/app/agents/_components/AgentsListView/_components/CreateAgentModal/CreateAgentModal.tsx:13-79`
— it is the only true create-modal in the app.

- `<Modal width={720} title={t("modal.title")} subtitle={draftName} onClose footer={…}>`.
- Info banner: `Merged from {n} accepted conventions in {repo}. Everything below is editable before you save.`
- Fields: `Name*` (`TextInput`), `Description` (`TextInput`), `Type` (`SelectInput`, default `convention`),
  `Enabled` (`Toggle`, with the "Whether this block is added to agents' prompts." hint), `Skill body*`
  (`Textarea rows={16} mono`, prefilled from the draft, with the token estimate the `ConfigTab` already renders —
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.tsx:82-95`).
- Optional `Link to agent` `SelectInput` fed by `useAgents()` → posts `agent_id`. Not in the screenshot; keep it
  last and optional so the visual matches.
- Seed state from `useConventionSkillDraft` once loaded; do not clobber user edits on refetch (seed in a
  `useEffect` guarded by a `seeded` ref, or `key` the modal on the draft id).
- Footer: ghost `Cancel` + primary `Create skill` with `disabled={create.isPending}`. On success:
  `onClose()` then `router.push(\`/skills/${skill.id}?tab=config\`)` — same move as `ImportDrawer.tsx:61`.

### 4.7 i18n

`client/messages/en/conventions.json` already covers the page shell and card confidence/accept. **Add** (keeping
the existing keys untouched):

```
page.subtitleScan       "Detected from {count} sample files · last scan {when}"
page.deselectAll        "Deselect all"
page.acceptedCount      "{accepted} of {total} accepted"
page.createSkill        "Create skill"
card.reject             "Reject"
card.rejected           "Rejected"
card.editRule           "Edit rule"
card.copySnippet        "Copy snippet"
modal.title             "Create skill from conventions"
modal.banner            "Merged from {count, plural, one {# accepted convention} other {# accepted conventions}} in {repo}. Everything below is editable before you save."
modal.name / modal.description / modal.type / modal.enabled / modal.enabledHint /
modal.body / modal.agent / modal.agentNone / modal.cancel / modal.submit / modal.created
```

A missing key renders the raw key, not an error (`client/INSIGHTS.md`) — so verify visually.

### 4.8 Client tests

Colocated `*.test.tsx`, vitest + jsdom + RTL. Use the provider-wrapper idiom from
`client/src/app/agents/_components/AgentCard/AgentCard.test.tsx:26-35`, importing
`messages/en/conventions.json` as the `conventions` namespace.

- `ConventionCard.test.tsx` — renders rule/path/snippet/confidence; Accept and Reject fire the right callback;
  click-to-edit commits on Enter and reverts on Escape.
- `ConventionsView.test.tsx` — `vi.mock("@/lib/hooks/conventions")`; empty state renders the CTA; the accepted
  counter is right; `Create skill` is disabled at zero accepted.

---

## 5. Phasing (each phase independently reviewable)

1. **Schema + contracts** — migration, both `knowledge.ts` copies, `db/rows.ts`, `db/schema.ts` barrel. Run
   `npm run db:generate && npm run db:migrate`; `npm test` stays green.
2. **Pure core + tests** — `verify.ts`, `skill-body.ts`, `sampler.ts` constants; the two pure test files. No
   routes yet.
3. **Server module** — repository, service, routes, registration, container getter, skills `evidence_files`
   passthrough; `conventions.it.test.ts`.
4. **Client read path** — nav item + shortcut, route, `hooks/conventions.ts`, `ConventionsView`,
   `ConventionCard`, extract/accept/reject/edit wiring, i18n keys, component tests.
5. **Skill creation** — draft endpoint consumption, `CreateSkillModal`, optional agent link, redirect to the
   skill editor.
6. **Verify end to end** — run the `verify` skill against a real cloned repo: scan → some candidates dropped by
   evidence checking → accept a subset → edit one rule → create the skill → confirm it appears in Skills Lab with
   `evidence_files` set and, if linked, shows on the agent's Skills tab.

---

## 6. Acceptance criteria

- [ ] `POST /repos/:id/conventions/extract` returns only candidates whose snippet was located in a sampled file;
      `dropped_count` is non-zero for a fixture containing a fabricated snippet.
- [ ] No model call happens during file selection — grep the extract path: exactly one `completeStructured`.
- [ ] Sampling reads config files **and** `repoIntel.getConventionSamples(repoId, 12)`.
- [ ] The model/provider comes from `resolveFeatureModel(…, 'conventions')`, so the Settings → Feature Models
      page changes it.
- [ ] Every candidate can be accepted, rejected, and rule-edited; state survives a page reload.
- [ ] A re-scan does not resurrect rejected rules and does not clear accepted ones.
- [ ] The modal opens seeded from accepted candidates, everything is editable, Cancel saves nothing.
- [ ] The saved skill has `type: 'convention'`, `source: 'extracted'`, `evidence_files` populated, and (when an
      agent was chosen) an `agent_skills` row.
- [ ] `cd server && npm test` and `cd client && pnpm test` pass; both typecheck.

---

## 7. Traps (from the repos' INSIGHTS files — read before starting)

- `server/src/vendor/shared/` and `client/src/vendor/shared/` are **hand-mirrored copies**. Editing one and not
  the other produces a type error only on the side you forgot.
- Never hand-write migration SQL; edit the drizzle schema and generate.
- Fastify: static route paths must be registered before parameterised ones on the same prefix.
- Modules are registered statically in `server/src/modules/index.ts` — there is no filesystem autoload.
- ESM: every relative import carries the `.js` extension on the server.
- `repo-intel` is only reachable through `container.repoIntel.*`; its methods degrade to `[]` rather than throw,
  so an unindexed repo must produce a clear user-facing error from the conventions service, not an empty scan.
- Do not hand-edit `server/src/db/migrations/` or `server/src/vendor/shared/` beyond the additive contract change
  described above.
