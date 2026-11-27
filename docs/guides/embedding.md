# Embedding guide

How to put Areaform into your own application: create and load Documents, show them to visitors, let people edit them, and keep your backend in sync. Every export is listed with its doc comment in the API reference (`pnpm docs:api` writes it to `docs/api/`). For the vocabulary (Space, Level, Wall Node, Zone, Connection, …) see [`CONTEXT.md`](../../CONTEXT.md); for the decisions behind the design see [`adr/`](../adr/).

> For a site owner who pastes the hosted snippet (`embed.js`), the public docs are at [areaform.app/docs](https://areaform.app/docs/). This guide is for developers using the packages.

> Install what you need from npm, for example `npm install @areaform/view three` to show a Space, or `npm install @areaform/editor three react react-dom` to edit one. Inside the repository the packages resolve to their source; `pnpm build` produces what is published.

**Any framework.** The View is plain TypeScript and needs no framework: start with [plain JavaScript](#quick-start-plain-javascript), use the [React components](#showing-a-space-areaformview), or wrap it in [Vue](#vue) (or Svelte, Angular, …) in a few lines. The Editor's ready-made interface is React; outside React it runs as a React island, or you build your own interface on its [framework-free controller](#without-react).

## The packages

| Package               | What it is                                                                                                                                                                                                   | Depends on                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `@areaform/core`      | The Document model, Commands, undo/redo, Invariants, Diagnostics, JSON loading and query helpers. No framework, no DOM.                                                                                      | —                                                   |
| `@areaform/render-2d` | Draws a Document with PixiJS: camera, hit-testing, element events, Style Overrides.                                                                                                                          | core, `pixi.js`                                     |
| `@areaform/render-3d` | A read-only 3D preview of a Level with Three.js: orbit, pan and zoom.                                                                                                                                        | core, render-2d; `three` (peer)                     |
| `@areaform/view`      | The View for visitors: `createView` in plain TypeScript, `<AreaformView>` and `<Areaform3DView>` under `@areaform/view/react`, Plugins (`@areaform/view/plugins/tooltip`); `@areaform/view/styles.css`. MIT. | core, render-2d, render-3d; `react` (optional peer) |
| `@areaform/editor`    | Editing tools and the framework-free controller; `<AreaformEditor>` and `<CreateSpaceForm>` under `@areaform/editor/react`; `@areaform/editor/styles.css`, which includes the View's.                        | core, render-2d, render-3d, view; `react` (peer)    |

Use `core` alone on a server (validation, conversion, analytics), `render-2d` or `render-3d` for a custom viewer, `view` to show a Space to visitors (with or without React), and `editor` to author one.

The components need a stylesheet: `import '@areaform/view/styles.css'` for the View, or `import '@areaform/editor/styles.css'` for the Editor, which includes the View's. With TypeScript, that import is typed by your bundler (for Vite, `vite/client`).

PixiJS is loaded on the first `createRenderer` call (the React components make it when the canvas mounts) through a dynamic `import()`, so bundlers put it in its own chunk: pages that only use `core`, or the editor's pure helpers, never download it. Three.js works the same way: it is loaded the first time someone switches to 3D, so pages that only show the plan in 2D never download it. Install `three` alongside the packages (npm and pnpm install peer dependencies by themselves).

### What a page downloads

Measured by `pnpm size` ([`scripts/size/`](../../scripts/size/check.ts)) on 2026-11-24: each import below bundled by Vite as a site's build would, React left out (your page has it). Sizes are what a browser downloads, compressed; CI fails if a stage grows more than 10 % past these, or if Three.js loads before 3D is asked for.

| What you import                                 | At once           | To draw the plan in 2D (+ PixiJS) | After the first switch to 3D (+ Three.js) |
| ----------------------------------------------- | ----------------- | --------------------------------- | ----------------------------------------- |
| `createView` from `@areaform/view`              | 14 KB gzip, 12 br | 199 KB gzip, 171 br               | 361 KB gzip, 302 br                       |
| `AreaformEditor` from `@areaform/editor/react`  | 75 KB gzip, 63 br | 252 KB gzip, 215 br               | 412 KB gzip, 345 br                       |
| `createSpace`, `fromJSON`, `toJSON` from `core` | 5 KB gzip, 5 br   | —                                 | —                                         |

Most of the 2D stage is PixiJS, and most of the 3D one is Three.js. Plugins such as Wayfinding load the same way, when a Space uses them. The packages are marked free of side effects (except their stylesheets), so a bundler keeps only what you import.

## Quick start: plain JavaScript

A page that shows an exhibition hall, colours its booths from your own data and answers a click, with no framework. `plan.json` is any saved plan, such as [`samples/expo.json`](../../samples/expo.json). With Vite (`npm install @areaform/core @areaform/view three vite`, then `npx vite`):

```html
<div id="plan" style="height: 600px"></div>
<p id="picked">Click a booth</p>
<script type="module" src="/main.js"></script>
```

```js
import { fromJSON } from '@areaform/core';
import { createView } from '@areaform/view';
import { tooltip } from '@areaform/view/plugins/tooltip';
import '@areaform/view/styles.css';

// Your own data: which booths are taken.
const taken = new Set(['A-1', 'A-2', 'B-4']);

const response = await fetch('/plan.json');
const loaded = fromJSON(await response.text());
if (!loaded.ok) throw new Error('The plan does not load');

const view = createView(document.getElementById('plan'), {
    doc: loaded.doc,
    controls: true,
    plugins: [tooltip()],
    // Colours from your data, drawn over the plan and never saved in it.
    styleResolver: (ref, element) =>
        ref.kind === 'zone' && element.category === 'booth'
            ? { fill: taken.has(element.label) ? '#d4d4d4' : '#bfe3c0' }
            : undefined,
});

view.on('elementClick', (e) => {
    if (e.ref.kind !== 'zone') return;
    const level = view.getDocument().levels.find((l) => l.id === e.ref.levelId);
    const zone = level?.zones.find((z) => z.id === e.ref.id);
    if (!zone) return;
    document.getElementById('picked').textContent =
        `${zone.label}: ${taken.has(zone.label) ? 'taken' : 'free'}`;
    view.highlight([e.ref]);
});
view.on('ready', () => console.log('areaform: 2D ready'));
```

The 2D plan draws at once; **3D** in the plan controls loads Three.js the first time it is pressed. Everything the View can do is in [Without React](#without-react) and in the API reference.

A bigger example in plain TypeScript is [the live car park](../../apps/examples/live-parking): spots coloured by a sensor feed, free spaces per Level, and the drive from the gate to the best free spot and the walk on to the lift, both found with `@areaform/wayfinding`. It runs at [areaform.app/examples/live-parking](https://areaform.app/examples/live-parking/).

## Documents

A **Document** is one Space: its Levels (floors), and on each Level the Outline, Walls, Openings, Zones, Obstacles and Underlays; Connections (stairs, lifts) join Levels. Coordinates are metres, Y up ([ADR-0002](../adr/0002-y-up-ccw-coordinates.md)). Documents are plain, immutable JSON-compatible objects.

```ts
import { createSpace, fromJSON, toJSON } from '@areaform/core';

// A new Space: one Level with a rectangular Outline. The Space Kind picks a Preset
// (grid step, ceiling height, and the Zone Categories the editor suggests).
const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [60, 36] });

// Saving is plain JSON.
const json = toJSON(doc);

// Loading never throws: it checks the structure and every Invariant.
const loaded = fromJSON(json);
if (loaded.ok) {
    console.log(loaded.doc.name);
} else {
    console.error(loaded.errors); // e.g. { code: 'malformed', path, expected }
}

// With `repair`, Elements that break an Invariant are dropped and reported instead.
const repaired = fromJSON(json, { repair: true });
if (repaired.ok && repaired.repairs.length > 0) console.warn(repaired.repairs);
```

Documents saved by an older version of the library load unchanged in a newer one: `fromJSON` upgrades them to the current `schemaVersion` first and reports `migratedFrom` ([ADR-0006](../adr/0006-schema-versions-and-migrations.md)). Save the Document again to store it in the new version. A file from a newer library fails with `{ code: 'newer-version', version }`, so you can ask the user to update. `migrate(data)` runs the same upgrade on parsed JSON without loading it.

Space Kinds with Presets: `exhibition`, `office`, `store`, `warehouse`, `cafe`, `mall`, `flat` (`defaultPresets`); any other string gets `genericPreset`. A Preset has a `label`, the `gridStep` and `levelHeight` copied into a new Space, and the Zone Categories it suggests, each with a `label` and whether it is an Exclusive Category (its Zones must not overlap), makes new Zones Restricted, or makes them Walk-around Zones that visitors' routes go around (`walkAround`, [ADR-0017](../adr/0017-wayfinding-inside-one-space.md)). `zoneCategory` is the one the Zone tool starts with. The Preset is looked up from `doc.kind` whenever it is needed, never stored in the Document.

Bring your own Space Kinds, or change the built-in ones, by passing `presets` wherever a Preset is looked up — `createSpace`, `diagnose(doc, { presets })` and `presetFor(kind, presets)`:

```ts
import { createSpace, defaultPresets } from '@areaform/core';

const presets = {
    ...defaultPresets,
    parking: {
        label: 'Parking',
        gridStep: 2.5,
        levelHeight: 2.4,
        categories: [
            { id: 'spot', label: 'Parking spot', exclusive: true },
            { id: 'lane', label: 'Driving lane', restricted: true },
        ],
        zoneCategory: 'spot',
    },
};
const garage = createSpace({ name: 'Garage', kind: 'parking', size: [80, 40], presets });
```

The Preset names categories but does not colour them: colours come from the renderer's `Theme.categories`.

## Changing a Document: the Editor and Commands

Every change is a serialisable **Command**, applied through an **Editor** that keeps the current Document and its undo history.

```ts
import { createEditor, createSpace } from '@areaform/core';

const editor = createEditor(createSpace({ name: 'Hall A', kind: 'exhibition', size: [60, 36] }));
const levelId = editor.getDocument().levels[0]!.id;

const result = editor.exec({
    type: 'zone.add',
    levelId,
    zone: {
        label: 'A-1',
        category: 'booth',
        data: { exhibitor: 'Acme' }, // anything your application needs
        shape: {
            outer: [
                [5, 5],
                [8, 5],
                [8, 8],
                [5, 8],
            ],
        },
    },
});
if (!result.ok) console.error(result.errors); // rejected by an Invariant; nothing changed

editor.undo();
editor.redo();
```

- **Commands** are `<element>.add`, `<element>.update` and `<element>.delete` for `level`, `wall`, `opening`, `zone`, `obstacle`, `underlay` and `connection`, plus `level.setOutline`, `level.move`, `level.duplicate`, `wallNode.move`, `wallNode.merge`, `wall.split`, `walls.fromOutline`, `underlay.calibrate`, `space.update` (the Space's name, Space Kind, grid, geo anchor, Content Languages and your own `meta`), `text.set` (one text in one Content Language, see below) and `batch` (several Commands as one). TypeScript lists them all under the `Command` type.
- **Walls** form a graph ([ADR-0001](../adr/0001-walls-as-a-graph.md)): `wall.add` takes two points (or existing Wall Nodes) and splits Walls it meets, so corners stay joined; move a corner with `wallNode.move`.
- **Invariants** (dangling references, self-intersecting shapes, a Connection with fewer than two Stops, …) reject a Command as a whole. **Diagnostics** (`diagnose(doc)`) are softer: overlapping booths, a Zone outside the Outline, a door that no longer fits its Wall. Show them, but they never block an edit.
- **Transactions** group Commands into one undo step (the editor uses one per drag): `const tx = editor.begin(); tx.exec(…); tx.commit()` (or `tx.cancel()`).
- **`preview(command)`** dry-runs a Command and lists what it would remove, e.g. to warn before a delete that cascades to the doors on a Wall.

### Keeping your backend in sync

```ts
import { createEditor, createSpace, toJSON } from '@areaform/core';

declare function saveToMyBackend(json: string): void;

const editor = createEditor(createSpace({ name: 'Hall A', kind: 'exhibition', size: [60, 36] }));
const stop = editor.on('change', (doc, previous) => {
    saveToMyBackend(toJSON(doc));
});
// Later: stop();
```

`change` fires after every applied Command, undo and redo. Unchanged Levels and Elements keep their object identity between Documents ([ADR-0005](../adr/0005-snapshot-history-and-reference-diffing.md)), so `previous.levels[i] === doc.levels[i]` tells you cheaply what did not change.

To store a Space as rows rather than one JSON blob, `diff(previous, doc)` lists what changed, row by row:

```ts
import { diff, type DocumentDiff } from '@areaform/core';

declare function syncRows(changes: DocumentDiff): void;

editor.on('change', (doc, previous) => syncRows(diff(previous, doc)));
```

A `DocumentDiff` has `added` and `updated` entries, each a `{ ref, value }`, and `removed` refs. A row is one of:

- a Level's own properties, without its Element lists;
- an Element: a Wall Node, Wall, Opening, Zone, Obstacle or Underlay;
- a Connection, which includes its Stops.

`document` holds the Space's own properties when they changed. Additions list a Level before its Elements, and removals list a Level after them, so foreign keys hold. Unchanged parts are skipped by reference and the rest compared by value, so a Document reloaded from JSON diffs as empty. One edit on a 10,000-Wall Space diffs in a few milliseconds. The order of Elements within a list is not reported.

## Showing a Space: `<AreaformView>`

From `@areaform/view/react`, a React wrapper over `createView` (see [Without React](#without-react)).

A read-only plan for visitors: pan, zoom, click, hover and highlight. It never changes the Document.

```tsx
import type { AreaformDocument, Zone } from '@areaform/core';
import { AreaformView } from '@areaform/view/react';
import type { StyleResolver } from '@areaform/render-2d';
import '@areaform/view/styles.css';

declare const doc: AreaformDocument;
declare const soldBooths: Set<string>;
declare function showBooth(zoneId: string): void;

// Style Overrides: colours from your own data at runtime, never saved in the Document.
const bookingColours: StyleResolver = (ref, element) => {
    if (ref.kind !== 'zone' || (element as Zone).category !== 'booth') return undefined;
    return soldBooths.has(ref.id) ? { fill: '#c9c9c9' } : { fill: '#bfe3c0' };
};

export function HallMap() {
    return (
        <div style={{ height: 600 }}>
            <AreaformView
                doc={doc}
                styleResolver={bookingColours}
                onElementClick={(e) => {
                    if (e.ref.kind === 'zone') showBooth(e.ref.id);
                }}
            />
        </div>
    );
}
```

| Prop                | Type                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc`               | `AreaformDocument`                        | Required. Pass a new Document to update the view.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `levelId`           | `string`                                  | The Level to show; the first by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `theme`             | `Theme`                                   | The plan's look in 2D and 3D: category colours and icons, label sizes (see [Theming](#theming)). Read when the view mounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `styleResolver`     | `(ref, element) => Style \| undefined`    | Style Overrides: `fill`, `stroke`, `strokeWidth`, `opacity`. Return `undefined` to keep the default. The 3D view applies them to Zones only.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `labelResolver`     | `(zone) => { text?, logo? } \| undefined` | A runtime name and logo per Zone, e.g. a booth's exhibitor (see [Runtime names and logos](#runtime-names-and-logos)). Shown in 2D and 3D; never saved.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `contentLanguage`   | `string`                                  | The Content Language to show the Space's text in, e.g. the visitor's (see [Content Languages](#content-languages)); `locale` when absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `resolveAsset`      | `(src: string) => string`                 | Finds Underlay images by their `src`, e.g. files you hold as `blob:` URLs for a Draft folder whose plan names `source.png`. The Document keeps the original `src`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `highlight`         | `ElementRef[]`                            | Elements to draw highlighted, e.g. search results. In 3D, Zones only, outlined in the Theme's `highlight` stroke.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `wheel`             | `'auto' \| 'zoom' \| 'pan'`               | What scrolling does; `auto` pans on a trackpad and zooms on a pinch or mouse wheel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `gestures`          | `'greedy' \| 'cooperative'`               | Who gets a plain wheel and one finger (default `greedy`, the plan). `cooperative` leaves them to the page and moves the plan with ⌘/Ctrl + wheel, a pinch or two fingers, with a short hint ([ADR-0025](../adr/0025-camera-motion-viewpoints-and-cooperative-gestures.md)). For a plan on a page that scrolls.                                                                                                                                                                                                                                                                               |
| `motion`            | `'none' \| 'orbit' \| 'tour'`             | The 3D camera moving on its own until the first interaction or **Pause** (default `none`): `orbit` turns it about once a minute; `tour` flies through the Viewpoints of the Level shown, round and round, turns around a single one, and is `orbit` on a Level without any. Picking a Level in the Level switcher or switching to 3D plays it again for what is shown. It waits off screen and in a hidden tab, and never moves under `prefers-reduced-motion`. 2D stays still. With `controls`, a **Play / Pause** toggle shows in 3D; Pause sticks, and Play moves it on from where it is. |
| `motionResume`      | `number`                                  | Seconds, at least 5, without an interaction after which a camera stopped by a touch moves again; off by default. Never after Pause or under reduced motion, nor while a Plugin holds it with `view.holdMotion(reason, on)`, as Wayfinding does while its card or route is shown. For a Kiosk.                                                                                                                                                                                                                                                                                                |
| `grid`              | `boolean`                                 | Draw the grid over the floor: lines at the Document's Grid Step, every fifth stronger, thinned out when zoomed out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `rulers`            | `boolean`                                 | Rulers in metres along the plan's top and left edges, numbering the grid's strong lines (default off).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `origin`            | `boolean`                                 | Mark the origin, 0/0, which all Levels share: a cross with X → and Y ↑ arrows (default off).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `controls`          | `boolean`                                 | Show **2D / 3D**, **Fit** and **Show grid** buttons in the plan's bottom-right corner (default off).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `defaultView`       | `'2d' \| '3d'`                            | The view at the start (default `2d`); without WebGL 2, `3d` starts in 2D. See [the 3D preview](#the-3d-preview).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `view`              | `'2d' \| '3d'`                            | The view shown, when you own it; pair it with `onViewChange`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `onViewChange`      | `(view: ViewMode) => void`                | The user switched between 2D and 3D.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `views`             | `ViewMode[]`                              | The views to switch between (default both); `['2d']` hides the switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `onGridChange`      | `(on: boolean) => void`                   | The user pressed **Show grid**; pass the new value back as `grid`. Without it, **Show grid** is not shown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `onElementClick`    | `(e: ElementEvent) => void`               | `e.ref` is `{ kind, id, levelId }`, `e.point` the plan position in metres, `e.screen` the canvas position in CSS pixels from its top-left corner (e.g. to place a popup), `e.originalEvent` the DOM event.                                                                                                                                                                                                                                                                                                                                                                                   |
| `onBackgroundClick` | `(e: BackgroundEvent) => void`            | A click on empty floor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `onElementHover`    | `(e: HoverEvent) => void`                 | Fires when the pointer moves onto another Element; `e.ref` is `null` when it leaves every Element. `e.point` and `e.screen` as in `onElementClick`, e.g. to place a tooltip.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `onZoomChange`      | `(zoom: number) => void`                  | Screen pixels per metre.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `onReady`           | `(renderer: Renderer) => void`            | The underlying renderer once the canvas exists, e.g. to `fitLevel()` or read the camera.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ref`               | `Ref<View \| null>`                       | The View, for its methods: `flyTo`, `lookAt`, `setProgress`, `getCamera`, `setLevel` (see [the camera driven by the page](#the-camera-driven-by-the-page)).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `onViewpoint`       | `(e: { id, levelId }) => void`            | A flight started with `flyTo` arrived, at a Viewpoint (its `id`) or at a camera (`id` is `null`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `onZoneClick`       | `(e: { id, levelId, data }) => void`      | A visitor clicked a Zone, in 2D or 3D, with its `data`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `onTourStep`        | `(e: { id, levelId, index }) => void`     | The tour (`motion="tour"`) reached a Viewpoint, `index` in its Level's list, and stays a while.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `onReady3d`         | `(renderer: Renderer3D) => void`          | The 3D renderer each time the 3D view is shown, e.g. for `toScreen` to place a tooltip over a Zone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

The component fills its parent, so give the parent a height.

## Editing a Space: `<AreaformEditor>`

The complete authoring UI: toolbar, canvas, Level switcher and panel, properties panel, delete confirmation. It edits the Document held by a core Editor that you create and own.

```tsx
import { createEditor, createSpace, toJSON, type Editor } from '@areaform/core';
import { AreaformEditor } from '@areaform/editor/react';
import '@areaform/editor/styles.css';
import { useEffect, useState } from 'react';

declare function saveToMyBackend(json: string): void;

export function HallEditor() {
    const [editor] = useState<Editor>(() =>
        createEditor(createSpace({ name: 'Hall A', kind: 'exhibition', size: [60, 36] })),
    );
    useEffect(() => editor.on('change', (doc) => saveToMyBackend(toJSON(doc))), [editor]);

    return (
        <div style={{ height: '100vh' }}>
            <AreaformEditor
                editor={editor}
                units="metric"
                onSelectionChange={(refs) => console.log('selected', refs)}
                onLevelChange={(levelId) => console.log('now on', levelId)}
            />
        </div>
    );
}
```

| Prop                                           | Type                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor`                                       | `Editor`                                    | Required. Create it with `createEditor`; to open another Document, create a new Editor.                                                                                                                                                                                                                                                                                                                                                                                |
| `theme`                                        | `Theme`                                     | As in the View. Read when the editor mounts.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `resolveAsset`                                 | `AssetResolver`                             | Finds Underlay images by their `src`, as in the View.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `styleResolver`                                | `StyleResolver`                             | Style Overrides, as in the View.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `labelResolver`                                | `LabelResolver`                             | Runtime logos, as in the View. The editor shows the logos only and keeps the Document's names, the ones being edited.                                                                                                                                                                                                                                                                                                                                                  |
| `wheel`                                        | `'auto' \| 'zoom' \| 'pan'`                 | As in the View.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `units`                                        | `'metric' \| 'imperial'`                    | Display units; the toolbar's **m / ft** switches too. Documents always store metres.                                                                                                                                                                                                                                                                                                                                                                                   |
| `dimensions`                                   | `boolean`                                   | Always-on dimensions at the start (default off); the toolbar's **Dimensions** toggles them.                                                                                                                                                                                                                                                                                                                                                                            |
| `onUnitsChange`                                | `(units: DisplayUnits) => void`             | The user switched units in the toolbar, e.g. to remember the choice.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `onDimensionsChange`                           | `(on: boolean) => void`                     | The user toggled always-on dimensions in the toolbar.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `foldedSections`                               | `SidebarSection[]`                          | The sidebar's sections folded shut at the start: `'properties'`, `'levels'`, `'viewpoints'`, `'page'` (**For your page**), `'languages'`, `'location'` (Problems never folds). When absent, all but Properties start folded (`DEFAULT_FOLDED_SECTIONS`); a change of this prop folds them again.                                                                                                                                                                       |
| `onFoldedSectionsChange`                       | `(sections: SidebarSection[]) => void`      | The user folded or opened a section by its heading, e.g. to remember it.                                                                                                                                                                                                                                                                                                                                                                                               |
| `grid`                                         | `boolean`                                   | Show the grid at the start (default off); **Show grid** in the plan's corner toggles it. Rulers and the origin mark come with it, in the toolbar's units; the origin mark is also shown while drawing.                                                                                                                                                                                                                                                                 |
| `onGridChange`                                 | `(on: boolean) => void`                     | The user showed or hid the grid.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `presets`                                      | `Record<string, Preset>`                    | The Presets the Space Kind is looked up in (default `defaultPresets`): which Zone Categories are suggested, and which one the Zone tool starts with. Read when the editor mounts.                                                                                                                                                                                                                                                                                      |
| `tools`                                        | `PickableTool[]`                            | The tools in the toolbar, in this order, e.g. `['select', 'zone', 'door']`; the others' shortcuts do nothing. All by default.                                                                                                                                                                                                                                                                                                                                          |
| `shortcutsButton`                              | `boolean`                                   | The **Keyboard shortcuts** button at the end of the toolbar; `true` by default. `?` opens the window either way.                                                                                                                                                                                                                                                                                                                                                       |
| `shortcutsOpen`, `onShortcutsOpenChange`       | `boolean`, `(open: boolean) => void`        | Whether the keyboard shortcuts window shows, when you own it, e.g. to open it from your own Help menu. `?`, the toolbar button, Esc and a click beside the window then only report what the user asked for. Without `shortcutsOpen` the editor keeps its own.                                                                                                                                                                                                          |
| `selection`                                    | `ElementRef[]`                              | Elements to select, e.g. from your own list of problems: a new array selects them, showing their Level first. A Level ref only shows the Level.                                                                                                                                                                                                                                                                                                                        |
| `onSelectionChange`                            | `(refs: ElementRef[]) => void`              | Fires when the selection changes.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `problems`                                     | `boolean`                                   | The **Problems** list at the top of the sidebar while the plan has any (default `true`): every Diagnostic in words ("A-1 overlaps A-2") and the Zones visitors cannot walk to ("Visitors can't reach Meeting room: no door or passage leads to it"), with the Level beneath; a click selects the Element. Checked shortly after edits stop; the route check (`unreachableZones` from `@areaform/wayfinding`, loaded on first use) redoes only the Levels that changed. |
| `hereLink`                                     | `(here: string) => string`                  | Makes a link that opens the published plan with visitors' routes starting at `here` (a value for the Wayfinding Plugin's `here`, as from `?here=`), e.g. for a QR code; shown with **Copy link** beside each Here value. Without it only the value is shown.                                                                                                                                                                                                           |
| `onToolChange`                                 | `(tool: ToolName) => void`                  | `select`, `wall`, `zone`, `door`, `obstacle`, `connection`, `outline`, `ruler`, `calibrate`.                                                                                                                                                                                                                                                                                                                                                                           |
| `onLevelChange`                                | `(levelId: string) => void`                 | Another Level is shown, including after the shown one is deleted or undone away.                                                                                                                                                                                                                                                                                                                                                                                       |
| `onReady`                                      | `(renderer: Renderer) => void`              | As in the View.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `onReady3d`                                    | `(renderer: Renderer3D) => void`            | As in the View.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `defaultView`, `view`, `onViewChange`, `views` |                                             | As in the View. In 3D the drawing tools and their keys wait (their buttons are greyed out), while undo, redo, `Delete` and the panels keep working and show up in 3D straight away.                                                                                                                                                                                                                                                                                    |
| `renderProperties`                             | `(context: PropertiesContext) => ReactNode` | Your own fields in the sidebar, under the built-in properties; see below.                                                                                                                                                                                                                                                                                                                                                                                              |

Your own data on Elements (a Zone's `data`, say a booth's price) gets fields through `renderProperties`. It is called with `{ selection, doc, level, editor }` (`selection` is empty when the Level's properties are shown), and what it returns is shown under the built-in properties. Change the Document through `editor.exec`, so the edit is undoable like any other:

```tsx
import type { Editor } from '@areaform/core';
import { AreaformEditor } from '@areaform/editor/react';

declare const editor: Editor;

export function BoothEditor() {
    return (
        <AreaformEditor
            editor={editor}
            renderProperties={({ selection, level, editor }) => {
                const ref = selection.length === 1 ? selection[0] : undefined;
                const zone =
                    ref?.kind === 'zone' ? level.zones.find((z) => z.id === ref.id) : undefined;
                if (!zone) return null;
                const price = (zone.data as { price?: number } | undefined)?.price ?? '';
                return (
                    <label>
                        Price
                        <input
                            type="number"
                            defaultValue={price}
                            onBlur={(e) =>
                                editor.exec({
                                    type: 'zone.update',
                                    levelId: level.id,
                                    zoneId: zone.id,
                                    changes: {
                                        data: { ...zone.data, price: Number(e.target.value) },
                                    },
                                })
                            }
                        />
                    </label>
                );
            }}
        />
    );
}
```

Saving is up to you: the editor never stores anything. To keep a preference, store what `onUnitsChange`, `onDimensionsChange` and `onFoldedSectionsChange` report and pass it back as `units`, `dimensions` and `foldedSections` next time. The playground does this with `localStorage`, plus an optional autosave of the Document; see `apps/playground/src/storage.ts`.

The editor needs a sized parent and keyboard focus for its shortcuts (it takes focus when clicked). `?` or the toolbar's **Keyboard shortcuts** button opens a window listing every key and gesture, by group, with ⌘ on macOS and Ctrl elsewhere. It leaves out tools you hide with `tools`, and dims what works only in the other view. Esc closes it and leaves a half-drawn shape as it was. Letter keys work on any keyboard layout: on a Cyrillic layout, the key in the place of W still picks the Wall tool.

A lone selected Zone, Obstacle or Stop shows a handle on every corner and in the middle of every side. Dragging a corner of a rectangle (at any angle) keeps it a rectangle with the opposite corner in place, and dragging a side handle moves that side; hold `Shift` to move just the corner, or to add a corner at the side handle. On other shapes a corner moves alone and a side handle adds a corner. A clicked corner is highlighted and `Delete` removes it. The properties panel shows a rectangle's **Width** and **Depth**, which can be typed (keeping its top-left corner on screen), and the area of any shape.

| Key                             | Does                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `V` `W` `Z` `D` `O` `C` `E` `M` | Select, Wall, Zone, Door, Obstacle, Connection, Outline, Ruler                         |
| `⌘Z` / `⇧⌘Z`                    | Undo / redo                                                                            |
| `⌘C` `⌘X` `⌘V` `⌘D`             | Copy, cut, paste (through the system clipboard), duplicate                             |
| `R` / `⇧R`                      | Turn the selection a quarter                                                           |
| `F` / `⇧F`                      | Flip the selected doors to open the other way / hang them from the other jamb          |
| `Delete`                        | Delete the clicked corner of a shape, else the selection (asks first if more would go) |
| `Esc`                           | Finish or cancel what is in progress, then clear the selection                         |
| `Alt` (held)                    | Draw or drag without snapping                                                          |
| `?`                             | Show the keyboard shortcuts                                                            |

The list behind the window is exported as `SHORTCUTS` from `@areaform/editor`, with `SHORTCUT_GROUPS` and `formatKeys(keys, platform)` (`detectPlatform()` gives the platform), so your own help can show the same keys.

While the Zone tool is active, the toolbar has a **Zone category** field: the category new Zones get, starting at the Preset's `zoneCategory`. Like the **Category** field in a Zone's properties, it suggests the Preset's categories and also takes any other text; a suggested category typed by its label (`Meeting room`) is stored by its id (`meeting-room`). Giving a Zone a category the Preset marks Restricted or Walk-around turns that on for the Zone too (and never off). Both are checkboxes in a Zone's properties (**Restricted**, **Visitors walk around it**); with several Zones selected, the same two checkboxes set them all at once, as one undo step, and show a mixed state when the Zones differ.

`<CreateSpaceForm onCreate={(doc) => …} units="imperial" presets={presets} />` is the creation wizard (Space Kind, size, grid step) as a separate component; it offers the Kinds of `presets`, by their labels.

## The 3D preview

Both components have a **2D / 3D** switch in the plan's corner (in the View, with `controls`). The 3D view shows the current Level, read-only:

- the floor as a slab under the Outline, open at its holes and at voids;
- Walls at their own height or the Level's ceiling height, with mitred corners. Doors and passages are cut up to `doorHeight` (2.1 m) with a lintel above; entrances and emergency exits are open to the top. Walls nearer the camera than the point it orbits around go down to a 0.3 m kerb as you come near enough to read the names, so they never hide them; the whole Wall goes down together, eased as you orbit and zoom. From straight above, and while a name of the Theme's `labelSize` at that point would still be under ¾ of `minLabelPx`, every Wall stands as it is, so a big hall seen from afar shows the building; they are down by the time names fade in at `minLabelPx`, so a small plan may open with them down. Pins hide only behind Walls that would stand up close, so in a far view they still show over the Walls in front (`cutaway={false}` keeps every Wall standing);
- Zones as coloured patches on the floor, outlined in their stroke as wide on screen as in 2D, so a row of booths reads as separate booths. The host's Style Overrides (`fill`, `stroke`, `strokeWidth`, `opacity`) and the `highlight` apply as in 2D; Obstacles to the ceiling, Stops as blocks in their Connection's colour with the Connection's icon on top (sized as in 2D, coloured by `theme3d.connections[kind].icon`), and a strip across the floor of every Opening (green for emergency exits);
- Zone names painted on the floor, laid out as in 2D ([ADR-0010](../adr/0010-3d-labels-floor-text-through-an-sdf-atlas.md)). They turn round when you look from the north, so they always read upright, and are hidden while smaller than the Theme's `minLabelPx` on screen, so zoom in to read them. Underlays and the grid are left out.

In both views a Zone's name is centred on its `labelAnchor` (its visual centre by default) and kept inside the Zone: a name too wide for it wraps onto two lines, then shrinks. `labelSize` (or the Theme's) is the largest it may be. A name that cannot shrink to a fifth of that and still fit is left out.

Drag to orbit, right-drag or `Shift`-drag to pan, and scroll to zoom towards the pointer. On a touch screen, one finger orbits, two fingers pinch to zoom and pan, and a tap is a click. With `gestures="cooperative"` the page keeps a plain scroll and one finger: ⌘/Ctrl + scroll or a pinch zooms, and two fingers orbit and pinch. The hint a plain scroll brings up also says how to move the plan: a drag in 2D, Ctrl + drag in 3D. In 2D, two fingers pan and pinch to zoom. The canvas is drawn at most 2 device pixels per CSS pixel (`maxPixelRatio`), and when the browser drops the WebGL context and gives it back, the view draws itself again. **Top view** looks straight down with north up, **Angled view** goes back to the starting ¾ view, and **Fit** frames the whole Level from the current angle. Clicks and hovers give the same events as in 2D, `point` being where on the plan the pointer is; a lowered Wall is only its kerb, so a click above it lands on what is behind (a click on the sky gives `backgroundClick` with the point the camera looks at). In the Editor, a click in 3D selects the Element and the properties panel shows it; drawing stays in 2D. Its **Viewpoints** section saves the 3D camera as it is (**Add this viewpoint**) for the camera tour (`motion="tour"`): each has a name, a flight and a stay time, **Copy** (a `flyTo` line for the client's page), **Go to**, **Use this view** to save the camera in its place, a place in the order and delete, and **Play tour** plays it until the plan is touched. The **For your page** section copies ready lines for a page that moves the camera (see [the camera driven by the page](#the-camera-driven-by-the-page)). In 2D the list stays, and the plan shows each one as a numbered camera mark with a wedge towards what it looks at. A renderer's `toScreen(point, height)` gives where a plan point is on the canvas, e.g. to place a tooltip. The camera is kept while you switch back and forth, and keeps its angle when the Level changes. Edits, undo and a new `doc` show up immediately; only a Level that changed is rebuilt.

Without WebGL 2 the **3D** button is greyed out, and a View asked to start in 3D starts in 2D (unless `views` leaves 2D out).

On Areaform's hosting, the owner picks how `embed.js` first shows a Space in the Publish dialog (**Show the plan first as**): the 2D plan, 3D, or `auto`, which is 3D when the plan is at least 480 px wide and 2D on a phone. The choice reaches the client's site on its next page load, with no new Publish. A page can say otherwise with `data-view` on the snippet's element, or `?af-view=` in its address (for a QR code), each `2d`, `3d` or `auto`; `data-view` comes first. The address parameter has the `af-` prefix, so it never takes the site's own `?view=` for ours; `embed.js` reads the page's address and never changes it:

```html
<div data-areaform="sp_…" data-view="auto"></div>
```

`embed.js` always uses cooperative gestures, since a snippet sits on a page that scrolls; `data-gestures="greedy"` gives a full-page plan, such as a Kiosk, every gesture. Before ADR-0025 an embedded plan took a plain wheel, so pages relying on that now scroll instead. The owner picks how the 3D camera moves in the Publish dialog (**Camera in 3D**: _Still_, _Turn slowly_ or _Tour_), saved per Space and written into the manifest as `motion`, so it reaches the client's site with no new Publish; `data-motion="none"`, `"orbit"` or `"tour"` on the snippet wins over it, and moves the camera as `motion` does. `data-motion-resume` gives `motionResume`. Once the plan is drawn (`ready3d` in 3D, `ready` in 2D), the snippet's element sends a bubbling `areaform:ready` event; after it, the page can move the camera with `element.areaform` and hear the other `areaform:` events (see [the camera driven by the page](#the-camera-driven-by-the-page)).

While a plan loads, `embed.js` shows thin grey lines sketching a plan, then, once the Revision has arrived, the outline, Zones, Obstacles, Connection Stops and Walls of the Level shown first, drawn where the plan will be, until the renderer is ready; then they fade out. There is no logo in it, so it suits white-label plans, and under `prefers-reduced-motion` the lines are drawn at once and stay still. Screen readers hear "Loading the plan…" in the visitor's language. `startingLevel(doc)` from `@areaform/view` tells which Level a View shows first.

To place a 3D view yourself, e.g. next to the plan, use `<Areaform3DView>`:

```tsx
import type { AreaformDocument } from '@areaform/core';
import { Areaform3DView } from '@areaform/view/react';
import type { Camera3D } from '@areaform/render-3d';

declare const doc: AreaformDocument;
declare const savedCamera: Camera3D | undefined;
declare function saveCamera(camera: Camera3D): void;

export function Preview() {
    return (
        <div style={{ height: 400 }}>
            <Areaform3DView
                doc={doc}
                theme3d={{ background: '#ffffff', wall: '#e8e6df' }}
                doorHeight={2.2}
                {...(savedCamera && { camera: savedCamera })}
                onCameraChange={saveCamera}
            />
        </div>
    );
}
```

| Prop                | Type                             | Notes                                                                                                                               |
| ------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `doc`               | `AreaformDocument`               | Required.                                                                                                                           |
| `levelId`           | `string`                         | The Level to show; the first by default.                                                                                            |
| `theme`             | `Theme`                          | The 2D Theme, for the colours of Zones, Obstacles and Openings.                                                                     |
| `theme3d`           | `Partial<Theme3D>`               | Background, floor, slab, Wall faces and tops, label colour, and each Connection kind's colour and height.                           |
| `doorHeight`        | `number`                         | The top of doors and passages, metres (default 2.1).                                                                                |
| `labels`            | `boolean`                        | Zone names on the floor (default on); Stop icons show either way. A name's colour is the Zone's `labelColor`, else `theme3d.label`. |
| `cutaway`           | `boolean`                        | Once names are readable, Walls nearer the camera than the orbit point go down to a kerb (default on). Read when the view mounts.    |
| `maxPixelRatio`     | `number`                         | The sharpest the canvas is drawn, device pixels per CSS pixel (default 2); lower it for weak devices. Read when the view mounts.    |
| `labelResolver`     | `LabelResolver`                  | Runtime names and logos, as in the View.                                                                                            |
| `contentLanguage`   | `string`                         | As in the View.                                                                                                                     |
| `styleResolver`     | `StyleResolver`                  | Style Overrides for Zones, as in the View.                                                                                          |
| `highlight`         | `ElementRef[]`                   | Zones outlined in the Theme's `highlight`, e.g. search results.                                                                     |
| `camera`            | `Camera3D`                       | Where the camera starts, e.g. saved from `onCameraChange`; one from another Level keeps only its angle.                             |
| `gestures`          | `'greedy' \| 'cooperative'`      | As in the View.                                                                                                                     |
| `motion`            | `'none' \| 'orbit' \| 'tour'`    | As in the View.                                                                                                                     |
| `controls`          | `boolean`                        | **Top view**, **Angled view** and **Fit** buttons (default on).                                                                     |
| `onCameraChange`    | `(camera: Camera3D) => void`     | Fires as the camera moves.                                                                                                          |
| `onElementClick`    | `(e: ElementEvent) => void`      | A click on an Element, as in the View.                                                                                              |
| `onBackgroundClick` | `(e: BackgroundEvent) => void`   | A click on the bare floor, the ground or the sky.                                                                                   |
| `onElementHover`    | `(e: HoverEvent) => void`        | The pointer moved onto another Element, or off every Element.                                                                       |
| `onReady`           | `(renderer: Renderer3D) => void` | The underlying renderer, e.g. to `setView('top')`.                                                                                  |

## The camera driven by the page

A page can move the plan's camera itself: a story that flies through the building as the visitor scrolls (a scroll trigger), or an app that shows what its list is about. The View has the methods, `<AreaformView>` and `<Areaform3DView>` give the View through `ref`, and on a client's site `embed.js` puts them on the snippet's element as `element.areaform`.

```ts
import { createView } from '@areaform/view';

const view = createView(container, { doc, view: '3d', gestures: 'cooperative' });

await view.flyTo('vp_garden'); // a Viewpoint, by its id, on any Level
await view.lookAt('z_room-3-2'); // turn to a Zone, coming closer if it is small
await view.lookAt([12, 4], { distance: 15 }); // turn to a point, ending 15 m from it
view.setProgress(0.4); // 40 % of the way along the Level's Viewpoints, for a scroll library
view.setLevel('level-p1');
const camera = view.getCamera(); // { position, target, levelId }, for flyTo later
```

- **`flyTo(viewpointId | camera, { seconds }?)`** flies to a Viewpoint, in its own flight time (3 s unless it has one), or to a camera as `getCamera` gives it, in the 3D view's coordinates (metres; x east, y up, z south). It returns a Promise that resolves `{ interrupted: false }` on arrival, then the `viewpoint` event follows, or `{ interrupted: true }` when the visitor took the plan on the way or the page moved the camera again. An id the plan has no Viewpoint for rejects.
- **`lookAt(zoneId | [x, y], { seconds, distance }?)`** turns the camera to a Zone's middle or a plan point (metres), in 1.5 s, resolving as `flyTo` does. A Zone ends up between 40 % and 80 % of the view's shorter side (`ZONE_SHARE`): a small one, such as a locker or an office seen from across the building, brings the camera closer along its line of sight, and one too big to fit sends it back. A Zone already in between, and a point, keep the distance the camera has. `distance` says where to end up instead, in metres from the camera to what it looks at.
- **`setProgress(t)`** puts the camera `t` of the way along the shown Level's Viewpoints in tour order, from 0 at the first to 1 at the last. There is no flight and no event, so a scroll library can call it on every frame; a touch does not stop it, and the next call puts the camera back on the path. Each leg between two Viewpoints is an equal share, eased, so the camera settles on each Viewpoint. It covers one Level: a story that goes to another floor calls `setLevel` in its next part. Called before the view is ready, it waits for it.
- **`setLevel(levelId)`**, **`getLevelId()`** (`getLevel()` on `element.areaform`) and **`getCamera()`**.
- **Ids only, never names.** Names can repeat, change, and differ between Content Languages. The Editor's **Viewpoints** section has **Copy** on each Viewpoint, a ready line `el.areaform.flyTo('vp_…'); // its name`. Its **For your page** section (folded at first) gives the rest as ready lines: `setLevel` for the Level shown, `lookAt` for the Zone selected, **Pick a point to look at…** in 2D for `lookAt([x, y])` (any point, outside the building too, to a tenth of a metre), and **Copy camera** in 3D, the view as it is now with its Level, for a view you do not want as a Viewpoint. `foldedSections` names it `page`.
- **Another Level:** a Viewpoint or a Zone on another Level shows that Level first, as the Level switcher does, then flies or turns there.
- **In 2D** the methods pan and zoom the plan instead: to the point a Viewpoint looks at, as far out as it is; `lookAt` zooms by the same rule as in 3D, and `distance` gives the zoom that shows as much. They never switch the visitor to 3D. `getCamera()` in 2D gives a camera straight above the plan's middle.
- **The visitor wins:** a drag, a zoom, a tap or a key stops what the page started, and the page's next call takes the camera again. A page call also stops the camera's own motion, as a touch does; with `motionResume` set, the motion starts again after that many idle seconds.
- Under `prefers-reduced-motion` the camera is there at once.

The events, with `view.on(event, handler)` (each returns its own unsubscribe) or the components' props:

| Event         | Prop            | What it tells                                                                                    |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `levelChange` | `onLevelChange` | Another Level is shown, from any cause: the page, the Level switcher, a route.                   |
| `viewpoint`   | `onViewpoint`   | `{ id, levelId }`: a flight from `flyTo` arrived, at a Viewpoint, or at a camera with `id` null. |
| `zoneClick`   | `onZoneClick`   | `{ id, levelId, data }`: a visitor clicked a Zone, in 2D or 3D.                                  |
| `tourStep`    | `onTourStep`    | `{ id, levelId, index }`: the tour reached a Viewpoint and stays there for its pause.            |

There is no event for each frame the camera moves while a page flies it; `camera3dChange` and `camera2dChange` report every move already.

In `<AreaformEditor>`, the sidebar's **For your page** section (`'page'` in `foldedSections`, folded at first) gives the ids for these calls as ready lines, each with **Copy**:

- **Level**: `el.areaform.setLevel('…'); // its name`, for the Level shown.
- **Zone**: `el.areaform.lookAt('…'); // its name`, for the Zone selected, in 2D or 3D; with none selected it asks for one.
- **Point**: in 2D, **Pick a point to look at…** starts the Here tool for a page (`controller.startHerePick('page')`). Each click on the plan gives `el.areaform.lookAt([x, y]);`, snapped and to a tenth of a metre, anywhere on the Level, outside the building too. Esc or **Done** ends it. In 3D the row says to switch to 2D.
- **Camera**: in 3D, **Copy camera** gives the view as it is now, `{ position, target, levelId }`, for `flyTo`. In 2D the row says to open 3D.

Each Viewpoint's own line, `el.areaform.flyTo('…'); // its name`, is **Copy** in its row of the **Viewpoints** section. The lines assume the page calls the snippet's element `el`.

In React, the View comes through `ref`:

```tsx
import type { AreaformDocument } from '@areaform/core';
import type { View } from '@areaform/view';
import { AreaformView } from '@areaform/view/react';
import { useRef } from 'react';

export function Story({ doc }: { doc: AreaformDocument }) {
    const plan = useRef<View>(null);
    return (
        <>
            <button onClick={() => plan.current?.flyTo('vp_garden')}>The garden</button>
            <AreaformView ref={plan} doc={doc} defaultView="3d" gestures="cooperative" />
        </>
    );
}
```

In Vue, keep the View from `createView` in a ref, as in [Vue](#vue), and call it.

On a client's site, `embed.js` gives the snippet's element an `areaform` property once the View is made; wait for `areaform:ready` before the first call. It has `flyTo`, `lookAt`, `setProgress`, `setLevel`, `getLevel`, `getCamera` and `on(event, handler)`. Its events are in lower case, and each is also a bubbling DOM event on the element, `areaform:levelchange`, `areaform:viewpoint`, `areaform:zoneclick` and `areaform:tourstep`, with what it tells as `detail` (`levelchange` tells `{ levelId }`):

```html
<div id="plan" data-areaform="sp_demo-office" data-view="3d"></div>
<script>
    const el = document.getElementById('plan');
    el.addEventListener('areaform:ready', () => {
        el.areaform.flyTo('tour-3'); // The garden
        el.areaform.on('zoneclick', ({ id, data }) => console.log(id, data));
    });
</script>
```

The site's [Moving the camera](https://areaform.app/docs/camera/) is the full reference for the snippet. [Lettera House, the story](https://areaform.app/examples/lettera-house/story/) does this as the page scrolls, with a switch between stepping (one `flyTo` per part) and scrubbing (`setProgress`); its one file is in the public repository under `apps/examples/lettera-house/story/`.

## Interface language

The components speak English unless told otherwise. `locale` picks a built-in language: `en`, `pl`, `uk` (Ukrainian; show it as `UA` in your own switcher, `LOCALE_NAMES` has the names) or `ru`. A region tag such as `pl-PL` works too. `<AreaformEditor>`, `<AreaformView>`, `<Areaform3DView>` and `<CreateSpaceForm>` all take it:

```tsx
import { AreaformEditor } from '@areaform/editor/react';
import type { Editor } from '@areaform/core';

declare const editor: Editor;

<AreaformEditor editor={editor} locale="pl" />;
```

The language applies to the interface only: buttons, labels, messages, the shortcuts window, and how numbers and units are written (`4,50 m` in Polish, `4,50 м` in Russian). The Space's own text (Zone labels, Level names) stays as written. The suggested names of a new Space and Level are in the interface language. The editor never reads the browser's language; that is the host's choice.

`messages` lays your own text over the built-in dictionary, to change a message or to add a language without a built-in one. Missing messages fall back to English. Keys and placeholders are typed: `Messages` lists every key, and a dictionary missing one does not compile. Plurals use the i18next suffixes `_one`, `_few`, `_many` and `_other`, chosen by `Intl.PluralRules`:

```tsx
import { AreaformEditor } from '@areaform/editor/react';
import type { Messages } from '@areaform/editor';
import type { Editor } from '@areaform/core';

declare const editor: Editor;

const german: Partial<Messages> = {
    'toolbar.undo': 'Rückgängig',
    'count.wall_one': '{{count}} Wand',
    'count.wall_other': '{{count}} Wände',
};

<AreaformEditor editor={editor} locale="de" messages={german} />;
```

Keep `messages` the same object between renders (a constant or `useMemo`), since a new object makes a new dictionary. Without React, make a translator and give it to the controller and the formatting helpers:

```ts
import { createEditor, createSpace } from '@areaform/core';
import { createEditorController, createTranslator, formatArea } from '@areaform/editor';

const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [40, 25] }));
const i18n = createTranslator('uk');
const controller = createEditorController(editor, {
    levelId: editor.getDocument().levels[0]!.id,
    i18n,
});
controller.setTranslator(createTranslator('pl')); // switch later
formatArea(12.5, 'metric', i18n); // "12,50 м²"
```

## Content Languages

The interface language above is the components' own text. A Space's text, its Zone labels and the names of its Levels, Connections and the Space itself, has languages of its own: Content Languages ([ADR-0011](../adr/0011-content-languages-in-the-document.md)). A Space lists them in `languages`; `label` and `name` are written in the default, and translations sit beside them in `labels` and `names`:

```json
{
    "name": "Expo Hall A",
    "names": { "pl": "Hala A" },
    "languages": { "default": "en", "others": ["pl"] },
    "levels": [
        {
            "name": "Level 1",
            "names": { "pl": "Poziom 1" },
            "zones": [{ "label": "Booth 1", "labels": { "pl": "Stoisko 1" } }]
        }
    ]
}
```

Tags are BCP 47 (`pl`, `pt-BR`). Set one text in one language with `text.set`; in the default language it changes the `label` or `name` itself, and an empty text removes a translation:

```ts
editor.exec({ type: 'space.update', changes: { languages: { default: 'en', others: ['pl'] } } });
editor.exec({
    type: 'text.set',
    target: { kind: 'zone', levelId, zoneId: 'A-1' },
    language: 'pl',
    text: 'Stoisko 1',
});
```

`text.set` is refused for a language the Space does not offer, and for every language while `languages` is absent: a Document made before Content Languages has no known default, so set it first. Changing `languages.default` only says which language the existing texts are in; nothing moves. Removing a language from `others` keeps its texts, hidden.

To show a text in a visitor's language, `textIn(zone.label, zone.labels, doc.languages, 'pl-PL')` gives the translation in the best offered match (the same tag, then `pl` for `pl-PL`, then another region of the same language), else the default text. The 2D and 3D renderers show Zone labels this way after `renderer.setContentLanguage('pl')`; a host's `labelResolver` text still comes first, and the resolver is told the language as its second argument. `<AreaformView>` and `<Areaform3DView>` take it as `contentLanguage`; without one they use their interface `locale`, so `locale="pl"` alone shows Polish labels where the Space has them. Level, Connection and Space names are not drawn on the plan; show them in your own UI with `textIn(level.name, level.names, doc.languages, language)`.

In `<AreaformEditor>`, the sidebar's **Languages** section sets the Space's default language and the others it offers (a language removed keeps its translations, hidden, and gets them back when added again), and picks the language the author is **filling in**, each other language showing how many texts it still lacks (`missingTexts(doc, 'pl')`). While filling in another language, the plan shows names in it, those still to translate faded in the default language; the label and name fields edit the translation, empty with the default text as a placeholder. A plan with no languages, made before Content Languages, asks for its default first. `<CreateSpaceForm>` has a **Text language** field, preselecting the interface language its suggested names are in; `createSpace` takes it as `language`. A host's `labelResolver` can fade a name too, with `opacity` (0–1).

## Theming

The components are styled by `@areaform/view/styles.css` (included in `@areaform/editor/styles.css`); override its variables on `.af-editor` / `.af-view` or any ancestor:

```css
.af-editor,
.af-view {
    --af-bg: #ffffff; /* canvas surround and panels */
    --af-panel: #f6f6f3; /* toolbar and sidebar */
    --af-text: #232321;
    --af-muted: #77776f;
    --af-border: #deded8;
    --af-accent: #2f6fdb; /* pressed buttons, focus */
    --af-danger: #c0392b;
    --af-radius: 6px;
}
```

The plan's own colours (floor, Walls, Openings and emergency exits, Zone Categories, highlight) come from the renderer's `Theme`; per-Element colours from your data belong in a `styleResolver`.

The grid's look is `Theme.grid` (`stroke`, `opacity`, `strokeWidth`). It's drawn over the floor and under everything else; without React, `renderer.setGrid(on)` toggles it.

Rulers along the canvas's top and left edges number the grid's strong lines in metres (Y grows upwards, as in the plan). Without React, `renderer.setRulers({ unit, format, unitLabel })` shows them and `renderer.setRulers(null)` hides them: `unit: 0.3048` counts feet in round steps (1, 2, 5, 10, 50 ft…) instead, `format` writes the numbers (e.g. with a decimal comma), and `unitLabel` goes in the corner. `renderer.setOrigin(on)` marks 0/0 with X → and Y ↑ arrows. Their look is `Theme.ruler` (strip `fill` and `opacity`, ticks and numbers in `stroke`) and `Theme.origin` (`stroke`, `strokeWidth`); `rulerTicks` and `rulerStep` are the pure helpers behind them.

Each Stop shows an icon for its Connection's kind: stairs, elevator, escalator or ramp. The icons are SVG markup in `Theme.connectionIcons`, drawn as one-colour silhouettes in `Theme.connectionIcon.stroke`: every painted pixel takes that colour, whatever colours the SVG uses. They're at most `Theme.connectionIconSize` metres across, shrink to fit small Stops, and are left out when too small to see. To use your own icons, replace entries; the defaults are exported as `connectionIcons`, e.g. for a legend:

```ts
import { connectionIcons, defaultTheme, type Theme } from '@areaform/render-2d';

declare const myLiftSvg: string; // your own SVG markup

const theme: Theme = {
    ...defaultTheme,
    connectionIcons: { ...connectionIcons, elevator: myLiftSvg },
};
```

Zones show an icon for their Zone Category above their name, in the name's colour (its `labelColor`, else `Theme.label`). The defaults, in `Theme.categoryIcons` (exported as `categoryIcons`), cover places visitors look for: `wc`, `cafe`, `kitchen`, `stage`, `info`, `registration`, `first-aid`, `lounge`, `meeting-room`, `checkout`, `fitting-room` and `loading-dock`. Units named anyway (booths, rooms) and ways through (aisles) have none. They are adapted from [Lucide](https://lucide.dev) (ISC). An icon is twice the name's height, at most `Theme.zoneIconSize` metres (1.2), and shrinks with the name to fit inside the Zone. When both cannot fit, the name is left out and the icon shown alone, as it is on a Zone with no name.

Any SVG works as a category icon: like Connection icons it is drawn as a one-colour silhouette, so give the shape alone (a letter, not a letter on a filled square). It is drawn as an image, so nothing in the markup runs. Add your own categories' icons, replace ours, or remove one with `''`:

```tsx
import { categoryIcons, defaultTheme, type Theme } from '@areaform/render-2d';
import { AreaformView } from '@areaform/view/react';
import type { AreaformDocument } from '@areaform/core';

declare const doc: AreaformDocument;
declare const chargerSvg: string; // your own SVG markup

const theme: Theme = {
    ...defaultTheme,
    categories: { ...defaultTheme.categories, charging: { fill: '#e2f1ec' } },
    categoryIcons: { ...categoryIcons, charging: chargerSvg, lounge: '' },
};

export const Plan = () => <AreaformView doc={doc} theme={theme} />;
```

Icons are not stored in the Document: a Zone gets one through its category, so a WC is a Zone with the `wc` category.

### Runtime names and logos

Who uses a Zone often changes without the plan changing: this season's exhibitor on a booth, the tenant of an office. Give `<AreaformView>` (or `<Areaform3DView>`, or a renderer's `setLabelResolver`) a `labelResolver` that returns, per Zone, a `text` to show instead of its name (`''` shows none) and a `logo`, as SVG markup, to show above the name in its own colours instead of a category icon. Return `undefined` to keep the Document's own. Nothing is saved. With a Content Language set, the resolver gets it as a second argument, `(zone, language)`, so it can return its own text in that language; `undefined` then falls back to the Zone's translation, then its label. `<AreaformEditor>` takes a `labelResolver` too but shows only its logos, so the author sees the plan as visitors will while still editing the Document's own names.

A logo is as tall as an icon (twice the name's height, at most `Theme.zoneIconSize`), keeps its proportions up to `Theme.zoneLogoSize` metres wide (2.4), and shrinks with the name; when both cannot fit, the name goes first. Logos are SVG only, so there is nothing to download and no cross-origin rule to meet: send the vector version, since an embedded photo or JPEG would bring its background box with it. Like icons, a logo is drawn as an image, so nothing in its markup runs.

```tsx
import { useCallback } from 'react';
import { AreaformView } from '@areaform/view/react';
import type { LabelResolver } from '@areaform/render-2d';
import type { AreaformDocument } from '@areaform/core';

declare const doc: AreaformDocument;
declare const tenants: Map<string, { name: string; logoSvg?: string }>; // by Zone id

export function Plan() {
    // Keep it stable: a new resolver redraws the plan and rebuilds the 3D Level.
    const labelResolver = useCallback<LabelResolver>((zone) => {
        const tenant = tenants.get(zone.id);
        return tenant && { text: tenant.name, ...(tenant.logoSvg && { logo: tenant.logoSvg }) };
    }, []);
    return <AreaformView doc={doc} labelResolver={labelResolver} />;
}
```

## Plugins

The View's base shows, pans, zooms, clicks, hovers and highlights. Anything more is a Plugin ([ADR-0012](../adr/0012-the-view-package-and-plugins.md)): a function given the View, an overlay element over the plan and the interface translator, which subscribes to what it needs and returns a cleanup. Pass Plugins when the View mounts, each as is or as a loader that imports it on first use, so its code is only downloaded when a View starts it:

```tsx
import { AreaformView } from '@areaform/view/react';
import type { PluginSource } from '@areaform/view';

const plugins: PluginSource[] = [
    { load: () => import('@areaform/view/plugins/tooltip').then((m) => m.tooltip()) },
    { load: () => import('@areaform/view/plugins/wayfinding').then((m) => m.wayfinding()) },
];

<AreaformView doc={doc} plugins={plugins} />;
```

The **tooltip** shows the hovered Element's name, in the visitor's Content Language, and its category (or a Connection's, Obstacle's or Opening's kind) beside the pointer, following it across the Element. `tooltip({ content: ({ ref, view }) => … })` gives your own text or element instead; return `null` for no card, or `undefined` for the built-in one, whose text `tooltipText(doc, ref, i18n, language)` also gives.

**Wayfinding** shows visitors the walking route to a place ([ADR-0017](../adr/0017-wayfinding-inside-one-space.md)). A tap on a Zone opens a card with its name and **Directions**; a tap on open floor offers **Directions to here**. Without a start yet, the panel asks "Where are you?": the next tap on the plan, or a Zone picked from the list, is **Here**, shown as "You are here" and kept for the visit. The route is a dashed line in the accent colour, its dashes moving toward the destination (still under `prefers-reduced-motion`), ending at a pin; the panel gives the distance and the walking time at 1.2 m/s, with **Change start** and **Clear route**. It keeps 0.3 m clear of Walls, goes through Openings, and walks around Obstacles, Connection Stops and Walk-around Zones (`walkAround`), ending at a booth's edge; a place it cannot reach gives "No route found". Options:

- `here`: where the visitor starts, e.g. from `?here=` on a printed QR code: a Zone's id (that Zone, on its Level; stays valid when the plan is redrawn), or `<levelId>:<x>,<y>` in metres. `parseHere(text, doc)` reads the same forms. In the Editor, **Here for visitors → Pick a point…** (shown when nothing is selected) gives the value for a point clicked on the plan, and a Zone's properties give its own (its id), each with **Copy**; `hereValue(levelId, point)` makes the same text.
- `to`: a place to show at the start, e.g. from `?to=` on a link to one shop: a Zone's id. The View opens on its Level with its card; with `here` as well, the route is drawn at once and shown from its start. An id naming no Zone is ignored; `parseTo(text, doc)` reads it.
- `clearance`: how far routes keep from what is in the way, metres (default 0.3).
- `stepFree`: start with step-free routes on, e.g. on an accessible kiosk (default off).

On Areaform's hosting, `embed.js` starts the Plugin for every published Space unless its owner switches **Directions** off in the Publish dialog. Here comes from `data-here` on the snippet's element, else from `?here=` in the page's address:

```html
<div data-areaform="sp_…" data-here="entrance-a"></div>
```

`to` comes the same way, from `data-to` or `?to=`; with Directions off, `embed.js` only highlights that Zone on its Level.

With **Page with the plan** filled in, the Editor's Here values come with a link to that page.

The Plugin is about 2.5 KB gzipped; the route search (`@areaform/wayfinding`, about 34 KB gzipped) is imported when the first route is asked for, and the navmesh is built once per Level (about 0.2 s for a 5,000-booth hall). A route to another Level goes through the Space's Connections, the quickest way (a lift waits about 30 s; a one-way escalator only goes from its first Stop toward its last). The View shows it from its start: on each Level its part of the line, a button where it changes Level (**↓ Level 1**) and one where it arrives (**From Gallery**), and the panel lists the steps ("Take Main stairs down to Level 1"), each showing the Level where it starts. The time includes the rides. A Space with Connections gets a **Step-free** switch in the panel: routes then take only Connections marked Accessible (in the Editor, lifts and ramps start marked; stairs and escalators do not), or say "No step-free route found". The `stepFree` option starts with it on. In 3D the same line lies just above the floor and follows the camera as it orbits, breaking off where it would pass behind the camera; it is drawn over the 3D scene, so a Wall between it and the camera does not hide it (near Walls are cut down anyway).

A Plugin of your own is just the function:

```ts
import type { ViewPlugin } from '@areaform/view';

export const logClicks: ViewPlugin = ({ view }) =>
    view.on('elementClick', (e) => console.log(e.ref.kind, e.ref.id)); // its unsubscribe is the cleanup
```

Anything it adds goes in `overlay`, which lets the pointer through; give what should take clicks `pointer-events: auto`. `view.toScreen(point, height)` places it over the plan in 2D or 3D. `view.use(plugin)` starts one later.

## Without React

The View is plain TypeScript; `<AreaformView>` wraps it. `createView(container, options)` takes the View's props as options and returns a `View` with a setter for each, events and `destroy()`:

```ts
import { fromJSON } from '@areaform/core';
import { createView } from '@areaform/view';
import '@areaform/view/styles.css';

declare const container: HTMLElement;
declare const json: string;

const loaded = fromJSON(json);
if (loaded.ok) {
    const view = createView(container, { doc: loaded.doc, controls: true, locale: 'pl' });
    view.on('elementClick', (e) => console.log('clicked', e.ref.id));
    view.highlight([{ kind: 'zone', id: 'A-1', levelId: loaded.doc.levels[0]!.id }]);
}
```

The 2D renderer is created at once, the 3D one each time 3D is shown (`view.setView('3d')` or the **3D** button), and `toScreen`, `fit` and the event handlers follow whichever is shown.

The editor's logic is framework-free: `createEditorController` holds the tools, selection and overlay, and `createRenderer` draws on a canvas. Wire their events together:

```ts
import { createEditor, createSpace } from '@areaform/core';
import { createEditorController } from '@areaform/editor';
import { createRenderer } from '@areaform/render-2d';

declare const container: HTMLElement;

const editor = createEditor(createSpace({ name: 'Hall A', kind: 'office', size: [20, 12] }));
const levelId = editor.getDocument().levels[0]!.id;
const controller = createEditorController(editor, { levelId });
const renderer = await createRenderer({ container, interaction: 'edit' });

renderer.update(editor.getDocument());
renderer.setLevel(levelId);
renderer.fitLevel();

// Pointer events arrive in plan coordinates (metres).
renderer.on('pointerDown', (e) => controller.pointerDown(e));
renderer.on('pointerMove', (e) => controller.pointerMove(e));
renderer.on('pointerUp', (e) => controller.pointerUp(e));
renderer.on('cameraChange', (camera) => controller.setZoom(camera.zoom));
container.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (controller.keyDown({ key: e.key, shift: e.shiftKey, meta, code: e.code }))
        e.preventDefault();
});

// Redraw on edits; draw the tool's previews and the selection.
editor.on('change', (doc) => renderer.update(doc));
controller.subscribe((state) => {
    renderer.setOverlay(state.overlay);
    renderer.highlight(state.selection);
});

controller.setTool('wall');
```

A 3D view without React is `createRenderer3D` from `@areaform/render-3d`:

```ts
import { createEditor, createSpace } from '@areaform/core';
import { createRenderer3D, isWebGLAvailable } from '@areaform/render-3d';

declare const container: HTMLElement;

const editor = createEditor(createSpace({ name: 'Hall A', kind: 'office', size: [20, 12] }));
if (isWebGLAvailable()) {
    const view = await createRenderer3D({ container, doorHeight: 2.2 });
    view.update(editor.getDocument()); // shows the first Level, from a ¾ angle
    editor.on('change', (doc) => view.update(doc));
    view.setView('top');
}
```

If the 3D view covers a 2D renderer, as the View and `<AreaformEditor>` do, call `renderer.setPaused(true)` while it is shown and `renderer.setPaused(false)` when it goes. Otherwise the plan underneath keeps drawing every frame. Updates made meanwhile show when it draws again.

The controller also offers `select`, `setLevel`, `setUnits`, `setDimensions`, `copy` / `cut` / `paste` / `duplicate`, `clipboardText` / `pasteText` (for your own clipboard handling), `duplicateLevel`, `requestLevelDelete`, `confirmDelete` / `cancelDelete`, `startCalibration` / `finishCalibration`, and `on('toolChange' | 'levelChange' | 'selectionChange', …)`. Its state (`getState()`) carries what a UI needs: the tool, selection, overlay, a pending delete to confirm, an in-progress calibration, and a short message to show.

## Vue

The View in a Vue 3 component: create it when the component mounts, pass prop changes to its setters, destroy it when the component goes. The same few lines wrap it in Svelte, Angular or anything else.

```vue
<!-- AreaformView.vue -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AreaformDocument, ElementRef } from '@areaform/core';
import type { ElementEvent, StyleResolver } from '@areaform/render-2d';
import { createView, type View } from '@areaform/view';
import '@areaform/view/styles.css';

const props = defineProps<{
    doc: AreaformDocument;
    styleResolver?: StyleResolver;
    highlight?: ElementRef[];
}>();
const emit = defineEmits<{ elementClick: [event: ElementEvent] }>();

const container = ref<HTMLDivElement>();
let view: View | undefined;

onMounted(() => {
    view = createView(container.value!, {
        doc: props.doc,
        controls: true,
        ...(props.styleResolver && { styleResolver: props.styleResolver }),
        ...(props.highlight && { highlight: props.highlight }),
    });
    view.on('elementClick', (e) => emit('elementClick', e));
});
onBeforeUnmount(() => view?.destroy());

// Props change the View through its setters; it redraws only what changed.
watch(
    () => props.doc,
    (doc) => view?.update(doc),
);
watch(
    () => props.styleResolver,
    (resolver) => view?.setStyleResolver(resolver),
);
watch(
    () => props.highlight,
    (refs) => view?.highlight(refs ?? []),
);
</script>

<template>
    <div ref="container" style="height: 100%" />
</template>
```

```vue
<!-- in a page -->
<AreaformView :doc="doc" :style-resolver="colours" :highlight="picked" @element-click="onClick" />
```

Keep the Document in a `shallowRef`: it is immutable, and every change is a new object, so Vue need not watch inside it. Add a prop and a `watch` for each setter you need (`setLevel`, `setView`, `setLocale`, …).

**The Editor in Vue.** Its interface is React, so it runs inside a Vue component as a React island (add `react` and `react-dom`):

```vue
<!-- AreaformEditorIsland.vue -->
<script setup lang="ts">
// The Editor's interface is React: it runs inside this component as a React island.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@areaform/core';
import { AreaformEditor } from '@areaform/editor/react';
import '@areaform/editor/styles.css';

const props = defineProps<{ editor: Editor }>();
const container = ref<HTMLDivElement>();
let root: Root | undefined;

onMounted(() => {
    root = createRoot(container.value!);
    root.render(createElement(AreaformEditor, { editor: props.editor }));
});
onBeforeUnmount(() => root?.unmount());
</script>

<template>
    <div ref="container" style="height: 100%" />
</template>
```

Give it an Editor from `createEditor(doc)` and listen to `editor.on('change', …)` to save. To draw your own interface in Vue instead, use the framework-free controller in [Without React](#without-react).

## Reading a Document in your own code

`core` has helpers for consumers that render or analyse Documents themselves, such as a 3D viewer:

- `zoneAt(level, point)`: the topmost Zone at a point (holes excluded);
- `containsPoint(shape, point)`, `containsRing(shape, ring)` and `holesOverlap(shape)`;
- `resolveOpening(level, opening)`: where a door hosted on a Wall actually is, and its angle;
- `wallOutlines(level)`: each Wall's footprint with mitred corners, as both renderers draw it;
- `underlayToWorld` / `worldToUnderlay` / `underlayCorners`: Underlay image pixels ↔ plan metres;
- `diagnose(doc, { presets })`, `presetFor(kind, presets)` and `exclusiveCategories(preset)`.
