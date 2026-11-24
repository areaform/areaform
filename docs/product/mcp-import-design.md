# Draft import through MCP: design

Decisions from the design interview of 2026-10-22 for making a first plan from a design source (a Figma mock-up or an image) that a person then reviews and corrects. Why the import is an agent working through Commands rather than a converter is in [ADR-0008](../adr/0008-draft-import-through-mcp-commands.md); vocabulary (**Draft**, **Import Flag**, **Source**) is in [`CONTEXT.md`](../../CONTEXT.md).

## The flow

1. A person runs Claude (Desktop or Code) with two MCP servers: Figma's and ours (`packages/mcp`, local stdio).
2. They give the agent a Figma frame or an image. The agent picks the Space Kind (asking if the source doesn't make it clear) and creates a Draft.
3. The agent calibrates the scale from a dimension in the source, or asks for one.
4. It reads the source (through `figma_extract` when the file follows the convention, otherwise through the Figma MCP and a screenshot) and applies batches of Commands, fixing what Invariants reject and checking Diagnostics.
5. It compares `render_preview` over the source with the original and repeats step 4 until they match.
6. It flags whatever it is unsure of, attaches the source as an Underlay and saves the Draft folder.
7. The admin opens the folder in the Playground, works through the **Review import** list over the source image, corrects the plan and saves it as usual.

## Decisions

| #   | Topic                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Who interprets the source   | The agent, through tools over the headless core. Source-specific helpers are optional extras, not the core of the design (ADR-0008).                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | Sources in v1               | Figma and raster images (PNG/JPG; scans and rasterised PDFs go through this path). DXF/DWG and SVG later.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | What a Draft contains       | One Level: Outline, Walls, Openings, Zones with category and label, Obstacles. Restricted Zones, several Levels and Connections later.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | Where it runs               | Locally, stdio, started by a person in Claude Desktop or Claude Code. Tools are designed so a remote (HTTP) server inside a host product can follow without redesign.                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | Package and licence         | `packages/mcp`, MIT, part of the open core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | How the agent builds        | A session holds an Editor over the Draft. The agent sends batches of Commands and gets back rejected Invariants and Diagnostics after each one. It never writes a whole Document by hand.                                                                                                                                                                                                                                                                                                                                                     |
| 7   | Hand-off to the admin       | A folder on disk, opened in the Playground. No new host UI beyond the review list.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | Scale                       | Two-point calibration (`calibrate(p1, p2, distance)`), as for Underlays. With no known dimension in the source the agent must ask; the scale used is always reported.                                                                                                                                                                                                                                                                                                                                                                         |
| 9   | Figma conventions           | Any mock-up is accepted. A documented, optional layer-naming convention lets `figma_extract` read geometry exactly.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | Source as Underlay          | A screenshot of the frame (or the image itself) is saved next to the plan and added as a locked, semi-transparent Underlay with the same calibration.                                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | Uncertainty                 | Import Flags in `document.meta.import` (see below). The core model is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | Reading Figma               | `figma_extract` calls the Figma REST API with `FIGMA_TOKEN`, for full vector geometry and layer names. Without a token, the agent uses the Figma MCP and a screenshot.                                                                                                                                                                                                                                                                                                                                                                        |
| 13  | Preview for the agent       | Our own SVG renderer in `packages/mcp` from `core` geometry and `wallOutlines`, rasterised to PNG with `@resvg/resvg-js`, optionally over the source image. `render-2d` cannot run in Node.                                                                                                                                                                                                                                                                                                                                                   |
| 14  | Space Kind and categories   | The agent picks the Space Kind and uses the Preset's Zone Categories. Other categories are allowed, and each gets an Import Flag.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 15  | Walls                       | Lines and long thin rectangles become Walls (centre line and thickness), with shared ends merged into Wall Nodes. No drawn walls means no Walls, only the Outline; `walls.fromOutline` only when the admin asks.                                                                                                                                                                                                                                                                                                                              |
| 16  | Re-import                   | Not in v1: importing again makes a new Draft. Source references are kept in `meta.import` so a merge can be built later.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 17  | Review in the Playground    | A **Review import** list from the Import Flags: clicking one selects the Element, and **Done** removes it with `space.update`, so it can be undone.                                                                                                                                                                                                                                                                                                                                                                                           |
| 18  | Quality                     | Unit tests for `figma_extract` on recorded REST responses. A round trip for the agent: draw the expo pilot's `demoHall` in Figma, import it back and compare Zone count, categories, area IoU and Wall length.                                                                                                                                                                                                                                                                                                                                |
| 19  | Getting the image to the UI | The Draft is a folder: `plan.json` plus `source.png`, with a relative `src`. The Playground imports the folder (or the files picked together) and holds the images as `blob:` URLs; `resolveAsset` on the View and Editor finds them by `src`, so the Document, autosave and export keep the relative name. Swapping `src` for `blob:` URLs in the Document was dropped: they would leak into autosave and export and die on reload. The Playground keeps the images in IndexedDB by Document id, so the Source survives a reload. No `.zip`. |

## Tools (v1)

| Tool                                                     | Does                                                                                                                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_draft(kind, name, size?)`                        | Starts a Draft in the session                                                                                                                                                                                              |
| `calibrate(p1, p2, distance, size)`                      | Sets the source-to-metres scale                                                                                                                                                                                            |
| `source_to_plan(points)`                                 | Converts Source points to plan metres, so the agent never does the arithmetic                                                                                                                                              |
| `apply_commands(commands)`                               | Applies a batch of Commands; returns rejected Invariants and Diagnostics                                                                                                                                                   |
| `get_document`, `get_diagnostics`                        | Read the Draft                                                                                                                                                                                                             |
| `render_preview(levelId?, width?, overlaySource?, ids?)` | PNG of one Level (the first by default) with Zone and Obstacle ids and Connection Stops, over the Source on the Level it was attached to                                                                                   |
| `flag(elementId, reason, sourceRef?)`                    | Adds an Import Flag on an Element or a Level's Outline; flags on deleted Elements are dropped                                                                                                                              |
| `figma_extract(url)`                                     | Reads a Figma frame through the REST API and returns Commands in metres for the layers named by the convention (see [mcp.md](../guides/mcp.md#the-figma-convention)); calibrates from a `Dimension` layer; applies nothing |
| `attach_source(path \| url, figmaUrl?)`                  | Adds a PNG or JPEG of the Source, from a file or downloaded from an https link, as a locked, calibrated Underlay                                                                                                           |
| `save_document(dir, overwrite?)`                         | Writes the Draft folder (`plan.json`, `source.png` or `.jpg`); never replaces a plan unasked                                                                                                                               |

[`mcp.md`](../guides/mcp.md) describes set-up, a session, the review and the measured quality.

## `meta.import`

```ts
interface ImportMeta {
    importedAt: string; // ISO date, set when the Draft is created
    source?: { kind: 'figma' | 'image'; ref: string }; // Figma URL with node id, or image file name
    scale?: number; // metres per Source unit (Figma point or image pixel)
    sourceSize?: Vec2; // Source width and height in its units; its bottom-left corner is the plan origin
    underlayId?: Id; // the Underlay showing the Source
    flags?: ImportFlag[];
    sourceRefs?: Record<Id, string>; // Element id → Figma node id, for a future re-import
}

interface ImportFlag {
    ref:
        // what to check, as an ElementRef
        | { kind: 'level'; id: Id } // the Level's Outline
        | { kind: 'wallNode' | 'wall' | 'opening' | 'zone' | 'obstacle'; id: Id; levelId: Id };
    reason: string; // e.g. "unknown category 'lounge'", "door swing guessed"
    sourceRef?: string; // where in the Source, e.g. a Figma node id
}
```

Everything lives in `document.meta.import`, not in `zone.data`: it is one place for every Element kind, and `zone.data` stays the host's. Fields appear as the Draft is built. The calibration is kept here rather than in the session, so it is undone and saved with the plan; the Source's bottom-left corner is the plan origin, X right, Y up, and a Source image of any resolution is scaled to cover the calibrated Source exactly.

## Not in v1

Re-import and merge, several Levels and Connections, Restricted Zones, DXF/DWG and SVG sources, a remote MCP server ([below](#later-a-remote-server)), import inside a host's own Editor.

## Later: a remote server

Today the server runs locally over stdio (decision 4). A remote server over MCP's **Streamable HTTP** transport would let people work without running anything themselves:

- **Claude Code**: `claude mcp add --transport http areaform https://…/mcp`.
- **claude.ai on the web, Claude Desktop and the mobile apps**: a custom connector added by URL. Which plans allow it is still to be checked.
- **A host's own product**: through the Claude API calling the remote server, so an "Import from Figma" button can live in the host's Editor (decision 4, option b).

Figma's own MCP server (`https://mcp.figma.com/mcp`) works this way. Keep stdio for local work and development; the tools stay the same, but four things change:

1. **Transport**: an HTTP endpoint using the SDK's Streamable HTTP transport instead of stdio.
2. **Drafts**: one Draft per MCP session instead of per process, with a lifetime. On several instances or serverless hosting, Drafts go to shared storage (KV, Redis or a database).
3. **Files**: the server can't see the person's disk.
    - `attach_source` takes a `url` (already supported), or an upload within the call.
    - `save_document` keeps the Draft on the server and returns a download link, or sends it to the host's backend, as the expo pilot's `BookingApi` does with plans. The Playground would then import a Draft from a link.
4. **Access and safety**:
    - Authentication: claude.ai connectors expect OAuth, or no authentication, which is unwise for a public server.
    - `FIGMA_TOKEN` becomes per person, best through Figma's OAuth.
    - Downloads by URL must refuse private addresses (SSRF), and calls need rate limits.

Hosting: any Node host (Fly, Render, a VPS). On Cloudflare Workers the native `@resvg/resvg-js` won't run, so the preview would need its WASM build.

The open questions — hosting, Draft storage, authentication, where results go, who pays for the model — want a design interview and an ADR before any code.
