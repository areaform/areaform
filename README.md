<p align="center"><img src="brand/logo.svg" alt="Areaform" width="120" height="120" /></p>

# Areaform

An embeddable engine for places: an exhibition hall, an office, a shop, a warehouse, a café, a flat. One open data model for the plan, a 2D and 3D View you put in your own site or app, an Editor to draw the plan, wayfinding inside it, and an MCP server through which an AI assistant builds a first draft from a Figma frame or an image.

The hosted builder, where a plan is drawn, published and embedded with one snippet, is at [areaform.app](https://areaform.app). This repository is the engine underneath it.

## Packages

| Package                                       | What it is                                                                                             | Licence                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [`@areaform/core`](packages/core)             | The Document (Space, Levels, Walls, Openings, Zones, Connections), Commands, undo, checks, JSON Schema | MIT                                                      |
| [`@areaform/render-2d`](packages/render-2d)   | 2D rendering with PixiJS: camera, scene, hit-testing                                                   | MIT                                                      |
| [`@areaform/render-3d`](packages/render-3d)   | 3D rendering with Three.js                                                                             | MIT                                                      |
| [`@areaform/view`](packages/view)             | The View to embed: show, pan, zoom, click, highlight, Plugins                                          | MIT                                                      |
| [`@areaform/wayfinding`](packages/wayfinding) | The walkable area of a Level and the shortest route, in the browser                                    | MIT                                                      |
| [`@areaform/editor`](packages/editor)         | The Editor: React components and framework-free tools                                                  | [BUSL 1.1](packages/editor/LICENSE), MIT after two years |
| [`@areaform/mcp`](packages/mcp)               | An MCP server that builds a Draft from a design for a person to review                                 | MIT                                                      |

Install them from npm:

```sh
npm install @areaform/view three                    # show a Space on your page
npm install @areaform/editor three react react-dom   # let people draw one
npx @areaform/mcp                                   # the MCP server, for your AI assistant's configuration
```

They are at 0.x: the API can still change between minor versions, and [`CHANGELOG.md`](CHANGELOG.md) says what did.

## Try it

In your own page, with no framework:

```js
import { fromJSON } from '@areaform/core';
import { createView } from '@areaform/view';
import '@areaform/view/styles.css';

const loaded = fromJSON(await (await fetch('/plan.json')).text());
if (loaded.ok) createView(document.getElementById('plan'), { doc: loaded.doc, controls: true });
```

The [embedding guide](docs/guides/embedding.md) has the same in [React](docs/guides/embedding.md#showing-a-space-areaformview) and [Vue](docs/guides/embedding.md#vue), and the Editor. To work on the engine itself, you need Node 24 and pnpm (`corepack enable` sets up the version this repository asks for).

```sh
pnpm install
pnpm dev        # the playground: the Editor and the View on a sample plan
pnpm test       # unit tests of every package
pnpm e2e        # the playground in Chrome with Playwright
```

## Examples

All live at [areaform.app/examples](https://areaform.app/examples/). The licence is MIT: copy them freely.

- Made-up client sites, each one HTML file with a plan embedded through `embed.js`, so you can download it and open it with no build: a craft fair ([`makers-fair`](apps/examples/makers-fair/index.html)), an office building ([`lettera-house`](apps/examples/lettera-house/index.html)), a café with table booking ([`juniper-cafe`](apps/examples/juniper-cafe/index.html)) and a shopping centre with a directory and QR codes at its entrances ([`linden-square`](apps/examples/linden-square/index.html)).
- [A live car park](apps/examples/live-parking) in plain TypeScript with the packages: sensors, free spaces per Level and the route to the best free spot (`pnpm parking:dev`).

## Documentation

- [Embedding](docs/guides/embedding.md): Documents and Commands, `<AreaformView>`, `<AreaformEditor>`, theming, use without React
- [Draft import through MCP](docs/guides/mcp.md): set-up, a session, reviewing a Draft
- [`CONTEXT.md`](CONTEXT.md): the vocabulary (Space, Level, Wall Node, Zone, Connection, …)
- [`docs/adr/`](docs/adr/): the decisions behind the engine and why they were made
- The plan format: [JSON Schema](packages/core/schema/v1/document.json), also at [areaform.app/docs/format/](https://areaform.app/docs/format/)

## Questions, bugs and ideas

- A bug or a missing feature: [open an issue](https://github.com/areaform/areaform/issues/new/choose).
- "How do I …?": [Discussions](https://github.com/areaform/areaform/discussions).
- Your account or plan on areaform.app: support@areaform.app.
- A security problem: see [`SECURITY.md`](SECURITY.md), not a public issue.

Pull requests are welcome; [`CONTRIBUTING.md`](CONTRIBUTING.md) says how they are taken in.

## Licence

Every package but the Editor is MIT. The Editor is under the Business Source License 1.1: free in production, also in sites and apps you build for clients, but not to be offered as a plan-builder product or service; each version becomes MIT two years after it is published. Details in [`LICENSE`](LICENSE).
