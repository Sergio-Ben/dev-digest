/**
 * Smart Diff — thresholds and patterns.
 *
 * Every magic number/pattern the classifier or service uses MUST live here
 * (explicit acceptance criterion — "Пороги й патерни винесені в константи").
 * Nothing hardcoded in `classifier.ts`, `helpers.ts`, or `service.ts`.
 */

// ---------------------------------------------------------------------------
// Boilerplate — generated/vendored artifacts a reviewer should never have to
// read line-by-line. These are exact basenames of lock files: the package
// manager owns their contents, a human diff review adds no value.
// ---------------------------------------------------------------------------
export const BOILERPLATE_FILENAMES: readonly string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  'Pipfile.lock',
];

// Path segments that mark an entire subtree as build output / vendored code.
// Matched as a whole POSIX path segment (never a substring) so
// `distribution/foo.ts` is NOT boilerplate just because it starts with "dist".
export const BOILERPLATE_DIR_SEGMENTS: readonly string[] = [
  'dist',
  'build',
  'out',
  'node_modules',
  'vendor',
  '__snapshots__',
  '.next',
  'coverage',
  'generated',
];

// Filename suffixes for generated/minified/compiled artifacts. Order doesn't
// matter — each is checked independently against the lowercased basename.
export const BOILERPLATE_EXTENSIONS: readonly string[] = [
  '.snap',
  '.min.js',
  '.min.css',
  '.map',
  '.lock',
  '.generated.ts',
  '.pb.go',
  '_pb2.py',
];

// Generic suffix rule: any `*.generated.*` file (not just `.generated.ts`)
// is machine-authored and reviewed at the generator, not the diff.
export const BOILERPLATE_GENERATED_SEGMENT = '.generated.';

// ---------------------------------------------------------------------------
// Wiring — plumbing/config files that connect real logic together. Reviewers
// scan these for correctness of wiring, not business logic, so they rank
// after `core` but before `boilerplate`.
// ---------------------------------------------------------------------------
export const WIRING_FILENAMES: readonly string[] = [
  'index.ts',
  'index.js',
  'index.tsx',
  'package.json',
  'tsconfig.json',
  'server.ts',
  'main.ts',
  'app.ts',
  'routes.ts',
  'Dockerfile',
  'docker-compose.yml',
  '.env.example',
];

// Regexes for wiring filenames that vary (framework configs, type
// declarations, dotfile configs). Applied to the basename only.
// The `(.*\.)?` prefix is optional so both a bare `config.ts` and a
// namespaced `app.config.ts` / `next.config.mjs` count as wiring.
export const WIRING_FILENAME_PATTERNS: readonly RegExp[] = [
  /^(.*\.)?config\.(ts|js|mjs|cjs|json)$/i,
  /^.+\.d\.ts$/i,
  /^\.eslintrc(\..+)?$/i,
  /^\.prettierrc(\..+)?$/i,
];

// Path segments whose entire subtree is wiring/infra (CI, deploy config,
// schema migrations) rather than application logic.
export const WIRING_DIR_SEGMENTS: readonly string[] = ['config', '.github', 'migrations', 'ci'];

// ---------------------------------------------------------------------------
// Split suggestion thresholds.
// ---------------------------------------------------------------------------

// A PR whose total additions+deletions exceeds this is hard for a human to
// hold in working memory in one review pass (rule-of-thumb "one PR, one
// concern" size popularized by Google's/SmartBear's code-review research).
export const SPLIT_TOO_BIG_TOTAL_LINES = 800;

// A PR touching more than this many CORE (non-wiring/boilerplate) files is
// very likely bundling multiple concerns, even if the line count is modest.
export const SPLIT_TOO_BIG_CORE_FILES = 10;

// Below this, a "split" isn't actionable — a single file can't be split out
// into its own PR in any useful way.
export const SPLIT_MIN_FILES_PER_GROUP = 2;

// Canonical reviewer-first ordering: read the logic first, then the plumbing
// that wires it up, and skip/skim the boilerplate last.
export const ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const;

// NOTE: `finding_lines` carries ONE anchor line per finding (not the expanded
// `start_line..end_line` span), so there is no span to clamp — see the
// comment in `service.ts` for why the anchor-per-finding shape is the one the
// "N findings" badge needs.
