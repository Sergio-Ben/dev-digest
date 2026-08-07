/**
 * Tunables for the conventions extractor. Kept in one file so a lesson can
 * change sampling breadth without touching the sampler/service logic.
 */

/** How many rank-ranked source files to sample beyond the config files. */
export const SAMPLE_FILE_COUNT = 12;

/** Per sampled file; anything longer is truncated (tail dropped). */
export const MAX_FILE_BYTES = 12_000;

/** Candidates below this confidence never reach the DB. */
export const MIN_CONFIDENCE = 0.5;

/**
 * Config files worth sampling verbatim — they encode most of a repo's
 * mechanical conventions (formatting, lint rules, module system). Fixed list
 * rather than a glob walk: deterministic, and cheap on a large clone.
 */
export const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'prettier.config.mjs',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  '.editorconfig',
] as const;
