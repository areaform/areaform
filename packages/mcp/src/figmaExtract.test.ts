import { fromJSON, presetFor, type Command } from '@areaform/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FigmaNode } from './figma.ts';
import { buildCommands, roleOf, scanFrame } from './figmaExtract.ts';
import { score } from './score.ts';
import { createDraftSession } from './session.ts';

const exhibition = presetFor('exhibition');

/** A node at (x, y) in its parent, optionally turned by `degrees` (Figma turns clockwise on screen). */
function node(
    id: string,
    name: string,
    type: string,
    [x, y]: [number, number],
    [w, h]: [number, number],
    extra: Partial<FigmaNode> & { degrees?: number } = {},
): FigmaNode {
    const { degrees = 0, ...rest } = extra;
    const r = (degrees * Math.PI) / 180;
    const [c, s] = [Math.round(Math.cos(r) * 1e9) / 1e9, Math.round(Math.sin(r) * 1e9) / 1e9];
    return {
        id,
        name,
        type,
        relativeTransform: [
            [c, -s, x],
            [s, c, y],
        ],
        size: { x: w, y: h },
        ...rest,
    };
}

const frame = (children: FigmaNode[]): FigmaNode =>
    node('0:1', 'Plan', 'FRAME', [500, 500], [200, 100], { children });

const commandsOf = <T extends Command['type']>(commands: Command[], type: T) =>
    commands.filter((c): c is Extract<Command, { type: T }> => c.type === type);

/** 0.1 m per unit, so a 200 × 100 frame is 20 × 10 m with its bottom-left at the origin. */
const CALIBRATION = { scale: 0.1, size: [200, 100] as [number, number] };

describe('roleOf', () => {
    it('reads the convention from the start of a name, ignoring case', () => {
        expect(roleOf('Floor', exhibition)).toEqual({ role: 'outline' });
        expect(roleOf('walls north', exhibition)).toEqual({ role: 'wall' });
        expect(roleOf('Emergency exit 2', exhibition)).toEqual({
            role: 'opening',
            kind: 'emergency-exit',
        });
        expect(roleOf('EXIT', exhibition)).toEqual({ role: 'opening', kind: 'emergency-exit' });
        expect(roleOf('Door', exhibition)).toEqual({ role: 'opening', kind: 'door' });
        expect(roleOf('Pillar', exhibition)).toEqual({ role: 'obstacle', kind: 'column' });
        expect(roleOf('Obstacle', exhibition)).toEqual({ role: 'obstacle', kind: 'other' });
        expect(roleOf('Dimension 12,5 m', exhibition)).toEqual({ role: 'dimension', metres: 12.5 });
    });

    it('takes a Preset category and the rest of the name as the label', () => {
        expect(roleOf('Booth A1', exhibition)).toEqual({
            role: 'zone',
            category: 'booth',
            walkAround: true,
            label: 'A1',
        });
        expect(roleOf('booth: Acme', exhibition)).toEqual({
            role: 'zone',
            category: 'booth',
            walkAround: true,
            label: 'Acme',
        });
        expect(roleOf('Registration', exhibition)).toEqual({
            role: 'zone',
            category: 'registration',
        });
        expect(roleOf('Aisle 3', exhibition)).toEqual({
            role: 'zone',
            category: 'aisle',
            restricted: true,
            label: '3',
        });
        expect(roleOf('Meeting room 4', presetFor('office'))).toMatchObject({
            category: 'meeting-room',
            label: '4',
        });
    });

    it('has Zone and Restricted for areas with no category', () => {
        expect(roleOf('Zone Café', exhibition)).toEqual({ role: 'zone', label: 'Café' });
        expect(roleOf('Restricted – fire lane', exhibition)).toEqual({
            role: 'zone',
            restricted: true,
            label: 'fire lane',
        });
    });

    it('leaves other names alone', () => {
        expect(roleOf('Fire lane', exhibition)).toBeUndefined();
        expect(roleOf('Boothy', exhibition)).toBeUndefined();
        expect(roleOf('Wallpaper', exhibition)).toBeUndefined();
    });
});

describe('scanFrame and buildCommands', () => {
    it('turns bars into Walls that meet at their corners', () => {
        const scan = scanFrame(
            frame([
                // Overlapping bars 2 units thick around the frame's inner 180 × 80 box.
                node('1:1', 'Wall', 'RECTANGLE', [9, 9], [182, 2]),
                node('1:2', 'Wall', 'RECTANGLE', [9, 9], [2, 82]),
                // A wall turned 90°: its own width runs down the screen. With no wall along the
                // bottom, the two side walls keep their free ends where the bars stop.
                node('1:3', 'Wall', 'RECTANGLE', [191, 9], [82, 2], { degrees: 90 }),
            ]),
            exhibition,
        );
        const walls = commandsOf(buildCommands(scan, CALIBRATION, 'L').commands, 'wall.add');
        expect(walls).toEqual([
            {
                type: 'wall.add',
                levelId: 'L',
                id: 'fig-1-1',
                a: [1, 9],
                b: [19, 9],
                thickness: 0.2,
            },
            {
                type: 'wall.add',
                levelId: 'L',
                id: 'fig-1-2',
                a: [1, 9],
                b: [1, 0.9],
                thickness: 0.2,
            },
            {
                type: 'wall.add',
                levelId: 'L',
                id: 'fig-1-3',
                a: [19, 9],
                b: [19, 0.9],
                thickness: 0.2,
            },
        ]);
    });

    it('reads a LINE as a Wall as thick as its stroke', () => {
        const line = node('1:1', 'Wall', 'LINE', [10, 50], [100, 0], { strokeWeight: 3 });
        const [wall] = commandsOf(
            buildCommands(scanFrame(frame([line]), exhibition), CALIBRATION, 'L').commands,
            'wall.add',
        );
        expect(wall).toMatchObject({ a: [1, 5], b: [11, 5], thickness: 0.3 });
    });

    it('hosts an Opening on the Wall it lies on, its offset measured to its centre', () => {
        const scan = scanFrame(
            frame([
                node('1:1', 'Wall', 'RECTANGLE', [10, 89], [180, 2]),
                node('1:2', 'Door', 'RECTANGLE', [50, 88], [9, 4]),
                node('1:3', 'Entrance', 'RECTANGLE', [100, 40], [20, 4]),
            ]),
            exhibition,
        );
        const extraction = buildCommands(scan, CALIBRATION, 'L');
        const [door, entrance] = commandsOf(extraction.commands, 'opening.add').map(
            (c) => c.opening,
        );
        expect(door).toEqual({
            id: 'fig-1-2',
            kind: 'door',
            width: 0.9,
            host: 'wall',
            wallId: 'fig-1-1',
            // The Door spans 4–4.9 m along the Wall from its start.
            offset: 4.45,
        });
        expect(entrance).toMatchObject({
            kind: 'entrance',
            host: 'free',
            width: 2,
            position: [11, 5.8],
            angle: 0,
        });
        expect(extraction.notes).toContain('"Entrance" is on no Wall, so it is a free Opening');
    });

    it('labels a Zone by its name, or else by the text inside it', () => {
        const scan = scanFrame(
            frame([
                node('1:1', 'Booth A1', 'RECTANGLE', [10, 10], [30, 30]),
                node('1:2', 'A1', 'TEXT', [20, 20], [10, 10], { characters: 'A1' }),
                node('1:3', 'Registration', 'RECTANGLE', [50, 10], [40, 30]),
                node('1:4', 'Text', 'TEXT', [60, 20], [20, 10], { characters: 'Check-in' }),
                node('1:5', 'Title', 'TEXT', [100, 80], [50, 10], { characters: 'Hall A' }),
            ]),
            exhibition,
        );
        const extraction = buildCommands(scan, CALIBRATION, 'L');
        expect(
            commandsOf(extraction.commands, 'zone.add').map((c) => [c.zone.label, c.zone.category]),
        ).toEqual([
            ['A1', 'booth'],
            ['Check-in', 'registration'],
        ]);
        expect(extraction.unusedTexts).toEqual(['Hall A']);
    });

    describe('groups', () => {
        const booth = [
            [10, 9],
            [13, 9],
            [13, 6],
            [10, 6],
        ];
        const zoneIn = (plan: FigmaNode) =>
            commandsOf(
                buildCommands(scanFrame(plan, exhibition), CALIBRATION, 'L').commands,
                'zone.add',
            )[0]!.zone.shape.outer;

        it("places a group's children in the space of the group's parent", () => {
            const group = node('2:1', 'Row A', 'GROUP', [100, 10], [30, 30], {
                children: [node('2:2', 'Booth A1', 'RECTANGLE', [100, 10], [30, 30])],
            });
            expect(zoneIn(frame([group]))).toEqual(booth);
        });

        it("adds up the group's transform when the canvas bounds say so", () => {
            const at = (x: number, y: number, w: number, h: number) => ({
                absoluteBoundingBox: { x, y, width: w, height: h },
            });
            const group = node('2:1', 'Row A', 'GROUP', [100, 0], [30, 40], {
                ...at(600, 500, 30, 40),
                children: [
                    node('2:2', 'Booth A1', 'RECTANGLE', [0, 10], [30, 30], at(600, 510, 30, 30)),
                ],
            });
            expect(zoneIn({ ...frame([group]), ...at(500, 500, 200, 100) })).toEqual(booth);
        });
    });

    it('takes a straight-edged path as a polygon, and a curved one as its bounding box', () => {
        const scan = scanFrame(
            frame([
                node('1:1', 'Zone Lounge', 'VECTOR', [10, 10], [40, 40], {
                    fillGeometry: [{ path: 'M0 0 L40 0 L40 20 L20 20 L20 40 L0 40 L0 0 Z' }],
                }),
                node('1:2', 'Column', 'ELLIPSE', [100, 50], [6, 6], {
                    fillGeometry: [
                        {
                            path: 'M6 3 C6 4.66 4.66 6 3 6 C1.34 6 0 4.66 0 3 C0 1.34 1.34 0 3 0 C4.66 0 6 1.34 6 3 Z',
                        },
                    ],
                }),
            ]),
            exhibition,
        );
        const extraction = buildCommands(scan, CALIBRATION, 'L');
        const [zone] = commandsOf(extraction.commands, 'zone.add');
        expect(zone!.zone.shape.outer).toHaveLength(6);
        const [column] = commandsOf(extraction.commands, 'obstacle.add');
        expect(column!.obstacle.shape.outer).toHaveLength(4);
        expect(extraction.notes).toContain('"Column" is curved; its bounding box is used');
    });

    it('skips hidden layers silently and reports the ones it cannot read', () => {
        const scan = scanFrame(
            frame([
                node('1:1', 'Booth A1', 'RECTANGLE', [10, 10], [30, 30], { visible: false }),
                node('1:2', 'Fire lane', 'RECTANGLE', [10, 50], [180, 10]),
                node('1:3', 'Floor', 'RECTANGLE', [0, 0], [200, 100]),
                node('1:4', 'Floor', 'RECTANGLE', [0, 0], [20, 10]),
            ]),
            exhibition,
        );
        const extraction = buildCommands(scan, CALIBRATION, 'L');
        expect(extraction.counts).toMatchObject({ outline: 1, zones: 0 });
        expect(extraction.skipped).toEqual([
            {
                nodeId: '1:2',
                name: 'Fire lane',
                type: 'RECTANGLE',
                reason: 'its name matches no convention',
            },
            { nodeId: '1:4', name: 'Floor', type: 'RECTANGLE', reason: 'a second Outline' },
        ]);
    });

    it('notes a missing Outline and finds the scale on a Dimension layer', () => {
        const scan = scanFrame(
            frame([node('1:1', 'Dimension 15 m', 'RECTANGLE', [20, 5], [150, 1])]),
            exhibition,
        );
        expect(scan.dimension).toEqual({ p1: [20, 5.5], p2: [170, 5.5], metres: 15 });
        expect(buildCommands(scan, CALIBRATION, 'L').notes[0]).toMatch(/No layer called Outline/);
    });
});

describe('the recorded demo hall', () => {
    const body = JSON.parse(
        readFileSync(new URL('../eval/hall-a.figma-nodes.json', import.meta.url), 'utf8'),
    );
    const hall = body.nodes['1:2'].document as FigmaNode;
    const expected = fromJSON(
        readFileSync(new URL('../eval/demo-hall.json', import.meta.url), 'utf8'),
    );

    it('comes back whole but for the layer outside the convention', () => {
        const session = createDraftSession();
        const doc = session.create({ name: 'Hall A', kind: 'exhibition' });
        const scan = scanFrame(hall, session.preset());
        const { p1, p2, metres } = scan.dimension!;
        session.calibrate(p1, p2, metres, scan.size);
        const extraction = buildCommands(scan, session.calibration()!, doc.levels[0]!.id);
        expect(extraction.skipped.map((s) => s.name)).toEqual(['Fire lane']);

        session.expectSourceRefs(extraction.sourceRefs);
        expect(session.apply(extraction.commands)).toMatchObject({ ok: true, diagnostics: [] });
        const level = session.document().levels[0]!;
        expect(level.wallNodes).toHaveLength(4);
        expect(session.document().meta?.['import']).toMatchObject({
            sourceRefs: { 'fig-1-8': '1:8', 'fig-1-134': '1:134' },
        });

        if (!expected.ok) throw new Error('the demo hall fixture does not load');
        const s = score(expected.doc.levels[0]!, level);
        expect(s.zones).toMatchObject({
            matched: 61,
            missing: ['Fire lane'],
            extra: 0,
            meanIoU: 1,
        });
        expect(s.zones.sameCategory).toBe(61);
        expect(s.zones.sameLabel).toBe(61);
        expect(s.walls.foundLength).toBeCloseTo(200);
        expect(s.openings).toMatchObject({ matched: 6, sameKind: 6, meanWidthError: 0 });
        expect(s.obstacles.matched).toBe(6);
    });
});
