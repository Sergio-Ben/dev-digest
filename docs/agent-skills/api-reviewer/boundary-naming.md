# boundary-naming

DevDigest serializes every HTTP payload in `snake_case`. `camelCase` identifiers exist
only on the inside — Drizzle row objects, service arguments, internal interfaces. The
`toXDto` mappers are the exact line where the rename happens, and that is the only
place the two vocabularies are allowed to touch.

This is not a style preference. There is no serializer, no interceptor, and no
key-transform middleware anywhere in the request path: whatever key a mapper writes is
the key that reaches the wire. A mapper that emits `camelCase` publishes `camelCase`,
permanently, with no translation layer to undo it.

## Rule

- **CRITICAL** — a response or request field is renamed from `snake_case` to `camelCase`
  (or introduced as `camelCase`) in a shared contract or a `toXDto` mapper. Every
  existing consumer reading the old key now gets `undefined`. There is no versioning
  layer and no key-transform shim to absorb it, so the rename is the break — the fact
  that in-repo callers were updated in the same change does not soften it.
- **CRITICAL** — one payload mixes both vocabularies. `{ scan, candidates }` where
  `scan` is `snake_case` and each `candidate` is `camelCase` forces every consumer to
  special-case a single nested object, and the split will be copied by the next module.
- **WARNING** — a field name diverges from the identifier the rest of the API uses for
  the same concept (`skill_id` vs `skillId` vs `skill`), even when the casing is right.
- **SUGGESTION** — an abbreviation that no sibling endpoint uses (`desc`, `cfg`, `ts`).

Judge the boundary, not the internals. `row.evidencePath` is correct on a Drizzle row and
must stay `camelCase`; `evidence_path` is correct in the DTO the mapper returns. Report
the mapper line and the contract line, and name the consumers that break.

Do NOT report: a `camelCase` local variable, a service or repository parameter, a Drizzle
column property, or a Zod schema that is never serialized (`ConventionExtraction` is the
LLM's structured-output schema, not an HTTP contract — it is internal and exempt).

## Good

```ts
// Contract is snake_case. The mapper is where camelCase stops.
export const ConventionCandidate = z.object({
  evidence_path: z.string(),
  evidence_start_line: z.number().int().nullable(),
  skill_id: z.string().uuid().nullable(),
});

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    evidence_path: row.evidencePath ?? '',        // row stays camelCase — correct
    evidence_start_line: row.evidenceStartLine,
    skill_id: row.skillId,
  };
}
```

## Bad

```ts
// The rename leaks the DB vocabulary onto the wire. No serializer undoes this.
export const ConventionCandidate = z.object({
  evidencePath: z.string(),
  evidenceStartLine: z.number().int().nullable(),
  skillId: z.string().uuid().nullable(),
});

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    evidencePath: row.evidencePath ?? '',
    evidenceStartLine: row.evidenceStartLine,
    skillId: row.skillId,
  };
}
// GET /repos/:id/conventions now answers { scan: { sample_count, candidate_count },
//                                          candidates: [{ evidencePath, skillId }] }
// — two casings in one response body.
```
