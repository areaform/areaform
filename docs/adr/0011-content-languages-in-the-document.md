---
status: accepted
---

# Content Languages: a language list on the Space, translations beside each text

A Space's own text (Zone labels, Level and Connection names, the Space's name) is written by its author for visitors, and many venues serve visitors in several languages: a fair in Warsaw has Polish, English and Ukrainian visitors. The interface language of the Editor and View (`locale`) says nothing about this text, so a Space needs languages of its own: Content Languages.

The Document gets a top-level `languages?: { default: string; others?: string[] }` beside `name` and `grid`. It changes what visitors see, so it is part of the format, validated and documented, like `geo`, rather than a convention in `meta`, which the core neither checks nor describes. `others` lists the languages the Space offers, so the Editor and a View can offer a language before any of its texts exist. Tags are BCP 47 as given (`pl`, `pt-BR`).

Each text stays where it is and is written in the default language; its translations sit beside it in a map named after the field: `labels` beside a Zone's `label`, `names` beside a Level's, a Connection's and the Space's `name` (`labels: { pl: 'Stoisko 1' }`). A map beside each field keeps a translation with its Element through every Command (duplicate, delete, undo) with no extra bookkeeping, and says plainly which text it translates. The change is additive: no `schemaVersion` bump ([ADR-0006](0006-schema-versions-and-migrations.md)).

Which text a visitor sees: the host's runtime text first (`labelResolver`, e.g. an exhibitor's name), then the translation in the visitor's language, then the default text. A language matches exactly, then by its base (`pl-PL` finds `pl`). `labelResolver(zone, language)` is told the visitor's language, so a host can return its own translated text. `<AreaformView>` takes a `contentLanguage` prop; when absent, its interface `locale` stands in, since most hosts want both in one language, and the prop lets those that do not tell them apart.

## Decisions on the edges

- **Documents without `languages`:** the default language is unknown, not assumed English. The View shows `label` as before. The Editor asks for the default (preselecting the interface language) before the first translation is added, so a Polish plan is never filed as English.
- **Changing the default** only re-declares which language the `label` texts are in, e.g. to correct a wrong choice in the wizard. Texts do not move. Making another language the default by swapping texts into `label` is left for later: it is rare, and where a translation is missing, `label` would end up in two languages.
- **Removing a language** takes it out of `others` but keeps its texts in the maps, so adding it back restores them. Texts in a language the Space does not offer are hidden: never shown, and ignored by consumers.
- **In the Editor** the author picks the language they are filling in. A text not yet translated shows on the plan as visitors in that language would see it (the default text), drawn faded; its field is empty with the default text as a placeholder; and the language switch counts what is missing (`PL · 12 missing`).

## Considered Options

- **Only a default, languages from the map keys.** Smaller, but a language with nothing translated yet would not exist, and a mistyped key would add a language.
- **`meta.languages`.** No format change, but every consumer (a future 2.5D viewer, exports) would have to know an undocumented convention.
- **`labels` on every Element.** One key everywhere, but `labels` beside a `name` hides which field it translates.
- **One translations table per Space** (`translations: { pl: { 'zone:A-1': … } }`). Easy to hand to a translator, but it goes stale when Elements are deleted or duplicated, and every Command would have to keep it in step. A translator export can be generated from the maps instead.
- **English when absent.** Nothing to ask, but wrong for every plan not written in English.
- **Deleting a removed language's texts.** Keeps the Document clean, but loses work when a language is dropped by mistake or only for a while.

## Consequences

- Validation accepts a translation key not in `languages` (a hidden language) but `languages.others` must not contain the default.
- Exports and a future 2.5D viewer must ignore texts in languages the Space does not offer.
- Hidden texts travel with the Document, so Publish strips them before a Revision reaches visitors' browsers.
- The label text resolver both views call ([ADR-0010](0010-3d-labels-floor-text-through-an-sdf-atlas.md)) takes the visitor's language; with it, Level and Connection names can be drawn in 3D.
