import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Resvg } from '@resvg/resvg-js';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Fetch } from './figma.ts';
import { createServer, INSTRUCTIONS, type ServerOptions } from './server.ts';
import { png } from './testImages.ts';

async function connect(options: ServerOptions = {}) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(undefined, options).connect(serverSide);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientSide);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
        const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
        return {
            isError: result.isError ?? false,
            body: JSON.parse(text) as Record<string, unknown>,
        };
    };
    return { client, call };
}

describe('createServer', () => {
    it('lists the Draft tools', async () => {
        const { client } = await connect();
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual([
            'create_draft',
            'open_document',
            'apply_commands',
            'get_document',
            'get_diagnostics',
            'match_zones',
            'calibrate',
            'source_to_plan',
            'attach_source',
            'flag',
            'render_preview',
            'frame_viewpoint',
            'save_document',
            'save_geojson',
            'figma_extract',
        ]);
    });

    it('tells the agent how to work, and shows the Commands by example', async () => {
        const { client } = await connect();
        expect(client.getInstructions()).toBe(INSTRUCTIONS);
        expect(INSTRUCTIONS).toContain('Never guess the scale');
        const { tools } = await client.listTools();
        const apply = tools.find((t) => t.name === 'apply_commands')!;
        expect(apply.description).toContain('"type":"opening.add"');
    });

    it('reports a missing Draft as a tool error', async () => {
        const { call } = await connect();
        expect(await call('get_document')).toEqual({
            isError: true,
            body: { error: 'No Draft yet: call create_draft or open_document first' },
        });
    });

    it('builds a Draft through Commands', async () => {
        const { call } = await connect();
        const created = await call('create_draft', {
            name: 'Hall A',
            kind: 'exhibition',
            size: [30, 20],
        });
        expect(created.isError).toBe(false);
        expect(created.body).toHaveProperty('preset.categories');
        const levelId = (created.body as { document: { levels: { id: string }[] } }).document
            .levels[0]!.id;

        const applied = await call('apply_commands', {
            commands: [
                { type: 'wall.add', levelId, id: 'W', a: [0, 10], b: [30, 10], thickness: 0.2 },
            ],
        });
        expect(applied).toEqual({
            isError: false,
            body: { ok: true, applied: 1, diagnostics: [] },
        });

        const doc = await call('get_document');
        expect(doc.body).toHaveProperty('levels.0.walls.0.id', 'W');
        expect((await call('get_diagnostics')).body).toEqual([]);
    });

    it('returns a rejected batch as a tool error', async () => {
        const { call } = await connect();
        await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        const applied = await call('apply_commands', {
            commands: [
                { type: 'zone.add', levelId: 'nowhere', zone: { id: 'Z', shape: { outer: [] } } },
            ],
        });
        expect(applied.isError).toBe(true);
        expect(applied.body).toMatchObject({ ok: false, failedAt: 0 });
    });

    it('calibrates, converts points and attaches the Source image', async () => {
        const { call } = await connect();
        await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        const calibrated = await call('calibrate', {
            p1: [0, 0],
            p2: [100, 0],
            distance: 10,
            size: [300, 200],
        });
        expect(calibrated.body).toEqual({ scale: 0.1, planSize: [30, 20] });
        expect((await call('source_to_plan', { points: [[100, 50]] })).body).toEqual([[10, 15]]);

        const file = join(mkdtempSync(join(tmpdir(), 'areaform-mcp-')), 'Hall.PNG');
        writeFileSync(file, png(600, 400));
        const attached = await call('attach_source', { path: file });
        expect(attached.body).toMatchObject({
            underlay: { src: 'source.png', scale: 0.05, position: [0, 20], size: [600, 400] },
        });
    });

    it('downloads the Source image from a URL without keeping the URL', async () => {
        const shot: Fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => png(600, 400).slice().buffer,
        });
        const { call } = await connect({ fetch: shot });
        await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        await call('calibrate', { p1: [0, 0], p2: [100, 0], distance: 10, size: [300, 200] });
        const url = 'https://www.figma.com/api/mcp/asset/secret-token.png';
        const attached = await call('attach_source', { url });
        expect(attached.body).toMatchObject({ underlay: { src: 'source.png', scale: 0.05 } });
        const doc = await call('get_document');
        expect(JSON.stringify(doc.body)).not.toContain('secret-token');
        expect(doc.body).toHaveProperty(['meta', 'import', 'source'], {
            kind: 'image',
            ref: 'source.png',
        });
    });

    it('explains why a Source image cannot be attached', async () => {
        const { call } = await connect();
        await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        const dir = mkdtempSync(join(tmpdir(), 'areaform-mcp-'));
        const notCalibrated = await call('attach_source', { path: join(dir, 'missing.png') });
        expect(notCalibrated.isError).toBe(true);

        await call('calibrate', { p1: [0, 0], p2: [10, 0], distance: 1, size: [300, 200] });
        const missing = await call('attach_source', { path: join(dir, 'missing.png') });
        expect(missing).toMatchObject({
            isError: true,
            body: { error: expect.stringContaining('Cannot read') },
        });

        const text = join(dir, 'notes.png');
        writeFileSync(text, 'not an image');
        const notImage = await call('attach_source', { path: text });
        expect(notImage).toMatchObject({
            isError: true,
            body: { error: expect.stringContaining('not a PNG') },
        });
    });

    it('flags an Element for review', async () => {
        const { call } = await connect();
        await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        const flagged = await call('flag', { elementId: 'nothing', reason: 'Check it' });
        expect(flagged).toMatchObject({
            isError: true,
            body: { error: 'No Level or Element has the id nothing' },
        });
        const doc = (await call('get_document')).body as { levels: { id: string }[] };
        const levelId = doc.levels[0]!.id;
        expect(await call('flag', { elementId: levelId, reason: 'Outline guessed' })).toEqual({
            isError: false,
            body: { flags: [{ ref: { kind: 'level', id: levelId }, reason: 'Outline guessed' }] },
        });
    });

    it('renders a PNG preview over the Source and saves the Draft folder', async () => {
        const { client, call } = await connect();
        await call('create_draft', { name: 'Hall A', kind: 'exhibition', size: [30, 20] });
        await call('calibrate', { p1: [0, 0], p2: [100, 0], distance: 10, size: [300, 200] });
        const dir = mkdtempSync(join(tmpdir(), 'areaform-mcp-'));
        const shot = join(dir, 'shot.png');
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#c33"/></svg>';
        writeFileSync(shot, new Resvg(svg).render().asPng());
        await call('attach_source', { path: shot });

        const result = (await client.callTool({
            name: 'render_preview',
            arguments: { width: 400 },
        })) as CallToolResult;
        const [image, info] = result.content;
        expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
        const bytes = Buffer.from(image?.type === 'image' ? image.data : '', 'base64');
        expect(bytes.subarray(1, 4).toString()).toBe('PNG');
        expect(info?.type === 'text' && JSON.parse(info.text)).toMatchObject({ sourceDrawn: true });

        const out = join(dir, 'draft');
        const saved = await call('save_document', { dir: out });
        expect(saved.body).toMatchObject({ plan: join(out, 'plan.json'), scale: 0.1, flags: [] });
        expect(existsSync(join(out, 'source.png'))).toBe(true);

        rmSync(shot);
        expect((await call('render_preview')).body).toEqual({
            error: `The Source image ${shot} is gone; attach it again`,
        });
    });

    it('renders another Level by its id, with its Stops and without the Source', async () => {
        const { client, call } = await connect();
        const created = await call('create_draft', { name: 'Office', kind: 'office' });
        const ground = (created.body as { document: { levels: { id: string }[] } }).document
            .levels[0]!.id;
        await call('calibrate', { p1: [0, 0], p2: [100, 0], distance: 10, size: [100, 100] });
        const dir = mkdtempSync(join(tmpdir(), 'areaform-mcp-'));
        const shot = join(dir, 'shot.png');
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#c33"/></svg>';
        writeFileSync(shot, new Resvg(svg).render().asPng());
        await call('attach_source', { path: shot });
        const square = {
            outer: [
                [4, 4],
                [6, 4],
                [6, 6],
                [4, 6],
            ],
        };
        await call('apply_commands', {
            commands: [
                { type: 'level.add', id: 'p1', name: 'P1 Parking', at: 'bottom' },
                {
                    type: 'connection.add',
                    connection: {
                        id: 'stair-a',
                        kind: 'stairs',
                        name: 'Stair A',
                        bidirectional: true,
                        stops: [
                            { levelId: ground, shape: square },
                            { levelId: 'p1', shape: square },
                        ],
                    },
                },
            ],
        });
        const preview = async (args: Record<string, unknown>) => {
            const result = (await client.callTool({
                name: 'render_preview',
                arguments: { width: 300, ...args },
            })) as CallToolResult;
            const info = result.content.find((c) => c.type === 'text');
            return {
                image: result.content.some((c) => c.type === 'image'),
                info: JSON.parse(info?.type === 'text' ? info.text : '{}') as unknown,
            };
        };

        expect(await preview({})).toMatchObject({
            image: true,
            info: { level: { id: ground, name: 'Level 1' }, sourceDrawn: true },
        });
        expect(await preview({ levelId: 'p1' })).toMatchObject({
            image: true,
            info: { level: { id: 'p1', name: 'P1 Parking' }, sourceDrawn: false },
        });
        expect((await call('render_preview', { levelId: 'b9' })).body).toEqual({
            error: `No Level "b9" in the Draft; its Levels are ${ground} (Level 1), p1 (P1 Parking)`,
        });
        rmSync(dir, { recursive: true });
    });

    it("updates the Zones of a saved plan from the person's records", async () => {
        const { call } = await connect();
        const created = await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        const levelId = (created.body as { document: { levels: { id: string }[] } }).document
            .levels[0]!.id;
        const booth = (id: string, label: string, x: number) => ({
            type: 'zone.add',
            levelId,
            zone: {
                id,
                label,
                category: 'booth',
                shape: {
                    outer: [
                        [x, 1],
                        [x + 2, 1],
                        [x + 2, 3],
                        [x, 3],
                    ],
                },
            },
        });
        await call('apply_commands', { commands: [booth('b1', 'A1', 1), booth('b2', 'A2', 4)] });
        const dir = join(mkdtempSync(join(tmpdir(), 'areaform-mcp-')), 'hall-a');
        await call('save_document', { dir });

        const { call: later } = await connect();
        const opened = await later('open_document', { path: dir });
        expect(opened.body).toMatchObject({ plan: join(dir, 'plan.json'), repairs: [] });
        const matched = await later('match_zones', {
            rows: [
                { stand: 'a-1', id: 101, company: 'Acme' },
                { stand: 'C7', id: 102 },
            ],
            key: 'stand',
            by: 'label',
            set: { 'data.externalId': 'id', 'data.exhibitor': 'company' },
        });
        expect(matched.body).toMatchObject({
            counts: { rows: 2, zones: 2, matched: 1, updates: 1 },
            unmatchedRows: [{ row: 1, key: 'C7' }],
            unmatchedZones: [{ zoneId: 'b2', label: 'A2' }],
        });
        const { commands } = matched.body as { commands: unknown[] };
        expect((await later('apply_commands', { commands })).isError).toBe(false);
        await later('save_document', { dir, overwrite: true });

        const reopened = await later('open_document', { path: dir });
        expect(reopened.body).toHaveProperty(['document', 'levels', 0, 'zones', 0, 'data'], {
            externalId: 101,
            exhibitor: 'Acme',
        });
    });

    it('rejects a Zone field match_zones cannot match on', async () => {
        const { call } = await connect();
        await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
        const result = await call('match_zones', {
            rows: [{ stand: 'A1' }],
            key: 'stand',
            by: 'shape',
        }).catch((error: Error) => ({ isError: true, body: { error: error.message } }));
        expect(result.isError).toBe(true);
    });

    describe('figma_extract', () => {
        const hall = readFileSync(
            new URL('../eval/hall-a.figma-nodes.json', import.meta.url),
            'utf8',
        );
        const figma: Fetch = async () => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new ArrayBuffer(0),
            json: async () => JSON.parse(hall),
        });
        const url = 'https://www.figma.com/design/P5TiBrbI4CMKdtxwnixTZv/Hall?node-id=1-2';

        it('calibrates from the Dimension layer and proposes Commands, applying nothing', async () => {
            const { call } = await connect({ figmaToken: 't', fetch: figma });
            await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
            const extracted = await call('figma_extract', { url });
            expect(extracted.isError).toBe(false);
            expect(extracted.body).toMatchObject({
                scale: 0.05,
                calibratedFrom: 'the Dimension layer (60 m)',
                counts: { outline: 1, walls: 4, openings: 6, zones: 61, obstacles: 6 },
                skipped: [{ name: 'Fire lane', reason: 'its name matches no convention' }],
            });
            const doc = (await call('get_document')).body as { levels: { zones: unknown[] }[] };
            expect(doc.levels[0]!.zones).toEqual([]);

            const commands = (extracted.body as { commands: unknown[] }).commands;
            const applied = await call('apply_commands', { commands });
            expect(applied.body).toMatchObject({ ok: true, applied: commands.length });
            const after = (await call('get_document')).body;
            expect(after).toHaveProperty(['meta', 'import', 'sourceRefs', 'fig-1-8'], '1:8');
        });

        it('reads the frame in points when the Draft is calibrated on a @2x screenshot', async () => {
            const byDimension = await connect({ figmaToken: 't', fetch: figma });
            await byDimension.call('create_draft', { name: 'Hall A', kind: 'exhibition' });
            const expected = (await byDimension.call('figma_extract', { url })).body;

            const { call } = await connect({ figmaToken: 't', fetch: figma });
            await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
            await call('calibrate', {
                p1: [0, 0],
                p2: [2400, 0],
                distance: 60,
                size: [2640, 1840],
            });
            const extracted = await call('figma_extract', { url });
            expect(extracted.body).toMatchObject({ scale: 0.05 });
            expect(extracted.body).not.toHaveProperty('calibratedFrom');
            // The same Commands, but for each Draft's own Level.
            const withoutLevel = (body: Record<string, unknown>) =>
                (body['commands'] as Record<string, unknown>[]).map((c) => ({
                    ...c,
                    levelId: 'L',
                }));
            expect(withoutLevel(extracted.body)).toEqual(withoutLevel(expected));

            await call('calibrate', {
                p1: [0, 0],
                p2: [2400, 0],
                distance: 60,
                size: [2640, 2640],
            });
            expect((await call('figma_extract', { url })).body).toMatchObject({
                error: expect.stringContaining('aspect ratio'),
            });
        });

        it('explains what is missing', async () => {
            const noToken = await connect({ fetch: figma, figmaToken: '' });
            await noToken.call('create_draft', { name: 'Hall A', kind: 'exhibition' });
            expect((await noToken.call('figma_extract', { url })).body).toMatchObject({
                error: expect.stringContaining('FIGMA_TOKEN is not set'),
            });

            const { call } = await connect({ figmaToken: 't', fetch: figma });
            await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
            expect(
                (await call('figma_extract', { url: 'https://www.figma.com/design/K/Hall' })).body,
            ).toMatchObject({
                error: expect.stringContaining('node-id'),
            });

            const refusing: Fetch = async () => ({
                ok: false,
                status: 404,
                arrayBuffer: async () => new ArrayBuffer(0),
                json: async () => ({ err: 'Not found' }),
            });
            const refused = await connect({ figmaToken: 't', fetch: refusing });
            await refused.call('create_draft', { name: 'Hall A', kind: 'exhibition' });
            expect((await refused.call('figma_extract', { url })).body).toEqual({
                error: 'Could not read the frame: Figma answered 404: Not found',
            });
        });
    });

    describe('frame_viewpoint', () => {
        async function withBooth() {
            const { call } = await connect();
            const { body } = await call('create_draft', { name: 'Hall', kind: 'exhibition' });
            const levelId = (body.document as { levels: { id: string }[] }).levels[0]!.id;
            await call('apply_commands', {
                commands: [
                    {
                        type: 'zone.add',
                        levelId,
                        zone: {
                            id: 'booth',
                            shape: {
                                outer: [
                                    [2, 2],
                                    [6, 2],
                                    [6, 5],
                                    [2, 5],
                                ],
                            },
                        },
                    },
                ],
            });
            return { call, levelId };
        }

        it('frames Zones from the angles asked and returns the Command that adds the Viewpoint', async () => {
            const { call, levelId } = await withBooth();

            const { isError, body } = await call('frame_viewpoint', {
                levelId,
                zoneIds: ['booth'],
                bearing: 0,
                tilt: 0,
                name: 'Booth',
            });

            expect(isError).toBe(false);
            const viewpoint = body.viewpoint as { target: number[]; distance: number };
            // Straight down, it looks at the booth's middle, from as close as fits it.
            expect(viewpoint).toMatchObject({
                name: 'Booth',
                target: [4, 3.5],
                bearing: 0,
                tilt: 0,
            });
            expect(viewpoint.distance).toBeGreaterThan(3);
            expect(viewpoint.distance).toBeLessThan(20);
            expect(body.command).toEqual({ type: 'viewpoint.add', levelId, viewpoint });

            // Nothing changes until it is applied; then the plan has it.
            await call('apply_commands', { commands: [body.command] });
            const { body: doc } = await call('get_document');
            expect(
                (doc as { levels: { viewpoints?: unknown[] }[] }).levels[0]!.viewpoints,
            ).toHaveLength(1);
        });

        it('frames a point with the room around it, further for a wider radius', async () => {
            const { call, levelId } = await withBooth();
            const distance = async (radius: number) =>
                (
                    (
                        await call('frame_viewpoint', {
                            levelId,
                            point: [10, 10],
                            radius,
                            bearing: 90,
                            tilt: 45,
                        })
                    ).body.viewpoint as { distance: number }
                ).distance;

            expect(await distance(10)).toBeGreaterThan((await distance(2)) * 1.5);
        });

        it('says what is wrong: an unknown Zone, nothing to look at, a tilt out of range', async () => {
            const { call, levelId } = await withBooth();

            for (const [args, says] of [
                [{ zoneIds: ['nope'], tilt: 30 }, 'no Zone nope'],
                [{ tilt: 30 }, 'zoneIds or a point'],
                [{ zoneIds: ['booth'], tilt: 88 }, 'from 0 to 87'],
            ] as const) {
                const { isError, body } = await call('frame_viewpoint', {
                    levelId,
                    bearing: 0,
                    ...args,
                });
                expect(isError).toBe(true);
                expect(body.error).toContain(says);
            }
        });
    });
});
