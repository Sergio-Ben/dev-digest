# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-14** — `formatCost` (`src/lib/cost.ts`) distinguishes MISSING data (`null`/`undefined` → "—") from a genuine zero (`0` → "$0.00"), widens precision for sub-cent values (~2 sig figs), and trims trailing zeros to a 2dp floor ("$0.06" not "$0.060", "$0.0013" not "$0.00"). Reuse it for any per-run money display.

## What Doesn't Work

- **2026-07-28** — Don't reset `FindingsPanel`'s `focusIdx` with `useEffect(() => setFocusIdx(0), [shown])`: `shown` is a `useMemo` over `findings`, and `findings` gets a fresh array identity on every accept/dismiss refetch, so the effect yanks keyboard focus back to the top mid-triage. Clamp at render instead — `const focus = shown.length ? Math.min(focusIdx, shown.length - 1) : 0`. The unclamped `focusIdx` was a live bug: any filter that shrinks the list left focus invisibly past the end. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:31-52`.
- **2026-07-28** — `ReviewRunAccordion`'s `defaultOpen` is only the initial `useState` value, so a prop change never reopens it; with a stable `key={review.id}` React reuses the instance. Filtering the run list therefore leaves collapsed accordions unless an explicit effect opens them. Re-keying by `id + filter` "fixes" it but also wipes each panel's `hideLow`, every open/closed choice, and re-fires the `targetRunId` scroll effect. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:47-62`.

- **2026-07-28** — An absolutely-positioned popover inside the PR list gets clipped: `s.tableCard` sets `overflow: hidden` for its rounded corners, so the card is cut at the row boundary (same trap on the timeline rows). Fix is a portal to `<body>` + `position: fixed` with coordinates from the trigger's `getBoundingClientRect()` — plus scroll (capture-phase) and resize listeners, because a fixed card does not follow the page. Reuse `useHoverCard()` rather than re-deriving this. Evidence: `client/src/app/repos/[repoId]/pulls/styles.ts:95-96`, `client/src/components/FindingsHoverCard/useHoverCard.ts`.
- **2026-07-28** — A hover card separated from its trigger by a gap needs a close DELAY (~140ms, cancelled on re-enter) and the same `onMouseEnter`/`onMouseLeave` handlers spread on BOTH trigger and card. Closing straight on `mouseleave` makes the card unreachable — it shuts while the pointer crosses the gap, so a scrollable card can never be scrolled. Evidence: `client/src/components/FindingsHoverCard/useHoverCard.ts` (`CLOSE_DELAY_MS`, `hoverProps`).

## Codebase Patterns

- **2026-07-28** — Severity ordering and tallying live in ONE place, `client/src/lib/severity.ts` (`SEVERITY_CHIPS`, `SEVERITY_ORDER`, `bySeverity`, `countBySeverity`), imported by the PR-list FINDINGS column, the PR-detail chips and `FindingsPanel`'s sort. Counts there are deliberately status- and confidence-independent (accepted/dismissed count; `hideLow` doesn't change them) and mirror the server's `rollupSeverities`, so list and detail can't disagree. Don't re-declare the order locally — that's how the three drifting `SEV_COLOR` copies happened.
- **2026-07-28** — Timeline rows render `RunSummary`, which carries only denormalized totals (`findings_count`, `blockers`) — no findings bodies. Anything per-run and finding-level (severity counts, hover preview) must be threaded down from `FindingsTab`, which holds the `ReviewRecord[]`, as a `run_id → FindingRecord[]` map. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx` (`findingsByRun`), `FindingsTab.tsx`.
- **2026-06-14** — Cross-route shared components live in `src/components/<Name>/` with an `index.ts` barrel, imported via `@/components/<Name>` (e.g. `RunCostBadge`, `diff-viewer`). Vendored UI primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` under `@devdigest/ui` — different home. Evidence: `client/src/components/RunCostBadge/`.
- **2026-06-14** — The PR-list table is driven by two parallel constants that MUST stay length-aligned: `COLUMN_KEYS` (header keys + order) and `GRID` (CSS grid-template tracks). Adding a column = add to both AND render a matching cell in `PRRow.tsx`, else header/cells misalign silently. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-07-28** — On the PR-detail findings tree (`FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`), view filters are threaded down as a VALUE, never as a pre-filtered `findings` array: the accordion derives its `N findings · M blockers` header and `VerdictBanner findingsCount` from `review.findings`, so handing it a filtered list silently mis-reports the run with no type error. Rule: accordion chrome = run totals, panel body = filtered view. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:63-66,105-107,152`.
- **2026-06-14** — i18n has only the `en` locale (`client/messages/en/`); new UI strings need a key under the right namespace file (e.g. `prReview.json`, `runs.json`) read via `useTranslations("<ns>")`. A missing key renders the raw key, not an error.

## Tool & Library Notes

- **2026-07-28** — There are TWO `Severity` types and they differ: `@devdigest/shared` (`vendor/shared/contracts/findings.ts:11`) is the 3-value wire enum `CRITICAL|WARNING|SUGGESTION`; `@devdigest/ui` (`vendor/ui/primitives/tokens.ts:3`) adds a UI-only `INFO`. The UI one is a superset, so indexing `SEV[sev]` with a shared `Severity` needs no cast — but typing state or a `Record<Severity, …>` with the UI type silently admits `INFO`. Import from `@devdigest/shared` for anything data-shaped. `SEV` itself (icon + colour per severity) is exported from `@devdigest/ui`; three drifting private copies already exist (`FindingCard/constants.ts`, `RunTraceDrawer/.../FindingsSection.tsx` — the latter wrongly uses `var(--accent)` for SUGGESTION) — don't add a fourth.

- **2026-07-28** — React portals propagate events along the REACT tree, not the DOM tree: a card portalled to `<body>` from inside a clickable table row still bubbles clicks to that row's `onClick` and navigates away. Keep the `onClick={(e) => e.stopPropagation()}` on the card. Evidence: `client/src/components/FindingsHoverCard/FindingsHoverCard.tsx`.

## Recurring Errors & Fixes

- **2026-07-28** — `TypeError: Cannot read properties of null (reading 'left')` from a style factory: the popover JSX was built on every render with `s.card(pos!)` while `pos` is null until the first hover — the `pos && createPortal(...)` guard at the usage site does NOT protect JSX constructed above it. Build the card lazily (`const card = (at: CardPos) => …`) inside the guard. The non-null assertion silenced the only compile-time warning; a component test caught it. Evidence: `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx`.

## Session Notes

## Open Questions
