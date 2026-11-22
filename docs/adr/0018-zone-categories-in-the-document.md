---
status: accepted
---

# Zone Categories in the Document, with icons from a collection

A Zone Category is a bare id today. The Preset of the Space Kind suggests some (`booth`, `meeting-room`…), the Theme colours them and gives 12 of the 32 built-in ones an icon, and any other id is accepted with no name, colour or icon (`garden` in the Office demo). Shopping centres move visitors by big category buttons with an icon each ([kiosk notes](../notes/kiosk.md#decided-2026-11-03)), and owners want categories of their own. Decided 2026-11-03.

**Built-in categories are complete.** Every category of every Preset gets a default colour and its name in `en`, `pl`, `uk` and `ru`, and an icon from the collection, except where Zones show their own name (a booth, a room) or are a way through (an aisle, a corridor), as today ([the reviewed table](../notes/categories.md)). A new Space Kind, `mall`, has a Preset whose categories match the collection (food court, restaurant, fashion, kids, electronics, beauty, services, supermarket, WC, ATM, info desk). The list per Kind is in [`categories.md`](../notes/categories.md), reviewed on 2026-11-03.

**An icon collection, in the open packages.** One-colour SVG icons, drawn as silhouettes as today (ADR-0010), named by id (`fork-knife`, `hanger`…). Every plan can use it.

**The owner's own categories are in the Document.** A Space can define categories beside the Preset's: an id, a name with its translations (like a Zone's `label` and `labels`, ADR-0011), a colour and an icon named from the collection. They describe the place, so they belong in the open format, and a self-hosted plan shows them too. The field is additive and optional, so no migration (ADR-0006); the exact shape is settled when it is built. A Zone's look is found in this order: the Document's category, then the Preset's, then the Theme's default.

**Uploaded images stay out of the Document.** The owner's own icon (a one-colour SVG) and a shop's logo (PNG or SVG) are uploaded on Pro, stored by us in object storage, and kept in the Space's settings on our server. They reach the View with the published Revision, never inside the Document. A self-hosted Document falls back to the collection icon.

**Name, logo, or both, per Zone.** A Zone with a logo shows its text, its logo, or both, as the owner chooses; text and logo by default when there is a logo. A logo becomes an image, not only SVG markup as in today's `labelResolver` (ADR-0010 left room for image URLs).

**This amends ADR-0010.** Icons still come from the category, but a category defined in the Document now names its icon, by a collection id. Image data never goes into the Document.

## Consequences

- `core`: the categories field in the model, schema and Commands, with the checks it needs settled when it is built; the editor's category list reads it beside the Preset's.
- `render-2d`, `render-3d`: icons and colours from the Document's categories, then the Preset's; image logos in the colour path of both views.
- The Editor: a categories section in the Space's settings, with the collection to pick from.
- The server and the web app: uploads for icons and logos on Pro, and the text / logo / both choice per Zone.
