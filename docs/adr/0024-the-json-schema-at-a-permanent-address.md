---
status: accepted
---

# The format's JSON Schema lives at a permanent address on areaform.app

The brief promises "no vendor lock-in (open format, export to standards)", but nothing outside our code could read a plan: the format was defined only by TypeScript in `@areaform/core`. A JSON Schema lets anyone check and read a plan in any language. Decided on 2026-11-15.

**One address per schema version, on our own domain:** `https://areaform.app/schema/v1/document.json`, and `…/v2/document.json` beside it when a version 2 comes ([ADR-0006](0006-schema-versions-and-migrations.md)). The address is the schema's `$id`, and every saved plan names it. So once it is served, it never moves and is never taken down, and an older version's schema stays at its address for as long as files of that version exist. Under ADR-0006 a version only gains optional properties, so its file changes in place, and only additively.

**Written by hand, beside the checker.** `packages/core/schema/v1/document.json` and the npm export `@areaform/core/schema/v1/document.json` are the same file. The descriptions are written for people, from the glossary, and the docs page links to it. `checkSchemaV1` in `schema.ts` stays what the core loads with. A test runs both over the same Documents, and over every copy with one property removed or given a wrong value, and fails when they disagree.

**Saved files name it; the core never checks it.** `toJSON` writes `$schema` first, with the current version's address (`DOCUMENT_SCHEMA_URL`), replacing whatever the Document carried. `fromJSON` drops `$schema`: it describes the file, not the Space. The server stores Documents, so a stored plan never holds it.

**Served by the site from that one file.** An Astro endpoint builds `/schema/v1/document.json` from `@areaform/core`, so the site and the package cannot drift apart. Caddy lets any origin fetch `/schema/*`, so browser tools can load it, and caches it for an hour, since it changes in place. `scripts/check-site.sh` fails a build that loses the address. `/docs/format/` explains the format and links to it.

## Considered

- **An address without a version** (`/schema/document.json`). One address to remember, but a version 2 would make every older file name a schema that no longer describes it.
- **Generating the JSON Schema from the TypeScript types, or both from one Zod schema.** One source of truth, but the generated descriptions read worse, and moving the checker to Zod adds a runtime dependency to a core that has none. The agreement test gives the same safety.
- **Another host:** `schema.areaform.app`, the CDN host or a raw GitHub file. A subdomain is one more thing to keep. The CDN host is for `embed.js` and published plans. A GitHub address ties the format to where the code happens to live.
- **No `$schema` in saved files.** It costs nothing to read, and without it a person who opens a file has no way to find what it means.

## Consequences

- **A schema version bump needs its schema file first.** A test ties `DOCUMENT_SCHEMA_URL` to the file's `$id`, so the core cannot write `v2` into files before `schema/v2/document.json` exists.
- **areaform.app must keep serving these addresses even if the product is renamed.** A redirect keeps validators working, but the `$id` in old files keeps the old domain.
- **Changes to a published version's file are additive only**, the same rule ADR-0006 sets for the format.

## Later

- **Export to GeoJSON**, so a plan opens in GIS tools and maps. **IMDF** only when a customer asks for it.
- **A SchemaStore entry**, so editors find the schema without `$schema`. That needs a file name pattern for plans, which we do not have yet.
