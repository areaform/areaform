import { createEditor, createSpace, type Command, type Ring } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { exitsOf, inShape, isInside, OUTSIDE_CLEARANCE, placeOf, wayOutside } from './index.ts';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/** A 30 × 20 m building with a mezzanine (west half) and a gallery (west quarter) above it. */
function building(...more: ((ids: { G: string }) => Command[])[]) {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'mall', size: [30, 20] }));
    const G = editor.getDocument().levels[0]!.id;
    const commands: Command[] = [
        { type: 'level.add', id: 'mezzanine', name: 'Mezzanine' },
        { type: 'level.setOutline', levelId: 'mezzanine', outline: { outer: rect(0, 0, 15, 20) } },
        { type: 'level.add', id: 'gallery', name: 'Gallery' },
        { type: 'level.setOutline', levelId: 'gallery', outline: { outer: rect(0, 0, 8, 20) } },
        ...more.flatMap((m) => m({ G })),
    ];
    for (const command of commands) {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return { doc: editor.getDocument(), G };
}

const entrance =
    (offset: number, kind: 'entrance' | 'emergency-exit' = 'entrance') =>
    ({ G }: { G: string }): Command[] => [
        { type: 'wall.add', levelId: G, id: 'S', a: [0, 0], b: [30, 0], thickness: 0.2 },
        {
            type: 'opening.add',
            levelId: G,
            opening: { id: 'S-door', kind, width: 1.6, host: 'wall', wallId: 'S', offset },
        },
    ];

const withEntrance = (offset: number, kind?: 'entrance' | 'emergency-exit') =>
    building(entrance(offset, kind));

describe('placeOf', () => {
    it('is the place itself inside its Level’s Outline', () => {
        const { doc } = building();
        const at = { levelId: 'gallery', point: [4, 10] as [number, number] };
        expect(placeOf(doc, at)).toEqual({ kind: 'inside', place: at });
        expect(isInside(doc, at)).toBe(true);
    });

    it('beside an upper Level, is the spot on the nearest Level below that holds it', () => {
        const { doc, G } = building();
        expect(placeOf(doc, { levelId: 'gallery', point: [12, 10] })).toEqual({
            kind: 'inside',
            place: { levelId: 'mezzanine', point: [12, 10] },
        });
        expect(placeOf(doc, { levelId: 'gallery', point: [20, 10] })).toEqual({
            kind: 'inside',
            place: { levelId: G, point: [20, 10] },
        });
        expect(isInside(doc, { levelId: 'gallery', point: [12, 10] })).toBe(false);
    });

    it('outside the building, is reached by the ways out; with none, nowhere', () => {
        const { doc, G } = withEntrance(25);
        // Out of the door, 1 m past the 0.2 m Wall, then straight on: nothing is in the way.
        expect(placeOf(doc, { levelId: 'gallery', point: [10, -3] })).toEqual({
            kind: 'outside',
            exits: [
                {
                    levelId: G,
                    openingId: 'S-door',
                    point: [25, 0],
                    out: [25, -1.1],
                    way: [
                        [25, 0],
                        [25, -1.1],
                        [10, -3],
                    ],
                },
            ],
        });
        expect(placeOf(building().doc, { levelId: 'gallery', point: [10, -3] })).toEqual({
            kind: 'nowhere',
        });
    });
});

describe('exitsOf', () => {
    it('leaves out emergency exits and doors between rooms', () => {
        const { doc, G } = withEntrance(25, 'emergency-exit');
        const level = (id: string) => doc.levels.find((l) => l.id === id)!;
        expect(exitsOf(level(G))).toEqual([]);
        const inner = createEditor(doc);
        inner.exec({
            type: 'wall.add',
            levelId: G,
            id: 'I',
            a: [10, 0],
            b: [10, 20],
            thickness: 0.2,
        });
        inner.exec({
            type: 'opening.add',
            levelId: G,
            opening: {
                id: 'I-door',
                kind: 'door',
                width: 0.9,
                host: 'wall',
                wallId: 'I',
                offset: 10,
            },
        });
        expect(exitsOf(inner.getDocument().levels.find((l) => l.id === G)!)).toEqual([]);
    });
});

describe('wayOutside', () => {
    const hall = { outer: rect(0, 0, 30, 20) };
    const length = (way: [number, number][]) =>
        way.reduce(
            (s, p, i) => (i ? s + Math.hypot(p[0] - way[i - 1]![0], p[1] - way[i - 1]![1]) : 0),
            0,
        );

    it('goes round the building the shorter way, a metre off its corners, never through it', () => {
        // From the south door near the east end to a place north of the hall's west half.
        const way = wayOutside(hall, [25, -1], [10, 23])!;
        expect(way[0]).toEqual([25, -1]);
        expect(way.at(-1)).toEqual([10, 23]);
        // Round the east end: past the south-east corner and up the east side.
        expect(way).toContainEqual([30, -1]);
        expect(way).toContainEqual([31, 0]);
        expect(way).toContainEqual([31, 20]);
        for (let i = 1; i < way.length; i++)
            for (let k = 0; k <= 10; k++) {
                const [a, b] = [way[i - 1]!, way[i]!];
                const p: [number, number] = [
                    a[0] + ((b[0] - a[0]) * k) / 10,
                    a[1] + ((b[1] - a[1]) * k) / 10,
                ];
                expect(inShape(p, hall)).toBe(false);
            }
        expect(length(way)).toBeLessThan(
            length([
                [25, -1],
                [-1, 0],
                [-1, 20],
                [10, 23],
            ]),
        );
        expect(OUTSIDE_CLEARANCE).toBe(1);
    });

    it('is straight when nothing is in the way', () => {
        expect(wayOutside(hall, [25, -1], [10, -3])).toEqual([
            [25, -1],
            [10, -3],
        ]);
    });

    it('does not get from the street into a courtyard, nor out of it', () => {
        const ring = { outer: rect(0, 0, 30, 20), holes: [rect(10, 5, 10, 10)] };
        expect(wayOutside(ring, [25, -1], [15, 10])).toBeNull();
        expect(wayOutside(ring, [15, 6], [25, -1])).toBeNull();
        expect(wayOutside(ring, [15, 6], [18, 13])).toEqual([
            [15, 6],
            [18, 13],
        ]);
    });
});
