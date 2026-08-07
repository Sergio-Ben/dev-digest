# API Reviewer — skills

Importable skill bodies for the API reviewer agent
([`docs/agent-prompts/api-reviewer.md`](../../agent-prompts/api-reviewer.md)). Each
file is a standalone skill: its first `# heading` becomes the skill `name` on import,
the rest of the file becomes `body`.

> Not to be confused with `.claude/skills/` — those are skills for the coding agent.
> These are DevDigest skills, stored in the `skills` table and linked to a review
> agent, injected into the prompt under `## Skills / rules`.

## Catalog

| File | Skill name | Type | Description (paste into the Description field on import) |
|---|---|---|---|
| [breaking-change.md](./breaking-change.md) | `breaking-change` | `rubric` | Flag removal or alteration of a published API contract that an unmodified client can observe. |
| [response-schema.md](./response-schema.md) | `response-schema` | `convention` | Check declared response shape against what the handler actually returns — types, nullability, leaked internals. |
| [semver-discipline.md](./semver-discipline.md) | `semver-discipline` | `rubric` | Map each contract change to the version bump it forces; flag under-bumped releases. |
| [deprecation-policy.md](./deprecation-policy.md) | `deprecation-policy` | `convention` | Require deprecate-then-remove with a marker, a sunset signal, and a working replacement. |

Import sets `description: ''` and `type: 'custom'` — fill both from the table above in
the import preview before saving.

## Importing

**UI:** Skills → Import → pick the `.md` file → set description + type → Save → link
the skill to the API reviewer agent.

**API:**
```bash
curl -s localhost:3001/skills/import \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg f breaking-change.md --arg c "$(base64 < breaking-change.md)" \
        '{filename:$f, content_base64:$c}')"
```
`POST /skills/import` only previews — it does not persist. Send the preview fields to
`POST /skills` to create, then link via the agent's skills.

## Conventions

Severity vocabulary is the engine's own enum — `CRITICAL | WARNING | SUGGESTION`.
Only `CRITICAL` blocks merge, so each skill states what does *not* qualify, not just
what does. Skill bodies never describe the JSON output shape; that is enforced by the
response schema (see [`docs/agent-prompts/README.md`](../../agent-prompts/README.md)).
