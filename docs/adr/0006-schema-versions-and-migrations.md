# Only breaking changes bump the schema version; older Documents are migrated forward on load

Stored Documents carry `schemaVersion`. New optional properties (door `hinge` and `swing`, Underlay `size`, …) do not bump it: a reader of the same version ignores what it does not know, and unknown extra properties survive a load and save. The version goes up only for a change an older reader would misread — a renamed or restructured property, a new required one, a changed meaning or unit.

Each bump ships a pure migration that upgrades raw JSON data from version N to N + 1. `fromJSON` runs the chain before the schema check, so the schema, Invariants and the rest of the code only ever see the current version, and a v1 file opens in any later library. Migrations work on parsed JSON rather than typed Documents because the old types no longer exist in the code; each step stays small and is tested on its own.

We chose not to downgrade: a Document from a newer library is refused with `newer-version`, so the host can ask the user to update rather than silently drop data an older library does not understand. We also chose not to migrate on save — what is written is always the current version.

**Consequence:** a breaking change costs a migration, its tests and a major release, so the model favours additive, optional properties; reserved fields in the brief are planned that way.
