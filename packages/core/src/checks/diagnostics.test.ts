import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, diagnose, type Command, type Ring } from '../index.ts';

function square(x: number, y: number, size = 3): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

/** A 40 × 25 m Space whose ground Level id is `G`, built from Commands that must all succeed. */
function space(kind = 'exhibition', ...commands: ((levelId: string) => Command)[]) {
    const doc = createSpace({ name: 'Test', kind, size: [40, 25] });
    const editor = createEditor(doc);
    const G = doc.levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(G));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return { doc: editor.getDocument(), G, editor };
}

const zone =
    (id: string, outer: Ring, category?: string) =>
    (levelId: string): Command => ({
        type: 'zone.add',
        levelId,
        zone: { id, shape: { outer }, ...(category && { category }) },
    });

describe('diagnose', () => {
    it('finds nothing wrong with a tidy Space', () => {
        const { doc } = space(
            'exhibition',
            zone('A-1', square(1, 1), 'booth'),
            zone('A-2', square(4, 1), 'booth'),
            (levelId) => ({ type: 'wall.add', levelId, a: [0, 0], b: [40, 0], thickness: 0.2 }),
        );

        expect(diagnose(doc)).toEqual([]);
    });

    it('never blocks: a Document with Diagnostics is accepted by the Editor', () => {
        const { doc } = space('exhibition', zone('OUT', square(39, 1)));

        expect(diagnose(doc)).toHaveLength(1);
    });
});

describe('outside-outline', () => {
    it('reports a Zone sticking out of the Outline, but not one touching its edge', () => {
        const { doc, G } = space(
            'exhibition',
            zone('OUT', square(38, 10)),
            zone('EDGE', square(37, 10)),
        );

        expect(diagnose(doc)).toEqual([
            { code: 'outside-outline', ref: { kind: 'zone', id: 'OUT', levelId: G } },
        ]);
    });

    it('reports a Zone placed inside a hole of the Outline (an atrium)', () => {
        const { doc, G } = space(
            'exhibition',
            (levelId) => ({
                type: 'level.setOutline',
                levelId,
                outline: { outer: square(0, 0, 40), holes: [square(10, 10, 10)] },
            }),
            zone('IN-ATRIUM', square(12, 12)),
            zone('AROUND-ATRIUM', square(8, 8, 14)),
        );

        expect(diagnose(doc)).toEqual([
            { code: 'outside-outline', ref: { kind: 'zone', id: 'IN-ATRIUM', levelId: G } },
            { code: 'outside-outline', ref: { kind: 'zone', id: 'AROUND-ATRIUM', levelId: G } },
        ]);
    });

    it('reports Walls, free Openings and Obstacles outside the Outline', () => {
        const { doc, G } = space(
            'exhibition',
            (levelId) => ({
                type: 'wall.add',
                levelId,
                id: 'W-OUT',
                a: [30, 5],
                b: [45, 5],
                thickness: 0.2,
            }),
            (levelId) => ({
                type: 'opening.add',
                levelId,
                opening: {
                    id: 'E-EDGE',
                    kind: 'entrance',
                    width: 4,
                    host: 'free',
                    position: [40, 12],
                    angle: 0,
                },
            }),
            (levelId) => ({
                type: 'opening.add',
                levelId,
                opening: {
                    id: 'E-OUT',
                    kind: 'entrance',
                    width: 4,
                    host: 'free',
                    position: [50, 12],
                    angle: 0,
                },
            }),
            (levelId) => ({
                type: 'obstacle.add',
                levelId,
                obstacle: { id: 'COL', kind: 'column', shape: { outer: square(-1, 5, 0.5) } },
            }),
        );

        expect(diagnose(doc)).toEqual([
            { code: 'outside-outline', ref: { kind: 'wall', id: 'W-OUT', levelId: G } },
            { code: 'outside-outline', ref: { kind: 'opening', id: 'E-OUT', levelId: G } },
            { code: 'outside-outline', ref: { kind: 'obstacle', id: 'COL', levelId: G } },
        ]);
    });
});

describe('opening-off-wall', () => {
    const wallWithDoor = (offset: number) => [
        (levelId: string): Command => ({
            type: 'wall.add',
            levelId,
            id: 'W1',
            a: [0, 5],
            b: [10, 5],
            thickness: 0.1,
        }),
        (levelId: string): Command => ({
            type: 'opening.add',
            levelId,
            opening: { id: 'D1', kind: 'door', width: 0.9, host: 'wall', wallId: 'W1', offset },
        }),
    ];

    it('reports a door that does not fit on its Wall', () => {
        const { doc, G } = space('office', ...wallWithDoor(9.8));

        expect(diagnose(doc)).toEqual([
            { code: 'opening-off-wall', ref: { kind: 'opening', id: 'D1', levelId: G } },
        ]);
    });

    it('reports a door left hanging after its Wall was shortened', () => {
        const { editor, G } = space('office', ...wallWithDoor(8));
        expect(diagnose(editor.getDocument())).toEqual([]);
        const end = editor.getDocument().levels[0]!.walls[0]!.b;

        editor.exec({ type: 'wallNode.move', levelId: G, nodeId: end, to: [6, 5] });

        expect(diagnose(editor.getDocument()).map((d) => d.code)).toEqual(['opening-off-wall']);
    });
});

describe('zones-overlap', () => {
    it('reports overlapping booths in an exhibition', () => {
        const { doc, G } = space(
            'exhibition',
            zone('A-1', square(1, 1), 'booth'),
            zone('A-2', square(3, 2), 'booth'),
        );

        expect(diagnose(doc)).toEqual([
            {
                code: 'zones-overlap',
                ref: { kind: 'zone', id: 'A-1', levelId: G },
                other: { kind: 'zone', id: 'A-2', levelId: G },
            },
        ]);
    });

    it('reports two identical booths', () => {
        const { doc } = space(
            'exhibition',
            zone('A-1', square(1, 1), 'booth'),
            zone('A-2', square(1, 1), 'booth'),
        );

        expect(diagnose(doc).map((d) => d.code)).toEqual(['zones-overlap']);
    });

    it('reports a booth inside another booth', () => {
        const { doc } = space(
            'exhibition',
            zone('BIG', square(1, 1, 6), 'booth'),
            zone('SMALL', square(2, 2, 1), 'booth'),
        );

        expect(diagnose(doc).map((d) => d.code)).toEqual(['zones-overlap']);
    });

    it('ignores overlaps involving a Zone Category the Preset does not treat as exclusive', () => {
        const { doc } = space(
            'exhibition',
            zone('A-1', square(1, 1), 'booth'),
            zone('HALL', square(0, 0, 20), 'area'),
            zone('LOOSE', square(2, 2)),
        );

        expect(diagnose(doc)).toEqual([]);
    });

    it('reports overlaps across different Exclusive Categories, such as two rooms of a flat', () => {
        const { doc } = space(
            'flat',
            zone('LIVING', square(0, 0, 5), 'living'),
            zone('BED', square(4, 0, 4), 'bedroom'),
        );

        expect(diagnose(doc).map((d) => d.code)).toEqual(['zones-overlap']);
    });

    it('lets warehouse Roads cross, as they are Restricted but not exclusive', () => {
        const { doc } = space(
            'warehouse',
            zone(
                'ROAD-1',
                [
                    [0, 4],
                    [30, 4],
                    [30, 8],
                    [0, 8],
                ],
                'road',
            ),
            zone(
                'ROAD-2',
                [
                    [10, 0],
                    [14, 0],
                    [14, 20],
                    [10, 20],
                ],
                'road',
            ),
        );

        expect(diagnose(doc)).toEqual([]);
    });

    it("takes the Exclusive Categories from a host's own Presets", () => {
        const { doc } = space(
            'parking',
            zone('P-1', square(1, 1), 'spot'),
            zone('P-2', square(2, 2), 'spot'),
        );
        const parking = {
            label: 'Parking',
            gridStep: 2.5,
            levelHeight: 2.4,
            categories: [{ id: 'spot', label: 'Spot', exclusive: true }],
        };

        expect(diagnose(doc)).toEqual([]);
        expect(diagnose(doc, { presets: { parking } }).map((d) => d.code)).toEqual([
            'zones-overlap',
        ]);
    });

    it('ignores overlapping booths in a Space Kind without exclusive categories', () => {
        const { doc } = space(
            'office',
            zone('A-1', square(1, 1), 'booth'),
            zone('A-2', square(3, 2), 'booth'),
        );

        expect(diagnose(doc)).toEqual([]);
    });
});

describe('walls-overlap', () => {
    it('reports collinear Walls that overlap, but not ones meeting end to end', () => {
        const { doc, G } = space(
            'office',
            (levelId) => ({
                type: 'wall.add',
                levelId,
                id: 'W1',
                a: [0, 5],
                b: [6, 5],
                thickness: 0.1,
            }),
            (levelId) => ({
                type: 'wall.add',
                levelId,
                id: 'W2',
                a: [4, 5],
                b: [10, 5],
                thickness: 0.1,
            }),
            (levelId) => ({
                type: 'wall.add',
                levelId,
                id: 'W3',
                a: [10, 5],
                b: [14, 5],
                thickness: 0.1,
            }),
        );

        expect(diagnose(doc)).toEqual([
            {
                code: 'walls-overlap',
                ref: { kind: 'wall', id: 'W1', levelId: G },
                other: { kind: 'wall', id: 'W2', levelId: G },
            },
        ]);
    });
});

describe('hole-outside-outer', () => {
    it('reports a hole that is not inside its outer ring', () => {
        const { doc, G } = space('exhibition', (levelId) => ({
            type: 'zone.add',
            levelId,
            zone: { id: 'Z', shape: { outer: square(1, 1, 5), holes: [square(4, 4, 4)] } },
        }));

        expect(diagnose(doc)).toEqual([
            { code: 'hole-outside-outer', ref: { kind: 'zone', id: 'Z', levelId: G } },
        ]);
    });
});

describe('holes-overlap', () => {
    it('reports a shape whose holes overlap each other', () => {
        const { doc, G } = space('exhibition', (levelId) => ({
            type: 'zone.add',
            levelId,
            zone: {
                id: 'Z',
                shape: { outer: square(0, 0, 10), holes: [square(2, 2, 3), square(4, 4, 3)] },
            },
        }));

        expect(diagnose(doc)).toEqual([
            { code: 'holes-overlap', ref: { kind: 'zone', id: 'Z', levelId: G } },
        ]);
    });

    it('accepts holes that only share an edge', () => {
        const { doc } = space('exhibition', (levelId) => ({
            type: 'zone.add',
            levelId,
            zone: {
                id: 'Z',
                shape: { outer: square(0, 0, 10), holes: [square(2, 2, 3), square(5, 2, 3)] },
            },
        }));

        expect(diagnose(doc)).toEqual([]);
    });

    it('checks the Outline too', () => {
        const { doc, G } = space('office', (levelId) => ({
            type: 'level.setOutline',
            levelId,
            outline: {
                outer: [
                    [0, 0],
                    [40, 0],
                    [40, 25],
                    [0, 25],
                ],
                holes: [square(2, 2, 3), square(3, 3, 1)],
            },
        }));

        expect(diagnose(doc)).toEqual([{ code: 'holes-overlap', ref: { kind: 'level', id: G } }]);
    });
});

describe('stop-misaligned', () => {
    it('reports a Stop whose footprint does not overlap the Stop on the Level below', () => {
        const { doc } = space(
            'office',
            () => ({ type: 'level.add', id: 'L1', name: 'Level 2' }),
            () => ({ type: 'level.add', id: 'L2', name: 'Level 3' }),
            (ground) => ({
                type: 'connection.add',
                connection: {
                    id: 'LIFT',
                    kind: 'elevator',
                    stops: [
                        { levelId: 'L2', shape: { outer: square(20, 20, 2) } },
                        { levelId: ground, shape: { outer: square(5, 5, 2) } },
                        { levelId: 'L1', shape: { outer: square(5.5, 5.5, 2) } },
                    ],
                    bidirectional: true,
                },
            }),
        );

        expect(diagnose(doc)).toEqual([
            {
                code: 'stop-misaligned',
                ref: { kind: 'stop', id: 'LIFT', levelId: 'L2' },
                other: { kind: 'stop', id: 'LIFT', levelId: 'L1' },
            },
        ]);
    });
});
