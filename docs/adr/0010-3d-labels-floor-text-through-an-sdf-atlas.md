---
status: accepted
---

# 3D labels are text on the floor, baked at runtime into one SDF atlas

The 3D view ([ADR-0007](0007-imperative-three-renderer.md)) draws no text, so nobody can tell which booth or shop is where without clicking. A visitor scans a plan by eye; clicking hundreds of Zones to find one name does not work, and hover does not exist on phones or wall-mounted screens. So Zone labels are always shown, as indoor maps do, with a click for details and a search that highlights as separate features on top of picking. Only Zone labels: Level and Connection names wait for Content Languages, and dimensions are an editing aid in a read-only view.

A label is painted on the floor of its Zone, like a decal, at its `labelAnchor` (polylabel otherwise), sized in metres by `labelSize` and coloured by `labelColor`, exactly as in 2D. Walls and Obstacles hide it by depth, and it needs no collision pass, because every label stays inside its own Zone. It follows the plan's x axis as in 2D, and turns 180° when the camera looks at it from behind, so it never reads upside down; the turn is a shader uniform from the camera's azimuth, so orbiting rebuilds nothing. A name too wide for its Zone wraps to two lines, then shrinks; one smaller than the Theme's `minLabelPx` on screen is hidden. That fit rule is one function shared with render-2d, so a booth reads the same in both views, and `labelSize` becomes the largest a label may be, not its fixed size. Floor text squashes when the camera is low; the Zone that is hovered, selected or found by a search will get a standing, screen-facing label once picking exists.

Text is laid out by the browser: each label's lines are drawn with `fillText` in the 2D Theme's `system-ui` stack, turned into a signed distance field (as Mapbox does for CJK at runtime), and packed into 2048 px atlas pages, so a Level's labels are a draw call per page (one for a typical plan) and stay sharp close up. Whole lines are drawn rather than glyphs, so scripts that join or reorder letters (Arabic, Hebrew, Devanagari) come out right. Baking happens in the viewer when a Level is shown, never on a server and never in the Document, because the words change at runtime (host text, the visitor's Content Language). The text comes from one resolver both views call: `zone.label` today, the host's runtime text and the Content Language later.

What to draw is decided in a pure layer, `buildLevelLabels` (Level and a measuring function in, lines, size, anchor and floor rectangle out), tested without WebGL like `buildLevelMeshes`; the Three.js adapter only bakes and uploads. Hosts can turn labels off with `Renderer3DOptions.labels` and style them with `Theme3D.label`, which falls back to the 2D Theme's `label`.

## Considered Options

- **Information on click only.** No clutter, but a visitor cannot find a name they cannot see, and the 3D view stays coloured blocks.
- **Screen-facing labels for every Zone.** Readable from any angle, but they overlap at low angles and need collision and priorities, and the 3D view stops looking like the plan. Kept for the one Zone in focus.
- **HTML overlay (CSS2D).** Crisp and any script, but thousands of DOM nodes need culling, nothing occludes them, and they live outside the canvas.
- **troika-three-text.** The usual Three.js text, but it needs font files rather than the browser's fonts, fallback fonts for CJK and Arabic, and a new dependency.
- **Labels as plain bitmaps.** Same layout path, but blurry when zoomed in close.

## Consequences

- Zone Category icons (`Theme.categoryIcons`, adapted from Lucide) sit above the name at twice its height, at most `zoneIconSize`; the pair shrinks together, and when it cannot fit the name is dropped and the icon kept, since an icon reads smaller and needs no language. They are symbols, so any SVG, a host's own included, is drawn as a one-colour silhouette in the name's colour; brand logos keep their colours through a separate colour path, per Zone from the host. Icons come from the category, never from a Document field, so a WC is a Zone with the `wc` category. 2D draws every icon, Connection icons included, as a silhouette bitmap too, so any SVG looks the same in both views rather than depending on Pixi's partial SVG parser.
- Host logos come with runtime names through one `labelResolver(zone) => { text?, logo? }`, on the View, the 3D view and the renderers. The Editor takes it too but shows only the logos: a runtime name would cover the one being edited, while a logo lets the author see the plan as visitors will. A logo takes the icon's place above the name, keeps its proportions up to `zoneLogoSize` wide, and is drawn in its own colours: a colour bitmap (an RGBA atlas in 3D), since a distance field holds shape only. Logos are SVG markup only for now: no download, so no cross-origin rule or loading failure, and no JPEG background box; image URLs can be added later.
- Connection icons on top of their Stops' blocks already use this path: they are one colour, so they go into the SDF atlas beside the names, tinted per Connection kind in `Theme3D`.
- The atlas is built as a general "floor sticker" path (source image → texture → rectangle on the Zone). SDF suits single-colour text only, so SVG icons will need a second, colour atlas beside it, through the same path and the same resolver; they come from the host or the Theme at runtime, not from a Document field.
- 2D changes too: long names wrap and shrink inside their Zone, so its screenshot baselines change.
- Text looks slightly different on each device, as it already does in 2D, because each uses its own `system-ui`.
- Baking costs time: about 0.13 ms a label, 650 ms for the 5,000 booths of the stress Space. It runs a few milliseconds per frame, so a big plan's names fill in over about a second rather than freezing it, and baked names are kept between views. If that is ever too slow, it can move to a worker with `OffscreenCanvas`.
- Labels are hidden below the Theme's `minLabelPx` as in 2D, so at the default framing of a large Level the 3D view shows no names until you zoom in.
