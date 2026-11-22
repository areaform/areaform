import { createEditor, createSpace, type AreaformDocument, type Command } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createPicker, rayPrism, type PickOptions, type Ray, type WallCut } from './picking.ts';
import { defaultTheme3D } from './theme3d.ts';
import type { Vec3 } from './view.ts';

const options: PickOptions = { theme3d: defaultTheme3D, doorHeight: 2.1 };

/** A 20 × 10 office (3 m ceilings) with these Commands applied; `G` is its Level id. */
function office(...commands: ((G: string) => Command)[]): AreaformDocument {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const G = doc.levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(G));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return editor.getDocument();
}

const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/** Plan [x, y] at height h, in world space. */
const world = ([x, y]: [number, number], h: number): Vec3 => [x, h, -y];

/** A ray from `from` through `to`, both plan points at a height. */
const ray = (
    from: [number, number],
    fromHeight: number,
    to: [number, number],
    toHeight: number,
): Ray => {
    const a = world(from, fromHeight);
    const b = world(to, toHeight);
    return { origin: a, direction: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] };
};

/** Straight down onto a plan point. */
const down = (at: [number, number]): Ray => ray(at, 20, at, 0);

const at = (doc: AreaformDocument, r: Ray, cut?: WallCut) =>
    createPicker(doc, doc.levels[0]!, options)(r, cut);

// A Zone in the middle of the room, and a Wall across the room in front of it (y = 2) with a
// door at x = 5.
const room = () =>
    office(
        (G) => ({
            type: 'zone.add',
            levelId: G,
            zone: { id: 'Z', shape: { outer: rect(2, 4, 6, 2) } },
        }),
        (G) => ({ type: 'wall.add', levelId: G, id: 'W', a: [0, 2], b: [10, 2], thickness: 0.2 }),
        (G) => ({
            type: 'opening.add',
            levelId: G,
            opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 5 },
        }),
    );

describe('pick', () => {
    it('finds the Zone under the pointer, and where on the plan it was hit', () => {
        const doc = room();
        const hit = at(doc, down([3, 5]));

        expect(hit.ref).toEqual({ kind: 'zone', id: 'Z', levelId: doc.levels[0]!.id });
        expect(hit.point![0]).toBeCloseTo(3);
        expect(hit.point![1]).toBeCloseTo(5);
    });

    it('gives the bare floor, and the ground outside, as no Element with a point', () => {
        const doc = room();

        expect(at(doc, down([15, 8]))).toMatchObject({ ref: null, point: [15, 8] });
        expect(at(doc, down([30, 30])).ref).toBeNull();
    });

    it('gives nothing at all for a ray into the sky', () => {
        expect(at(room(), ray([5, -10], 2, [5, 0], 3))).toEqual({
            ref: null,
            point: null,
            distance: Infinity,
        });
    });

    it('stops at a Wall standing in front of the Zone, on its face', () => {
        const doc = room();
        // From the south at eye height, towards the Zone; the Wall at y = 2 is in the way.
        const hit = at(doc, ray([3, -10], 1.6, [3, 5], 0));

        expect(hit.ref).toMatchObject({ kind: 'wall', id: 'W' });
        expect(hit.point![1]).toBeCloseTo(1.9);
    });

    it('tells how far along the ray it hit: short of the point aimed at when a Wall hides it', () => {
        const doc = room();

        // From the south toward [3, 5]: the Wall's face at y = 1.9 is 11.9 of the 15 m.
        expect(at(doc, ray([3, -10], 1.6, [3, 5], 0)).distance).toBeCloseTo(11.9 / 15);
        // Straight down, nothing stands in the way: the floor is reached at the point.
        expect(at(doc, down([3, 5])).distance).toBeCloseTo(1);
    });

    it('sees through a door, below its lintel', () => {
        const doc = room();

        expect(at(doc, ray([5, -10], 1, [5, 5], 0)).ref).toMatchObject({ id: 'Z' });
        // Higher up, the lintel is in the way.
        expect(at(doc, ray([5, -10], 2.5, [5, 6], 2.5)).ref).toMatchObject({ kind: 'wall' });
    });

    it('sees over a lowered Wall, which is still there as a kerb', () => {
        const doc = room();
        const lowered = () => 1;

        expect(at(doc, ray([3, -10], 1.6, [3, 5], 0), lowered).ref).toMatchObject({ id: 'Z' });
        // Looking at its foot, the kerb is what the pointer is on.
        expect(at(doc, ray([3, -10], 1, [3, 2], 0.1), lowered).ref).toMatchObject({ id: 'W' });
    });

    it('lowers each Wall by how much its own anchor is cut', () => {
        const doc = room();
        const seen: [number, number][] = [];
        at(doc, down([3, 5]), (anchor) => (seen.push(anchor), 0));

        // Both pieces beside the door belong to one Wall and share its middle.
        expect(seen).toEqual([
            [5, 2],
            [5, 2],
            [5, 2],
        ]);
    });

    it('finds Obstacles and Stops by their tops, before the floor beneath', () => {
        const doc = office(
            (G) => ({
                type: 'obstacle.add',
                levelId: G,
                obstacle: { id: 'C', kind: 'column', shape: { outer: rect(4, 4, 1, 1) } },
            }),
            () => ({ type: 'level.add', id: 'L2', name: 'Level 2' }),
            (G) => ({
                type: 'connection.add',
                connection: {
                    id: 'S',
                    kind: 'stairs',
                    bidirectional: true,
                    stops: [
                        { levelId: G, shape: { outer: rect(10, 4, 2, 2) } },
                        { levelId: 'L2', shape: { outer: rect(10, 4, 2, 2) } },
                    ],
                },
            }),
        );
        const level = doc.levels[0]!;
        const column = at(doc, down([4.5, 4.5]));
        const stairs = at(doc, down([11, 5]));

        expect(column.ref).toEqual({ kind: 'obstacle', id: 'C', levelId: level.id });
        expect(stairs.ref).toEqual({ kind: 'stop', id: 'S', levelId: level.id });
    });

    it('finds an Opening by its strip across the floor, unless a lintel is above it', () => {
        const doc = office(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 2],
                b: [10, 2],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: {
                    id: 'E',
                    kind: 'entrance',
                    width: 2,
                    host: 'wall',
                    wallId: 'W',
                    offset: 3,
                },
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 7 },
            }),
        );

        expect(at(doc, down([3, 2])).ref).toMatchObject({ kind: 'opening', id: 'E' });
        expect(at(doc, down([7, 2])).ref).toMatchObject({ kind: 'wall', id: 'W' });
    });
});

describe('rayPrism', () => {
    const square = { outer: rect(0, 0, 2, 2) };

    it('meets the top from above and a side from the side', () => {
        expect(rayPrism(down([1, 1]), square, 0, 3)).toBeCloseTo(17 / 20);
        expect(rayPrism(ray([1, -4], 1, [1, 1], 1), square, 0, 3)).toBeCloseTo(4 / 5);
    });

    it('meets the underside of a lintel from below', () => {
        expect(rayPrism(ray([1, 1], 1, [1, 1.0001], 2), square, 2, 3)).toBeCloseTo(1);
    });

    it('misses beside, above and below it', () => {
        expect(rayPrism(down([5, 5]), square, 0, 3)).toBe(Infinity);
        expect(rayPrism(ray([1, -4], 4, [1, 1], 4), square, 0, 3)).toBe(Infinity);
        expect(rayPrism(ray([1, -4], 1, [1, 1], 1), square, 2, 3)).toBe(Infinity);
    });
});
