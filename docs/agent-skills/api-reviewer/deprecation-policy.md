# deprecation-policy

Require that anything leaving the public API leaves through a deprecation, not a
delete. A silent removal is a runtime failure for every client that never read the
changelog.

## Rule
A compliant deprecation has all four parts. Flag any that are missing:

1. The old route/field still works and returns the same value.
2. It is marked in the contract — `.describe()` / JSDoc `@deprecated` — naming the
   replacement.
3. A removal signal reaches the caller: `Deprecation` / `Sunset` response headers, a
   logged warning, or a documented removal version.
4. The replacement exists and is reachable in the same release.

- **CRITICAL** — a public route, method, or response field is deleted in this diff with
  no deprecation period and no replacement in the same PR.
- **CRITICAL** — a route is kept but now returns 410/404, or the field is kept but
  always `null` — removal wearing a compatibility mask, which is worse than a clean
  removal because it fails at the data layer instead of the routing layer.
- **WARNING** — deprecation is marked but has no removal version or sunset signal, so
  it will sit forever.
- **WARNING** — the replacement is not equivalent: it loses a field, needs a permission
  the old one did not, or requires several calls to reproduce one response.
- **SUGGESTION** — the deprecation note omits a migration snippet.

Removing something already deprecated is fine when the diff or the file shows the
announced removal version has arrived — say which marker you relied on.

## Good
```ts
app.get('/repos/:id/full', async (req, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', 'Wed, 01 Apr 2026 00:00:00 GMT');
  reply.header('Link', '</repos/:id?include=stats>; rel="successor-version"');
  return service.getFull(req.params.id); // still returns the full payload
});

export const Repo = z.object({
  full_name: z.string().describe('@deprecated use `slug`; removed in v3 (2026-04-01)'),
  slug: z.string(),
});
```

## Bad
```ts
// Route deleted outright — clients get 404 with no warning and no successor.
- app.get('/repos/:id/full', handler)

// Field kept for "compatibility" but permanently null — every consumer breaks anyway,
// now inside their own code instead of at the HTTP layer.
export const Repo = z.object({
  full_name: z.null(),
  slug: z.string(),
});
```
