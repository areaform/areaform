import {
    createEditor,
    createSpace,
    type Command,
    type AreaformDocument,
    type Opening,
} from '@areaform/core';
import { defaultTheme } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import {
    buildLevelMeshes,
    SLAB_DEPTH,
    wallRuns,
    ZONE_LIFT,
    type MeshData,
    type MeshOptions,
} from './meshes.ts';
import { defaultTheme3D } from './theme3d.ts';

/** Colours by name, so tests can tell which triangles are which. */
const PALETTE: Record<string, [number, number, number]> = {
    floor: [0.1, 0, 0],
    slab: [0.2, 0, 0],
    wall: [0.3, 0, 0],
    top: [0.4, 0, 0],
    booth: [0.5, 0, 0],
    zone: [0.6, 0, 0],
    obstacle: [0.7, 0, 0],
    stairs: [0.8, 0, 0],
    elevator: [0.9, 0, 0],
    opening: [0, 0.1, 0],
    exit: [0, 0.2, 0],
};
const byValue = new Map(Object.entries(PALETTE).map(([name, rgb]) => [rgb.join(), name]));

const options: MeshOptions = {
    theme: {
        ...defaultTheme,
        outline: { fill: 'floor' },
        zone: { fill: 'zone' },
        categories: { booth: { fill: 'booth' } },
        obstacle: { fill: 'obstacle' },
        wall: { fill: 'top' },
        opening: { stroke: 'opening' },
        emergencyExit: { stroke: 'exit' },
    },
    theme3d: {
        ...defaultTheme3D,
        slab: 'slab',
        wall: 'wall',
        connections: {
            ...defaultTheme3D.connections,
            stairs: { color: 'stairs', height: 0.4 },
            elevator: { color: 'elevator' },
        },
    },
    doorHeight: 2.1,
    color: (css) => PALETTE[css] ?? [1, 1, 1],
};

/** A 20 × 10 office Space with these Commands applied; `G` is its Level id. */
function office(...commands: ((G: string) => Command)[]) {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const G = doc.levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(G));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return editor.getDocument();
}

const meshes = (doc: AreaformDocument) => buildLevelMeshes(doc, doc.levels[0]!, options);

type Point = [number, number, number];

interface Triangle {
    color: string;
    alpha: number;
    points: [Point, Point, Point];
    normal: [number, number, number];
}

function triangles(data: MeshData): Triangle[] {
    const out: Triangle[] = [];
    for (let v = 0; v < data.positions.length / 3; v += 3) {
        const point = (i: number): [number, number, number] => [
            data.positions[3 * i]!,
            data.positions[3 * i + 1]!,
            data.positions[3 * i + 2]!,
        ];
        const rgb = [0, 1, 2].map((k) => Number(data.colors[4 * v + k]!.toFixed(2))).join();
        out.push({
            color: byValue.get(rgb) ?? rgb,
            alpha: data.colors[4 * v + 3]!,
            points: [point(v), point(v + 1), point(v + 2)],
            normal: [data.normals[3 * v]!, data.normals[3 * v + 1]!, data.normals[3 * v + 2]!],
        });
    }
    return out;
}

const of = (data: MeshData, color: string) => triangles(data).filter((t) => t.color === color);

/** The area covered by triangles facing up, metres². */
const upArea = (ts: Triangle[]) =>
    ts
        .filter((t) => t.normal[1] > 0.5)
        .reduce((sum, { points: [a, b, c] }) => {
            const cross = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
            return sum + Math.abs(cross) / 2;
        }, 0);

const heights = (ts: Triangle[]) =>
    [...new Set(ts.flatMap((t) => t.points.map((p) => p[1])))].sort((x, y) => x - y);

/** Every triangle winds counter-clockwise around its normal, so it is a front face. */
function expectFrontFacing(ts: Triangle[]) {
    for (const {
        points: [a, b, c],
        normal,
    } of ts) {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cross = [
            u[1]! * w[2]! - u[2]! * w[1]!,
            u[2]! * w[0]! - u[0]! * w[2]!,
            u[0]! * w[1]! - u[1]! * w[0]!,
        ];
        expect(
            cross[0]! * normal[0] + cross[1]! * normal[1] + cross[2]! * normal[2],
        ).toBeGreaterThan(0);
    }
}

describe('buildLevelMeshes', () => {
    it('lays a floor slab under the Outline, its top at y = 0', () => {
        const { opaque } = meshes(office());

        expect(upArea(of(opaque, 'floor'))).toBeCloseTo(200);
        expect(heights(of(opaque, 'floor'))).toEqual([0]);
        expect(heights(of(opaque, 'slab'))).toEqual([-SLAB_DEPTH, 0].map(Math.fround));
    });

    it('maps the plan to the world with north away from the viewer: plan y is world −z', () => {
        const { bounds } = meshes(office());

        expect(bounds.min[0]).toBeCloseTo(0);
        expect(bounds.max[0]).toBeCloseTo(20);
        expect(bounds.min[2]).toBeCloseTo(-10);
        expect(bounds.max[2]).toBeCloseTo(0);
    });

    it('turns every face outward', () => {
        const { opaque, walls } = meshes(
            office(
                (G) => ({ type: 'wall.add', levelId: G, a: [2, 2], b: [8, 2], thickness: 0.2 }),
                (G) => ({
                    type: 'obstacle.add',
                    levelId: G,
                    obstacle: { id: 'C', kind: 'column', shape: { outer: rect(4, 4, 1, 1) } },
                }),
            ),
        );

        expectFrontFacing([...triangles(opaque), ...triangles(walls)]);
    });

    it('leaves the Outline holes and voids open in the floor', () => {
        const doc = office((G) => ({
            type: 'obstacle.add',
            levelId: G,
            obstacle: { id: 'V', kind: 'void', shape: { outer: rect(2, 2, 4, 2) } },
        }));

        expect(upArea(of(meshes(doc).opaque, 'floor'))).toBeCloseTo(200 - 8);
        expect(of(meshes(doc).opaque, 'obstacle')).toEqual([]);
    });

    it('leaves Zones to the Zone layer, but frames them', () => {
        const doc = office((G) => ({
            type: 'zone.add',
            levelId: G,
            zone: { id: 'B', shape: { outer: rect(1, 1, 3, 3) }, category: 'booth' },
        }));
        const { opaque, bounds } = meshes(doc);

        expect(of(opaque, 'booth')).toEqual([]);
        expect(bounds.max[1]).toBeCloseTo(ZONE_LIFT);
    });

    it('raises Walls to their own height or the Level height, with tops in the plan colour', () => {
        const doc = office(
            (G) => ({ type: 'wall.add', levelId: G, a: [2, 2], b: [8, 2], thickness: 0.2 }),
            (G) => ({
                type: 'wall.add',
                levelId: G,
                a: [2, 6],
                b: [8, 6],
                thickness: 0.2,
                height: 1.2,
            }),
        );
        const { walls } = meshes(doc);
        const level = doc.levels[0]!;

        expect(heights(of(walls, 'top'))).toEqual([1.2, level.height].map(Math.fround));
        expect(upArea(of(walls, 'top'))).toBeCloseTo(2 * 6 * 0.2);
        expect(heights(of(walls, 'wall'))).toEqual([0, 1.2, level.height].map(Math.fround));
    });

    it('cuts a door out of its Wall up to the door height, with a lintel above it', () => {
        const doc = office(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 5],
                b: [10, 5],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: door('D', 'W', 5, 1, 'door'),
            }),
        );
        const level = doc.levels[0]!;
        const walls = triangles(meshes(doc).walls);
        const xs = (t: Triangle) => t.points.map((p) => p[0]);
        const inGap = walls.filter((t) => xs(t).every((x) => x >= 4.5 - 1e-6 && x <= 5.5 + 1e-6));

        // Nothing in the gap reaches below the door height except the jambs, which are at its edges.
        for (const t of inGap) {
            if (t.points.some((p) => p[1] < 2.1 - 1e-6))
                expect(
                    xs(t).every((x) => Math.abs(x - 4.5) < 1e-6 || Math.abs(x - 5.5) < 1e-6),
                ).toBe(true);
        }
        // The lintel has a top and an underside.
        expect(upArea(inGap)).toBeCloseTo(0.2);
        expect(inGap.some((t) => t.normal[1] < -0.5 && t.points[0]![1] === Math.fround(2.1))).toBe(
            true,
        );
        expect(upArea(walls)).toBeCloseTo(10 * 0.2);
        expect(heights(walls).at(-1)).toBe(Math.fround(level.height));
    });

    it('opens an entrance to the full height of its Wall', () => {
        const doc = office(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 5],
                b: [10, 5],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: door('E', 'W', 5, 2, 'entrance'),
            }),
        );

        expect(upArea(of(meshes(doc).walls, 'top'))).toBeCloseTo(8 * 0.2);
    });

    it('anchors every vertex of a Wall at its middle, so the view can lower it as a whole', () => {
        const doc = office(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'S',
                a: [2, 2],
                b: [8, 2],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'N',
                a: [2, 8],
                b: [6, 8],
                thickness: 0.2,
            }),
            (G) => ({ type: 'opening.add', levelId: G, opening: door('D', 'S', 3, 1, 'door') }),
        );
        const { walls, opaque } = meshes(doc);

        expect(walls.anchors).toHaveLength((walls.positions.length / 3) * 2);
        const anchors = new Set<string>();
        for (let v = 0; v < walls.anchors.length / 2; v++)
            anchors.add(`${walls.anchors[2 * v]},${walls.anchors[2 * v + 1]}`);
        // World x, z: plan y is world −z. The door splits S, but its pieces share one anchor.
        expect(anchors).toEqual(new Set(['5,-2', '4,-8']));
        expect(opaque.anchors).toBeUndefined();
    });

    it('marks each Opening with a strip on the floor, emergency exits in their own colour', () => {
        const doc = office(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 5],
                b: [10, 5],
                thickness: 0.2,
            }),
            (G) => ({ type: 'opening.add', levelId: G, opening: door('D', 'W', 3, 1, 'door') }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: {
                    id: 'X',
                    kind: 'emergency-exit',
                    width: 1.5,
                    host: 'free',
                    position: [20, 3],
                    angle: Math.PI / 2,
                },
            }),
        );
        const { opaque, marks } = meshes(doc);

        expect(upArea(of(marks, 'opening'))).toBeCloseTo(1 * 0.2);
        expect(upArea(of(marks, 'exit'))).toBeCloseTo(1.5 * defaultTheme.freeOpeningDepth);
        // Apart from the floor, so they can be drawn in front of it at any distance.
        expect(of(opaque, 'opening')).toEqual([]);
    });

    it('stands Obstacles to the Level height and Stops to their Connection kind’s height', () => {
        const doc = office(
            (G) => ({
                type: 'obstacle.add',
                levelId: G,
                obstacle: { id: 'C', kind: 'column', shape: { outer: rect(4, 4, 1, 1) } },
            }),
            () => ({ type: 'level.add', id: 'UP', name: 'Level 2' }),
            (G) => ({
                type: 'connection.add',
                connection: {
                    id: 'S',
                    kind: 'stairs',
                    stops: [G, 'UP'].map((levelId) => ({
                        levelId,
                        shape: { outer: rect(10, 2, 2, 4) },
                    })),
                    bidirectional: true,
                },
            }),
            (G) => ({
                type: 'connection.add',
                connection: {
                    id: 'L',
                    kind: 'elevator',
                    stops: [G, 'UP'].map((levelId) => ({
                        levelId,
                        shape: { outer: rect(14, 2, 2, 2) },
                    })),
                    bidirectional: true,
                },
            }),
        );
        const { opaque } = meshes(doc);
        const height = Math.fround(doc.levels[0]!.height);

        expect(heights(of(opaque, 'obstacle'))).toEqual([0, height]);
        expect(heights(of(opaque, 'stairs'))).toEqual([0, Math.fround(0.4)]);
        expect(heights(of(opaque, 'elevator'))).toEqual([0, height]);
    });
});

describe('wallRuns', () => {
    it('is one solid run for a Wall without Openings', () => {
        expect(wallRuns([])).toEqual([{ from: -Infinity, to: Infinity, gap: 'none' }]);
    });

    it('splits at each Opening, the more open one winning where they overlap', () => {
        expect(wallRuns([door('D', 'W', 2, 1, 'door'), door('E', 'W', 3, 2, 'entrance')])).toEqual([
            { from: -Infinity, to: 1.5, gap: 'none' },
            { from: 1.5, to: 2, gap: 'door' },
            { from: 2, to: 4, gap: 'full' },
            { from: 4, to: Infinity, gap: 'none' },
        ]);
    });
});

function door(id: string, wallId: string, offset: number, width: number, kind: Opening['kind']) {
    return { id, kind, width, host: 'wall', wallId, offset } as const;
}

function rect(x: number, y: number, w: number, h: number): [number, number][] {
    return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
    ];
}
