# Changelog

What changed in each release of the Areaform packages. Each package's own `CHANGELOG.md` (in `packages/<name>/`, and on npm) lists its changes in detail.

The packages are at 0.x: a minor version (0.2.0) can change the API, a patch (0.1.1) does not. `@areaform/core`, `render-2d`, `render-3d`, `view`, `wayfinding` and `editor` always share one version; `@areaform/mcp` has its own.

## 0.2.0

The page drives the plan's camera ([ADR-0030](docs/adr/0030-the-camera-driven-by-the-page.md)), and the Editor reads plan files picked by a person.

- [`@areaform/view`](packages/view/CHANGELOG.md): `flyTo` a Viewpoint by its id or a camera, `lookAt` a Zone or a point, `setProgress` along a Level's Viewpoints for pages that move the plan as they scroll, and `getCamera`. A touch from the visitor stops what the page started. New events `viewpoint`, `zoneClick` and `tourStep`; the React components give the View through `ref`.
- [`@areaform/render-3d`](packages/render-3d/CHANGELOG.md): `flyTo` and `stopFlight`, and a `tourStep` event.
- [`@areaform/editor`](packages/editor/CHANGELOG.md): **Copy** on each Viewpoint, and a **For your page** section with ready lines for the page's script. `sortDraftFiles`, `relativeSources` and `describeLoadErrors` for importing a `plan.json` with its images.
- `@areaform/core`, `render-2d` and `wayfinding` move to 0.2.0 with them, unchanged. [`@areaform/mcp`](packages/mcp/CHANGELOG.md) 0.1.1 uses them.

## 0.1.0

The first public release.

- [`@areaform/core`](packages/core/CHANGELOG.md): the Document, Commands with undo and redo, Invariants and Diagnostics, Presets, Content Languages, JSON loading with migrations, the JSON Schema and GeoJSON export.
- [`@areaform/render-2d`](packages/render-2d/CHANGELOG.md) and [`@areaform/render-3d`](packages/render-3d/CHANGELOG.md): the plan in 2D with PixiJS and in 3D with Three.js, each loaded when first needed.
- [`@areaform/view`](packages/view/CHANGELOG.md): the View for visitors, with or without React, and its Plugins.
- [`@areaform/wayfinding`](packages/wayfinding/CHANGELOG.md): walking routes inside a Space, in the browser.
- [`@areaform/editor`](packages/editor/CHANGELOG.md): the Editor, under the Business Source License 1.1.
- [`@areaform/mcp`](packages/mcp/CHANGELOG.md): an MCP server that builds a Draft from a Figma frame or an image.
