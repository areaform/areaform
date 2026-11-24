import type { Command, Vec2 } from '@areaform/core';
import { existsSync, readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { commandReference } from './commandReference.ts';
import { createDraftSession, DraftError, type DraftSession } from './session.ts';
import { fetchFigmaNode, parseFigmaUrl, type Fetch } from './figma/figma.ts';
import { buildCommands, scanFrame } from './figma/figmaExtract.ts';
import type { Calibration } from './source.ts';
import { readImportMeta } from './importMeta.ts';

/** This package's version, read from its package.json beside `src/` and `dist/` alike. */
const VERSION = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
    }
).version;
import { renderPreview } from './preview.ts';
import { saveDraft, saveGeoJSON } from './save.ts';
import { loadSourceImage, type ImageDownload } from './sourceImage.ts';
import { matchZones, type MatchField, type SetField } from './matchZones.ts';
import { openDraft } from './open.ts';
import { frameViewpoint } from './frameViewpoint.ts';

const json = (value: unknown, isError = false): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError && { isError }),
});

const point = z.tuple([z.number(), z.number()]);

/** How to work with the server, sent to the agent when it connects (docs/guides/mcp.md has the long form). */
export const INSTRUCTIONS = `Builds a Draft of a Space from a design Source (a Figma frame or an image) for a person to review, and updates plans saved earlier from the person's own data.

Work in this order:
1. create_draft with the Space Kind (exhibition, office, store, warehouse, cafe, mall, flat); ask if the Source doesn't make it clear.
2. calibrate from a dimension shown on the Source. Never guess the scale: if the Source shows no known length, ask the person for one.
3. attach_source with an image of the whole Source: a file path, or a URL such as the one the Figma MCP's get_screenshot returns.
4. For a Figma frame, figma_extract first: it proposes Commands for layers named by the convention and lists the layers it skipped.
5. apply_commands in batches; convert every Source point with source_to_plan. Fix what is rejected and look at the Diagnostics.
6. render_preview and compare with the Source underneath; fix and repeat until they match.
7. flag every Element you are unsure of, with the reason: a guessed category, an exit read from a coloured mark, an Outline traced from a shadow.
8. save_document to the folder the person names, then report the folder, the scale used and the flags.

To update a plan saved earlier from the person's own data (an exhibitor list, a booking export):
1. open_document with the plan's folder or plan.json.
2. match_zones with the records, the record field that names each Zone and the Zone field to compare it with (label for booth numbers, data.<key> for an id stored earlier). Name in set what to copy onto the Zones; store the person's own id under a data key such as data.externalId, so the next update can match by it.
3. Report what didn't match one to one (unmatched records, records naming several Zones, Zones named by several records, Zones no record names) and ask the person before guessing.
4. apply_commands with the proposed Commands, then save_document back to the same folder with overwrite.

To make a camera tour for the 3D view (the Viewpoints of a Level, flown through in order):
1. For each view the person asks for ("the entrance from outside, then the café, then the whole hall from above"), frame_viewpoint with the Zones or the point to show, the compass bearing the camera looks towards and the tilt from straight down; it returns the Viewpoint and its viewpoint.add Command.
2. apply_commands with those Commands, in tour order. Name each one as the person would.
3. render_preview: each camera shows as a numbered mark with a wedge towards a crossed target. Check the order and the directions, then save_document.

The Draft lives only in this server process: save it before ending.`;

// A tool used out of order is the agent's mistake, so it is reported as a tool error, not a crash.
const guarded =
    <A extends unknown[]>(handler: (...args: A) => CallToolResult) =>
    (...args: A): CallToolResult => {
        try {
            return handler(...args);
        } catch (error) {
            if (error instanceof DraftError) return json({ error: error.message }, true);
            throw error;
        }
    };

const guardedAsync =
    <A extends unknown[]>(handler: (...args: A) => Promise<CallToolResult>) =>
    async (...args: A): Promise<CallToolResult> => {
        try {
            return await handler(...args);
        } catch (error) {
            if (error instanceof DraftError) return json({ error: error.message }, true);
            throw error;
        }
    };

export interface ServerOptions {
    /** For `figma_extract`; `FIGMA_TOKEN` from the environment when absent. */
    figmaToken?: string;
    fetch?: Fetch;
    /** How `attach_source` downloads an image from a URL; the network when absent. */
    download?: ImageDownload;
}

/** An MCP server that lets an agent build one Draft through the core's Commands (ADR-0008). */
export function createServer(
    session: DraftSession = createDraftSession(),
    options: ServerOptions = {},
): McpServer {
    const server = new McpServer(
        { name: 'areaform', version: VERSION },
        { instructions: INSTRUCTIONS },
    );

    server.registerTool(
        'create_draft',
        {
            description:
                'Start a new Draft with one Level, dropping the current one. Returns the Document, ' +
                'and the Preset for its Space Kind with the Zone Categories to use.',
            inputSchema: {
                name: z.string().describe('Name of the Space'),
                kind: z
                    .string()
                    .describe(
                        'Space Kind: exhibition, office, store, warehouse, cafe, mall, flat or client-defined',
                    ),
                size: z
                    .tuple([z.number().positive(), z.number().positive()])
                    .optional()
                    .describe(
                        'Width and depth of the placeholder Outline in metres (default 10×10)',
                    ),
            },
        },
        guarded(({ name, kind, size }) => {
            const doc = session.create({ name, kind, ...(size && { size }) });
            return json({ document: doc, preset: session.preset() });
        }),
    );

    server.registerTool(
        'open_document',
        {
            description:
                'Open a plan saved earlier, dropping the current Draft: a Draft folder or its ' +
                'plan.json. The plan is checked as on any load; Elements that break an Invariant ' +
                'are dropped and listed in repairs. Its Source image is found next to it. Returns ' +
                'the Document; change it with apply_commands and write it back with save_document.',
            inputSchema: {
                path: z.string().describe('Folder holding plan.json, or the plan file itself'),
            },
        },
        guarded(({ path }) => {
            const opened = openDraft(session, path);
            return json({ ...opened, document: session.document(), flags: session.flags() });
        }),
    );

    server.registerTool(
        'apply_commands',
        {
            description:
                'Apply Commands to the Draft in order, as one undo step. If any is rejected, none ' +
                'is applied, and the result names the first failing Command and the Invariants it ' +
                'broke. On success, returns the Diagnostics (non-blocking problems) of the Draft. ' +
                'Coordinates are metres, Y up (convert Source points with source_to_plan); ids are ' +
                'yours to choose, and levelId is the one create_draft returned. The Commands, by ' +
                'example:\n' +
                commandReference(),
            inputSchema: {
                commands: z
                    .array(z.looseObject({ type: z.string() }))
                    .min(1)
                    .describe('Core Commands, each with its `type`'),
            },
        },
        // The core checks each Command's shape and rules; the schema here only frames the batch.
        guarded(({ commands }) => {
            const result = session.apply(commands as unknown as Command[]);
            return json(result, !result.ok);
        }),
    );

    server.registerTool(
        'get_document',
        { description: 'Return the Draft as a Document.' },
        guarded(() => json(session.document())),
    );

    server.registerTool(
        'get_diagnostics',
        {
            description:
                'Return the Diagnostics of the Draft: Zones outside the Outline, overlapping ' +
                'Zones or Walls, Openings off their Wall, and so on.',
        },
        guarded(() => json(session.diagnostics())),
    );

    server.registerTool(
        'match_zones',
        {
            description:
                "Match the person's own records (rows of a booking list, an exhibitor export) to " +
                'Zones by a key, and propose zone.update Commands copying record fields onto ' +
                'each matched Zone. Nothing is applied. Unless exact, case, spaces and - _ . / are ' +
                'ignored, so "A-12" matches "a12". Only one-to-one matches get Commands; the ' +
                'result lists records naming no Zone, records naming several Zones, Zones named ' +
                'by several records, and Zones no record names, for you to resolve with the person.',
            inputSchema: {
                rows: z
                    .array(z.record(z.string(), z.unknown()))
                    .min(1)
                    .describe('The records, each an object of fields'),
                key: z.string().describe('The record field naming the Zone, e.g. "booth"'),
                by: z
                    .string()
                    .regex(/^(id|label|data\..+)$/)
                    .describe('The Zone field to compare it with: id, label or data.<key>'),
                category: z.string().optional().describe('Only Zones of this Zone Category'),
                levelId: z.string().optional().describe('Only Zones on this Level'),
                exact: z.boolean().default(false).describe('Compare the keys exactly'),
                set: z
                    .record(z.string().regex(/^(label|category|data\..+)$/), z.string())
                    .optional()
                    .describe(
                        'Zone field (label, category or data.<key>) → the record field to set ' +
                            'it from, e.g. {"data.externalId": "id", "data.exhibitor": "company"}',
                    ),
            },
        },
        guarded(({ rows, key, by, category, levelId, exact, set }) =>
            json(
                matchZones(session.document(), rows, {
                    key,
                    by: by as MatchField,
                    exact,
                    ...(category !== undefined && { category }),
                    ...(levelId !== undefined && { levelId }),
                    ...(set && { set: set as Partial<Record<SetField, string>> }),
                }),
            ),
        ),
    );

    server.registerTool(
        'calibrate',
        {
            description:
                'Set the scale of the Source: two points in Source units (Figma points or image ' +
                'pixels, X right, Y down from the top-left corner) that are `distance` metres apart ' +
                'in reality, and the size of the whole Source in the same units. The Source then ' +
                'maps onto the plan with its bottom-left corner at the origin and Y up. Use a ' +
                'dimension shown on the Source; if there is none, ask the person for one. Geometry ' +
                'already drawn is not rescaled.',
            inputSchema: {
                p1: point.describe('First point, in Source units'),
                p2: point.describe('Second point, in Source units'),
                distance: z.number().positive().describe('Real distance between them, in metres'),
                size: z
                    .tuple([z.number().positive(), z.number().positive()])
                    .describe('Width and height of the Source frame or image, in Source units'),
            },
        },
        guarded(({ p1, p2, distance, size }) => {
            const { scale } = session.calibrate(p1, p2, distance, size);
            return json({ scale, planSize: [size[0] * scale, size[1] * scale] });
        }),
    );

    server.registerTool(
        'source_to_plan',
        {
            description:
                'Convert points from Source units to plan metres with the current calibration. ' +
                'Use it for every coordinate taken from the Source rather than converting by hand.',
            inputSchema: { points: z.array(point).min(1).describe('Points in Source units') },
        },
        guarded(({ points }) => json(session.toPlan(points))),
    );

    server.registerTool(
        'attach_source',
        {
            description:
                'Show an image of the Source (PNG or JPEG) as a locked, half-transparent Underlay ' +
                'under the Draft, placed by the calibration, so the reviewer sees the Draft over ' +
                'the original. Pass either a local file path or an https URL to download, such ' +
                "as the link the Figma MCP's get_screenshot returns (use it straight away: those " +
                'links expire). For a Figma frame, take the whole frame at any resolution and ' +
                'pass the frame link as figmaUrl. Replaces an earlier Source image.',
            inputSchema: {
                path: z.string().optional().describe('Path of the image file'),
                url: z.string().optional().describe('https URL of the image, to download'),
                figmaUrl: z.string().optional().describe('The Figma frame the image shows'),
            },
        },
        guardedAsync(async ({ path, url, figmaUrl }) => {
            const { file, type, size } = await loadSourceImage({ path, url }, options.download);
            const underlay = session.attachSource({
                path: file,
                type,
                size,
                ...(figmaUrl && { figmaUrl }),
            });
            return json({ underlay });
        }),
    );

    server.registerTool(
        'flag',
        {
            description:
                'Mark something on the Draft for the reviewer to check, with the reason: a guessed ' +
                'category or label, an unclear door, a Wall read from a faint line. Pass the id of ' +
                'an Element (Wall, Wall Node, Opening, Zone, Obstacle) or of the Level, for its ' +
                'Outline. Flag whatever you are not sure of; the reviewer works through the list. ' +
                'Flags on Elements later deleted are dropped.',
            inputSchema: {
                elementId: z
                    .string()
                    .describe('Id of the Element, or of the Level for its Outline'),
                reason: z.string().min(1).describe('What to check and why, in one sentence'),
                sourceRef: z
                    .string()
                    .optional()
                    .describe('Where it is in the Source, e.g. the Figma node id'),
            },
        },
        guarded(({ elementId, reason, sourceRef }) =>
            json({ flags: session.flag(elementId, reason, sourceRef) }),
        ),
    );

    server.registerTool(
        'render_preview',
        {
            description:
                'Draw one Level of the Draft as a PNG to compare with the Source: Outline, Walls, ' +
                'Openings (dashed; emergency exits green), Zones with label and id, Obstacles with ' +
                'id, the Stops of stairs, lifts and ramps with their name, and a grid. By default ' +
                'the Source image is drawn underneath, half transparent, on the Level it was ' +
                'attached to, so misplaced or missing Elements show as offsets. Plan Y points up, ' +
                'as on the Source.',
            inputSchema: {
                levelId: z
                    .string()
                    .optional()
                    .describe('The Level to draw (default: the first, where the Source is)'),
                width: z
                    .number()
                    .int()
                    .min(200)
                    .max(4000)
                    .default(1200)
                    .describe('Width of the picture in pixels'),
                overlaySource: z
                    .boolean()
                    .default(true)
                    .describe('Draw the attached Source image under the plan'),
                ids: z.boolean().default(true).describe('Write Zone and Obstacle ids'),
            },
        },
        guarded(({ levelId, width, overlaySource, ids }) => {
            const doc = session.document();
            const level =
                levelId === undefined ? doc.levels[0]! : doc.levels.find((l) => l.id === levelId);
            if (!level) {
                const known = doc.levels.map((l) => `${l.id} (${l.name})`).join(', ');
                throw new DraftError(`No Level "${levelId}" in the Draft; its Levels are ${known}`);
            }
            const stops = doc.connections.flatMap((connection) =>
                connection.stops
                    .filter((stop) => stop.levelId === level.id)
                    .map((stop) => ({
                        name: connection.name ?? connection.kind,
                        shape: stop.shape,
                    })),
            );
            // Only the Level the Source was attached to holds its Underlay.
            const underlayId = readImportMeta(doc)?.underlayId;
            const underlay = level.underlays.find((u) => u.id === underlayId);
            const file = session.sourceFile();
            if (overlaySource && underlay && file && !existsSync(file)) {
                throw new DraftError(`The Source image ${file} is gone; attach it again`);
            }
            const source =
                overlaySource && underlay && file
                    ? {
                          underlay,
                          href: `data:image/${underlay.src.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(file).toString('base64')}`,
                      }
                    : undefined;
            // The Source Underlay is drawn as the overlay or not at all, never as a plain Underlay.
            const plan = { ...level, underlays: [] };
            const preview = renderPreview(plan, { width, ids, stops, ...(source && { source }) });
            const png = new Resvg(preview.svg, { font: { loadSystemFonts: true } })
                .render()
                .asPng();
            return {
                content: [
                    { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
                    {
                        type: 'text',
                        text: JSON.stringify({
                            level: { id: level.id, name: level.name },
                            pixelsPerMetre: preview.pixelsPerMetre,
                            topLeft: preview.origin,
                            gridStep: preview.gridStep,
                            sourceDrawn: source !== undefined,
                        }),
                    },
                ],
            };
        }),
    );

    server.registerTool(
        'frame_viewpoint',
        {
            description:
                'Frame a camera for the 3D view: a Viewpoint looking at Zones (or at a point and ' +
                'the radius around it) from a compass bearing and a tilt, as far away as it takes ' +
                'for them to fill the view, as the 3D view frames a Level. Returns the Viewpoint ' +
                'and the viewpoint.add Command that puts it last in the tour; nothing changes ' +
                'until you apply it.',
            inputSchema: {
                levelId: z.string(),
                zoneIds: z.array(z.string()).optional().describe('The Zones to show'),
                point: point.optional().describe('Or a plan point to look at, metres'),
                radius: z
                    .number()
                    .optional()
                    .describe('Metres around the point to keep in view (default 5)'),
                bearing: z
                    .number()
                    .describe('Degrees, where the camera looks towards: 0 north, 90 east'),
                tilt: z
                    .number()
                    .describe(
                        'Degrees from looking straight down (0) to almost level (at most 87)',
                    ),
                aspect: z
                    .number()
                    .optional()
                    .describe('Width for height of the view it will show in (default 1.5)'),
                name: z.string().optional().describe('Shown in the Editor, e.g. "Entrance"'),
            },
        },
        guarded((request) =>
            json(
                frameViewpoint(session.document(), {
                    levelId: request.levelId,
                    bearing: request.bearing,
                    tilt: request.tilt,
                    ...(request.zoneIds && { zoneIds: request.zoneIds }),
                    ...(request.point && { point: request.point }),
                    ...(request.radius !== undefined && { radius: request.radius }),
                    ...(request.aspect !== undefined && { aspect: request.aspect }),
                    ...(request.name && { name: request.name }),
                }),
            ),
        ),
    );

    server.registerTool(
        'save_document',
        {
            description:
                'Write the Draft folder for the reviewer: plan.json and the Source image under ' +
                'the name its Underlay refers to. Creates the folder if needed, anywhere this ' +
                'process may write, so use the folder the person named. Never replaces a plan ' +
                'unless overwrite is set. Report the folder path, the scale used and the Import ' +
                'Flags to the person when done.',
            inputSchema: {
                dir: z.string().describe('Folder to write the Draft into'),
                overwrite: z
                    .boolean()
                    .default(false)
                    .describe('Replace a plan.json already in the folder'),
            },
        },
        guarded(({ dir, overwrite }) => {
            const saved = saveDraft(session, dir, { overwrite });
            return json({ ...saved, scale: session.calibration()?.scale, flags: session.flags() });
        }),
    );

    server.registerTool(
        'save_geojson',
        {
            description:
                'Write plan.geojson into a folder, for map and GIS tools such as QGIS or Mapbox: ' +
                "each Level's outline, Walls, Openings, Zones, Obstacles and Connection Stops as " +
                'GeoJSON Features. Coordinates are longitude and latitude when the Document has a ' +
                'georeference (geo), and metres on the plan otherwise (coordinateSystem "local"); ' +
                'tell the person which, since a map shows a local file near 0°, 0°.',
            inputSchema: {
                dir: z.string().describe('Folder to write plan.geojson into'),
                overwrite: z
                    .boolean()
                    .default(false)
                    .describe('Replace a plan.geojson already in the folder'),
            },
        },
        guarded(({ dir, overwrite }) => json(saveGeoJSON(session, dir, { overwrite }))),
    );

    server.registerTool(
        'figma_extract',
        {
            description:
                'Read a Figma frame through the REST API (needs FIGMA_TOKEN) and turn the layers ' +
                'named by the convention into Commands in metres: "Outline" or "Floor", "Wall", ' +
                '"Door", "Entrance", "Passage", "Emergency exit", "Column", "Shaft", "Void", ' +
                '"Zone <label>", "Restricted <label>", a Zone Category such as "Booth A1", and ' +
                '"Dimension 60 m" for the scale. Nothing is applied: check the Commands, apply them ' +
                'with apply_commands, then draw the skipped layers yourself from the screenshot. ' +
                'Calibrates from a Dimension layer when the Draft is not calibrated yet.',
            inputSchema: {
                url: z.string().describe('Link to the Figma frame, with its node-id'),
            },
        },
        guardedAsync(async ({ url }) => {
            const ref = parseFigmaUrl(url);
            if (!ref) throw new DraftError(`Not a link to a Figma frame with a node-id: ${url}`);
            const token = options.figmaToken ?? process.env['FIGMA_TOKEN'];
            if (!token) {
                throw new DraftError(
                    'FIGMA_TOKEN is not set for the Areaform server. Ask the person to add a ' +
                        'Figma personal access token to its environment, or read the frame with ' +
                        'the Figma MCP and send Commands yourself.',
                );
            }
            let frame;
            try {
                frame = await fetchFigmaNode(ref, token, options.fetch);
            } catch (error) {
                throw new DraftError(`Could not read the frame: ${(error as Error).message}`);
            }
            const scan = scanFrame(frame, session.preset());
            let calibratedFrom: string | undefined;
            if (!session.calibration()) {
                if (!scan.dimension) {
                    throw new DraftError(
                        'The Draft is not calibrated and the frame has no "Dimension <n> m" ' +
                            'layer: call calibrate first.',
                    );
                }
                const { p1, p2, metres } = scan.dimension;
                session.calibrate(p1, p2, metres, scan.size);
                calibratedFrom = `the Dimension layer (${metres} m)`;
            }
            const calibration = inFrameUnits(session.calibration()!, scan.size);
            const levelId = session.document().levels[0]!.id;
            const extraction = buildCommands(scan, calibration, levelId);
            session.expectSourceRefs(extraction.sourceRefs);
            const { commands, counts, skipped, notes, unusedTexts } = extraction;
            return json({
                scale: calibration.scale,
                ...(calibratedFrom && { calibratedFrom }),
                counts,
                commands,
                skipped,
                notes,
                unusedTexts,
            });
        }),
    );

    return server;
}

/**
 * The Draft's calibration restated in the frame's own units. A Draft calibrated on a screenshot
 * (often @2x) has pixels as its Source units, while figma_extract reads points.
 */
function inFrameUnits(calibration: Calibration, frameSize: Vec2): Calibration {
    const [width, height] = calibration.size;
    if (width === frameSize[0] && height === frameSize[1]) return calibration;
    const aspect = frameSize[0] / frameSize[1] / (width / height);
    if (!(frameSize[0] > 0 && frameSize[1] > 0) || Math.abs(aspect - 1) > 0.01) {
        throw new DraftError(
            `The Draft is calibrated on a Source of ${width}×${height}, which does not match ` +
                `the frame of ${frameSize[0]}×${frameSize[1]} in aspect ratio: is it the same ` +
                'frame? Calibrate again on this frame.',
        );
    }
    return { scale: (calibration.scale * width) / frameSize[0], size: frameSize };
}
