# semver-discipline

Decide which version bump the diff requires, and flag when the PR's declared version
is lower than what the change actually needs. The bump follows the contract change,
not the size of the diff.

## Rule
Classify every API-surface change first:

| Change | Required bump |
|---|---|
| Removed/renamed route, method, or response field | **major** |
| Field retyped, required→optional (response) or optional→required (request) | **major** |
| Narrowed enum, tightened validation, lowered limit, changed default | **major** |
| Error moved from one status class to another (400 → 404, 2xx → 4xx) | **major** |
| New endpoint, new optional request field, new response field | **minor** |
| Widened enum, raised limit, relaxed validation | **minor** |
| Handler fix that makes behavior match the documented contract | **patch** |
| Internals only, no boundary change | **patch** |

- **CRITICAL** — the diff makes a major-level change while `package.json` / the API
  version / the changelog claims minor or patch. Name the change and the bump it forces.
- **CRITICAL** — a `0.x` package that the repo treats as stable is broken silently by
  leaning on "pre-1.0 means anything goes" while real consumers exist in this repo.
- **WARNING** — the bump is right but no changelog or migration note accompanies a
  major, so consumers get no upgrade path.
- **WARNING** — a bug fix that changes an observable response and is shipped as patch;
  it is behaviorally major even when the old behavior was wrong. Say so and let the
  author decide.
- **SUGGESTION** — version metadata is not touched at all in a PR that changes the
  boundary.

Never call a bump wrong without naming the specific field or route that forces it.

## Good
```jsonc
// PR removes GET /repos/:id/refresh and renames `full_name` → `slug`.
{ "name": "@devdigest/api", "version": "3.0.0" }   // was 2.4.1 — major, both are removals
```

## Bad
```jsonc
// Same PR, version bumped as a feature. Consumers auto-upgrade on ^2 and break.
{ "name": "@devdigest/api", "version": "2.5.0" }
```
