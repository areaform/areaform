# Draft import through MCP

`@areaform/mcp` is an MCP server that lets an agent such as Claude build a first plan, a **Draft**, from a design **Source**: a Figma frame or an image. A person then reviews and corrects it in the Editor. The agent reads the Source with its own tools and builds the plan through the core's Commands, so every step meets the same Invariants as an edit by hand. Why it works this way is in [ADR-0008](../adr/0008-draft-import-through-mcp-commands.md); the decisions behind it are in [the design](../product/mcp-import-design.md).

## Before you start

- **Node 24** (`node --version`). The server runs its TypeScript source directly, which older Node can't.
- **The repository with its dependencies:** `git clone …`, then `pnpm install` at the root. Without them the server fails on start.
- To check, run `node packages/mcp/src/main.ts` from the root. It should wait silently for a client; stop it with Ctrl+C.

## Connecting

### Claude Code

```sh
claude mcp add -s user areaform -- node /path/to/areaform/packages/mcp/src/main.ts
```

`-s user` makes the server available in every folder. Without it, the scope is `local` and the server exists only in the folder you ran the command in. To use `figma_extract` too, pass the token from the repository's `.env` (see [Figma](#figma) below). Run this in your own terminal, so the token doesn't end up in a chat:

```sh
cd /path/to/areaform
claude mcp add -s user areaform -e FIGMA_TOKEN="$(grep '^FIGMA_TOKEN=' .env | cut -d= -f2-)" -- node "$PWD/packages/mcp/src/main.ts"
```

Check with `claude mcp list`, which should show `areaform: … ✔ Connected`. Tools load when a session starts, so start a new Claude Code session, or run `/mcp` in the current one to reconnect. To change the command, `claude mcp remove areaform -s user` and add it again.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS (`%APPDATA%\Claude\claude_desktop_config.json` on Windows), then quit and restart Claude Desktop:

```json
{
    "mcpServers": {
        "areaform": {
            "command": "/absolute/path/to/node",
            "args": ["/path/to/areaform/packages/mcp/src/main.ts"],
            "env": { "FIGMA_TOKEN": "your token, only if you use figma_extract" }
        }
    }
}
```

Give **the absolute path to Node** (`which node`). Claude Desktop does not read your shell's `PATH`, so a plain `"node"` fails when Node comes from nvm, fnm or Homebrew. Claude Desktop also has no shell, so the agent can't download a Figma screenshot itself. It passes the screenshot's link to `attach_source` as `url`, and the server downloads it.

### Figma

- **Reading frames:** connect Figma's own MCP server as well. The agent reads a frame with its `get_metadata` and takes `get_screenshot` for the Source image.
- **`figma_extract`** needs a personal access token in the Areaform server's environment as `FIGMA_TOKEN`. To make one, in Figma (web or app) go to your name → **Settings** → **Security** → **Personal access tokens** → **Generate new token**, with **File content: Read only**. Figma shows the token once. Keep it in the repository's `.env` (ignored by git) or pass it as above. The agent never sees the token.

### First run

1. In your own terminal, at the repository root, run the second `claude mcp add` command above (with the token).
2. `claude mcp list` shows `areaform: … ✔ Connected` (and Figma's server, if you use it).
3. Start a new Claude Code session.
4. Ask: _"Make an Areaform Draft from this Figma frame: <frame link with node-id>. Save it to ~/drafts/hall-a."_
5. Open `~/drafts/hall-a` in the Playground with **Import folder**, and work through **Review import** (see [Reviewing a Draft](#reviewing-a-draft)).

## A session

When the agent connects, the server tells it the order of work and its rules (the server's `instructions`). `apply_commands` describes every Command by example. So a plain request is enough, such as _"Make an Areaform Draft from this Figma frame: <link>. Save it to ~/drafts/hall-a."_ or _"…from ~/scans/hall.png; the hall is 60 m wide."_ The agent should then:

1. **`create_draft(name, kind)`.** The Space Kind picks the Preset; the result lists the Zone Categories to use. If the Source doesn't make the kind clear, the agent asks.
2. **`calibrate(p1, p2, distance, size)`.** Two points on the Source a known distance apart (a dimension line, a labelled wall), and the Source's size in its own units: Figma points for a frame, pixels for an image. **Scale is never guessed:** with no known dimension on the Source, the agent asks.
3. **`attach_source(path | url, figmaUrl?)`.** A PNG or JPEG of the whole Source, at any resolution, from a local file or an https link (such as `get_screenshot`'s, used straight away since those links expire). It is shown under the Draft as a locked, half-transparent Underlay. The link itself is not kept in the Draft.
4. For a Figma frame, **`figma_extract(url)`** first. It reads the layers named by [the convention](#the-figma-convention) and returns ready Commands in metres. If the Draft isn't calibrated yet, it calibrates from a `Dimension` layer. A calibration made on a screenshot of the frame (in pixels, often @2x) is restated in the frame's points. Nothing is applied until the agent sends the Commands with `apply_commands`, and it draws the layers listed as `skipped` itself.
5. **`source_to_plan(points)`** for every other coordinate read from the Source, and **`apply_commands(commands)`** in batches: `level.setOutline`, `wall.add`, `opening.add`, `zone.add`, `obstacle.add`, and updates and deletes. Each batch is one undo step. If any Command is rejected, nothing in the batch is applied, and the result names the Command the batch fails from (a Command whose broken Invariant a later one mends is not blamed) and the Invariants it broke. On success it returns the Diagnostics, such as overlapping booths or Zones outside the Outline.
6. **`render_preview(levelId?)`** to compare the Draft with the Source underneath it, then fix and repeat. It draws the first Level, where the Source is, unless given another Level's id; the Stops of stairs, lifts and ramps show with their names, and the Level's Viewpoints as numbered camera marks.
7. **`flag(elementId, reason)`** on whatever is uncertain: a guessed category, an exit read from a coloured mark, an Outline traced from a shadow.
8. **`save_document(dir)`.** This writes the Draft folder, and the agent reports the folder, the scale used and the flags.

`get_document` and `get_diagnostics` read the Draft at any point.

### One Draft per session

The server holds **one Draft in memory**. `create_draft` starts over, and quitting Claude (or restarting the server) loses whatever wasn't saved with `save_document`. `save_document` never replaces a `plan.json` unless asked to (`overwrite: true`).

### The Draft folder

```
hall-a/
  plan.json     the Document (JSON, schema version 1), with meta.import
  source.png    the Source image (source.jpg for a JPEG), which the Underlay's src names
```

### Coordinates

Source units grow right and down from the Source's top-left corner. The plan is in metres with **Y up**, and the Source's **bottom-left corner is the plan's origin**. `source_to_plan` does this conversion; agents should use it rather than doing the arithmetic themselves. A hosted Opening's `offset` is measured along its Wall, from the Wall's first point `a` to the Opening's **centre**; a free Opening's `position` is its centre too.

## Updating a plan from your own data

The agent can also change a plan saved earlier, such as filling in the booths from an exhibitor list: _"Here's our exhibitor CSV. Update the booths in ~/plans/hall-a by booth number and keep our ids."_

1. **`open_document(path)`** loads a Draft folder or its `plan.json`, dropping the current Draft. The plan is checked as on any load: Elements that break an Invariant are dropped and listed in `repairs`. The Source image next to the plan is found again, and the Import Flags come back.
2. **`match_zones(rows, key, by, set?)`** matches the records to Zones. `key` is the record field naming the Zone (`stand`), and `by` is the Zone field it is compared with: `label` for a booth number, `id`, or `data.<key>` for an id stored on an earlier update. Case, spaces and `- _ . /` are ignored unless `exact`, so `A-12` matches `a12`. `category` and `levelId` narrow the Zones. `set` names what to copy from each record, such as `{"data.externalId": "id", "data.exhibitor": "company"}`, onto `label`, `category` or a key of the Zone's `data`. The other `data` keys are kept.
3. The result holds a `zone.update` Command for each one-to-one match that changes something. Nothing is applied. It also lists what the agent should take back to the person: records naming no Zone (`unmatchedRows`), records naming several Zones (`ambiguous`), Zones named by several records (`duplicateRows`), records with no key, and Zones no record names.
4. **`apply_commands(commands)`** applies them as one undo step, and **`save_document(dir, overwrite: true)`** writes the plan back.

Keep your own id in `data.externalId` (or another `data` key). The next update can then match by it with `by: "data.externalId"`, even after booths are renumbered.

## A camera tour

The agent can also make the camera tour that the 3D view flies through ([ADR-0025](../adr/0025-camera-motion-viewpoints-and-cooperative-gestures.md)), from words alone: _"Show the entrance from outside, then the garden from the south, then the whole floor from above."_

1. **`frame_viewpoint(levelId, zoneIds | point, bearing, tilt)`** returns a Viewpoint looking at those Zones, or at a point and the `radius` around it (5 m by default), and the `viewpoint.add` Command that puts it last in the tour. `bearing` is the compass direction the camera looks towards (0 north, 90 east), and `tilt` is degrees from straight down, under 90. The distance is worked out as the 3D view frames a Level, for a view `aspect` wide for its height (1.5 by default), so the agent never guesses it. Nothing changes yet.
2. **`apply_commands`** with those Commands, in tour order. `viewpoint.update`, `viewpoint.move` and `viewpoint.delete` change them afterwards.
3. **`render_preview`** marks each camera with its number and a wedge towards its target, which is crossed. A camera standing beyond the plan is drawn at the plan's edge, on its line of sight. Then **`save_document`**.

The tour plays on a client's page with `data-motion="tour"` on the snippet, and in the Editor with **Play tour**.

## The Figma convention

`figma_extract` matches each layer's name at its start, ignoring case. Groups and frames whose names match nothing are walked into. A recognised layer's own children are read only for labels.

| Layer name                                                               | Becomes                                                                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Outline`, `Floor`                                                       | The Level's Outline (the largest, if there are several)                                                                                               |
| `Wall`                                                                   | A Wall along the shape's long axis, as thick as its short side; a `LINE` is as thick as its stroke. Ends that stop at or overrun another Wall meet it |
| `Door`, `Entrance`, `Passage`, `Emergency exit`, `Exit`                  | An Opening on the Wall it lies along, as wide as its extent along that Wall; free if it lies on none                                                  |
| `Column`, `Pillar`, `Shaft`, `Void`, `Obstacle`                          | An Obstacle                                                                                                                                           |
| A Zone Category of the Space Kind: `Booth A1`, `Meeting room 4`, `Aisle` | A Zone of that category; the rest of the name is its label. Restricted or Walk-around when the Preset marks the category so                           |
| `Zone <label>`, `Restricted <label>`                                     | A Zone with no category, or a Restricted Zone                                                                                                         |
| `Dimension 60 m`                                                         | The scale: the shape's long axis is that long                                                                                                         |
| Any `TEXT`                                                               | The label of the smallest Zone it sits in, when the Zone's name gives none                                                                            |

Shapes may be rotated or nested in groups: the transforms are applied. Rectangles and frames are taken as rectangles. Vectors and polygons with straight edges are taken as polygons, and curved shapes as their bounding box (with a note). Hidden layers are ignored. Every other layer is reported in `skipped` with its node id, so the agent can handle it from the screenshot. Element ids are `fig-<node id>`, and `meta.import.sourceRefs` records which Figma node each Element came from.

## Reviewing a Draft

In the Playground (`pnpm dev`), switch to **Edit**, press **Import folder** and pick the Draft folder (or pick `plan.json` and `source.png` together with **Import**). The Source appears under the plan, and **Review import** lists the Import Flags. Clicking one selects the Element; **Done** removes the flag from the list and can be undone. Fix the plan as usual. Then **Export** downloads the reviewed plan as JSON, or with autosave on it stays in this browser, Source image included.

A host can do the same in its own app. Pass `resolveAsset` to `<AreaformEditor>` to find `source.png` among the files it holds, read the flags from `document.meta.import.flags`, and select a flagged Element with the `selection` prop. See [embedding](embedding.md).

## What `meta.import` holds

The calibration (`scale`, `sourceSize`), the `source` (a Figma URL or an image file name), the Source Underlay's id and the Import Flags. Keeping them in the Document means they are saved with the plan and undone with it. The fields are listed in [the design](../product/mcp-import-design.md#metaimport).

## Measured quality

`packages/mcp/eval` holds a round trip on the expo pilot's demo hall, a 60 × 40 m hall with 62 Zones, 4 Walls, 6 Openings and 6 columns:

1. `draw-demo-hall.figma.js` draws the hall in Figma the way a designer might, at 20 px per metre. Layers have plain names like "Booth A1", "Wall" and "Emergency exit", text labels sit on top, and a "60 m" dimension line is drawn above the hall.
2. The agent (Claude Code) reads the frame with the Figma MCP's `get_metadata` and a screenshot, then builds the Draft through the tools above. `demo-hall-agent.ts` replays its Commands against the server over stdio.
3. `score.ts` compares the Draft with `demo-hall.json`. It matches Zones by place (IoU ≥ 0.5), not by id, after lining up the two Outlines.

```sh
node packages/mcp/eval/demo-hall-agent.ts hall-a.png out/ https://www.figma.com/design/…?node-id=1-2
node packages/mcp/eval/score.ts packages/mcp/eval/demo-hall.json out/draft/plan.json
```

Result of the run on 2026-10-22:

| Measure                            | Result                     |
| ---------------------------------- | -------------------------- |
| Zones matched                      | 62 / 62, none extra        |
| Mean IoU of matched Zones          | 1.00                       |
| Zone area IoU, whole hall          | 1.00                       |
| Same category / label / restricted | 62 / 62 / 62               |
| Wall length                        | 200 m of 200 m             |
| Openings matched / same kind       | 6 / 6, width error 0 m     |
| Obstacles matched                  | 6 / 6                      |
| Import Flags                       | 2 (fire lane, a west exit) |

**What this shows and what it doesn't.** The pipeline works end to end: calibration, coordinate conversion, Commands, preview, saving the folder, and opening it for review. But this is the easiest case. Every element is its own layer with exact geometry, and the mock-up was drawn from the same data it is scored against. Two harder cases are not measured yet:

- **Image only** (a scan, or a screenshot without layers): the agent has to read geometry from pixels.
- **A messy Figma file:** grouped or flattened shapes, labels detached from their shapes, and walls drawn as one path.

Both need a Source made independently of the expected plan before their scores mean anything.

`figma_extract` on the same frame, through its nodes recorded in `eval/hall-a.figma-nodes.json`, gives 61 of the 62 Zones at IoU 1.0 with the right category and label, 4 Walls meeting at 4 Wall Nodes (200 m), 6 of 6 Openings on the right Walls, and 6 of 6 columns. The missing Zone is "Fire lane": its name follows no convention, so it is listed as skipped and is the agent's to draw. A run against the live REST API on 2026-10-22 gave the same nodes field for field and the same result, through the MCP server over stdio as well. A test (`figmaExtract.test.ts`) keeps this result.

## When something doesn't work

| What you see                                                  | Why, and what to do                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent has no Areaform tools                               | The server isn't connected. Claude Code: `claude mcp list`; added without `-s user`, it only exists in the folder it was added in. Claude Desktop: check the absolute Node path and the JSON, then restart the app. |
| `Cannot find package` or a syntax error on start              | Run `pnpm install` in the repository, and use Node 24.                                                                                                                                                              |
| `No Draft yet: call create_draft or open_document first`      | The server was restarted (or a new chat started a new one), and the Draft is gone. Start again, and save sooner.                                                                                                    |
| `FIGMA_TOKEN is not set for the Areaform server`              | Add the token to the server's environment (see [Figma](#figma)). The agent can still work from `get_metadata` and the screenshot.                                                                                   |
| `Figma answered 403`                                          | The token has expired or lacks **File content: Read only**, or your Figma account can't open that file.                                                                                                             |
| `The Draft is not calibrated…`                                | The frame has no `Dimension <n> m` layer: tell the agent a known length on the Source.                                                                                                                              |
| `… does not match the calibrated Source of … in aspect ratio` | The image isn't of the whole Source (a crop, or another frame). Take the whole frame.                                                                                                                               |
| `Could not download the image: the server answered 403`       | A `get_screenshot` link expired. Ask for a new screenshot and attach it straight away.                                                                                                                              |
| `… plan.json already exists; pass overwrite to replace it`    | The folder holds an earlier Draft. Name another folder, or let the agent overwrite it.                                                                                                                              |
| The Source image is blank in the Playground                   | Only `plan.json` was imported. Import the whole folder, or pick `plan.json` and the image together.                                                                                                                 |

## Limits

- One Level per Draft. Several Levels, Connections and re-import over a reviewed plan are not supported yet.
- The server runs on your machine only. A remote server (no local set-up, for claude.ai on the web too) is planned: see [the design](../product/mcp-import-design.md#later-a-remote-server).
