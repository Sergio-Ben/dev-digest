# response-schema

Check that the declared response shape and the value the handler actually returns are
the same object. Report every divergence between schema, serializer, and handler.

## Rule
- **CRITICAL** — the handler returns a field the schema does not declare, or omits a
  field the schema declares as required. With `strict` serialization the field is
  dropped or the response throws; either way the client sees a contract it was
  promised would hold.
- **CRITICAL** — a response field changes type or nullability: `string → string | null`,
  `number → string`, object → array, a scalar wrapped in an envelope. Optional → required
  is safe for readers; required → optional is a break, because clients dereference it.
- **CRITICAL** — an internal value crosses the boundary: raw DB row, internal id,
  provider error text, stack trace, or a column added to the table and returned by a
  `select *`-style mapper without being added to the DTO deliberately.
- **WARNING** — the shape is consistent but diverges from sibling endpoints on the same
  surface: a different pagination envelope, `snake_case` next to `camelCase`, dates as
  epoch millis where every neighbor emits ISO-8601.
- **WARNING** — an error response does not use the API's established error shape, so a
  client's error handler cannot parse it.
- **SUGGESTION** — a field whose meaning is not derivable from its name and has no
  `.describe()`.

Compare against the mapper (`toXDto`) and the shared contract, not just the handler
return statement. State which field, which endpoint, and what the client now receives.

## Good
```ts
// Contract, mapper, and handler agree; nullability is explicit and deliberate.
export const Skill = z.object({
  id: z.string().uuid(),
  name: z.string(),
  evidence_files: z.array(z.string()).nullable(),
});

export function toSkillDto(row: SkillRow): Skill {
  return { id: row.id, name: row.name, evidence_files: row.evidenceFiles ?? null };
}
```

## Bad
```ts
// Schema says required string; mapper can produce undefined → 500 on serialize.
export const Skill = z.object({ id: z.string(), description: z.string() });
export const toSkillDto = (row: SkillRow) => ({ id: row.id, description: row.description });
//                                                                    ^ nullable column

// Handler leaks the whole row — internal columns become part of the contract by accident.
app.get('/skills/:id', async (req) => db.select().from(skills).where(eq(skills.id, req.params.id)));
```
