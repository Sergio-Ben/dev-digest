# breaking-change

Flag any change that removes or alters a published API contract in a way an
unmodified client can observe. A breaking change is defined by what the client sees,
not by whether the code still compiles.

## Rule
- **CRITICAL** — a route path, HTTP method, required request field, or response field
  is removed, renamed, or retyped, and the diff shows no compatibility shim, alias, or
  version gate.
- **CRITICAL** — an existing request that used to succeed now returns 4xx: a new
  required field, a narrowed enum, a stricter format, or a lowered limit.
- **CRITICAL** — a default changed so an unmodified client gets different behavior
  from an identical request (default page size, default sort, default `enabled` flag).
- **WARNING** — the break is real but reachable only through a surface you cannot
  confirm is public from the diff (internal route, unreleased endpoint, single known
  caller updated in the same PR).
- **SUGGESTION** — a change that is compatible today but pins the contract into a
  shape that will force a break later (an inline enum where a union type belongs).

Every finding must name three things: the old contract, the new contract, and the
concrete request an existing client sends that now behaves differently. If you cannot
state all three, do not report it as breaking.

Renaming a field and keeping the old one populated is NOT breaking. Adding an
optional request field is NOT breaking. Adding a response field is NOT breaking
unless the contract is `strict`/`additionalProperties: false` on the client side.

## Good
```ts
// Old name kept and populated; new name added. Both ship one release.
const RepoDto = z.object({
  full_name: z.string().describe('DEPRECATED: use `slug`. Removal in v3.'),
  slug: z.string(),
});
```

## Bad
```ts
// Rename in place — every client reading `full_name` gets undefined at runtime.
const RepoDto = z.object({
  slug: z.string(),
});

// New required field — every existing POST body now fails validation with 400.
const CreateRepoBody = z.object({
  url: z.string().url(),
  workspace_id: z.string().uuid(), // was not present before, no default
});
```
