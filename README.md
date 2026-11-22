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

They are not on npm yet; they will be published under the `@areaform` scope. Until then, clone the repository and use them from source.

## Try it

You need Node 24 and pnpm (`corepack enable` sets up the version this repository asks for).

```sh
pnpm install
pnpm dev        # the playground: the Editor and the View on a sample plan
pnpm test       # unit tests of every package
pnpm e2e        # the playground in Chrome with Playwright
```

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
