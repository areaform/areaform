import { createEditor, createSpace, type Command, type Ring, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { walkableArea } from './area.ts';
import { buildNavMesh, findRoute, locate, type NavMesh } from './index.ts';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/** A hall `w` × `h` m on one Level, changed by `commands` (each given the Level's id). */
function hall(w: number, h: number, ...commands: ((levelId: string) => Command)[]) {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [w, h] }));
    const levelId = editor.getDocument().levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(levelId));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    const doc = editor.getDocument();
    return { doc, levelId, mesh: buildNavMesh(doc, levelId) };
}

const wall =
    (id: string, a: Vec2, b: Vec2) =>
    (levelId: string): Command => ({
        type: 'wall.add',
        levelId,
        id,
        a,
        b,
        thickness: 0.2,
    });
const door =
    (wallId: string, offset: number, width = 0.9) =>
    (levelId: string): Command => ({
        type: 'opening.add',
        levelId,
        opening: { id: `${wallId}-door`, kind: 'door', width, host: 'wall', wallId, offset },
    });
const booth =
    (id: string, ring: Ring, walkAround = true) =>
    (levelId: string): Command => ({
        type: 'zone.add',
        levelId,
        zone: { id, shape: { outer: ring }, category: 'booth', ...(walkAround && { walkAround }) },
    });

const meshArea = (mesh: NavMesh) => {
    let area = 0;
    for (let t = 0; t < mesh.triangles.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => {
            const i = mesh.triangles[t + k]!;
            return [mesh.points[2 * i]!, mesh.points[2 * i + 1]!];
        }) as [Vec2, Vec2, Vec2];
        area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    return area;
};

/** Whether every leg of a route stays on the floor (checked at points along it). */
function onFloor(mesh: NavMesh, points: Vec2[]) {
    for (let i = 1; i < points.length; i++)
        for (const s of [0.25, 0.5, 0.75]) {
            const [a, b] = [points[i - 1]!, points[i]!];
            if (locate(mesh, [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]) === -1)
                return false;
        }
    return true;
}

describe('the walkable area', () => {
    it('is the floor kept 0.3 m from its edges', () => {
        const { mesh } = hall(10, 10);
        expect(meshArea(mesh)).toBeCloseTo(9.4 * 9.4, 6);
        expect(mesh.triangles.length / 3).toBe(2);
    });

    it('goes around Walk-around Zones, and through other Zones', () => {
        const { mesh } = hall(
            10,
            10,
            booth('B', rect(4, 4, 2, 2)),
            booth('Z', rect(1, 1, 1, 1), false),
        );
        expect(meshArea(mesh)).toBeCloseTo(9.4 * 9.4 - 2.6 * 2.6, 6);
    });

    it('goes around Obstacles and Connection Stops', () => {
        const { mesh } = hall(
            10,
            10,
            (levelId) => ({
                type: 'obstacle.add',
                levelId,
                obstacle: { id: 'C', kind: 'column', shape: { outer: rect(2, 2, 0.4, 0.4) } },
            }),
            () => ({ type: 'level.add', id: 'L2', name: 'Level 2' }),
            (levelId) => ({
                type: 'connection.add',
                connection: {
                    id: 'L',
                    kind: 'elevator',
                    bidirectional: true,
                    stops: [
                        { levelId, shape: { outer: rect(7, 7, 2, 2) } },
                        { levelId: 'L2', shape: { outer: rect(7, 7, 2, 2) } },
                    ],
                },
            }),
        );
        expect(meshArea(mesh)).toBeCloseTo(9.4 * 9.4 - 1 * 1 - 2.6 * 2.6, 6);
    });

    it('keeps a door narrower than twice the clearance passable', () => {
        const { mesh } = hall(10, 10, wall('W', [5, 0], [5, 10]), door('W', 5, 0.5));
        expect(new Set(mesh.components).size).toBe(1);
    });

    it('adds no floor outside the Outline at an entrance in an outer Wall', () => {
        const { doc, levelId } = hall(10, 10, wall('W', [0, 0], [10, 0]), door('W', 5, 2));
        const paths = walkableArea(
            doc,
            doc.levels.find((l) => l.id === levelId)!,
        );
        expect(Math.min(...paths.flat().map((p) => p.y))).toBeGreaterThanOrEqual(0);
    });
});

describe('findRoute', () => {
    it('is a straight line when nothing is in the way', () => {
        const { mesh } = hall(20, 10);
        const route = findRoute(mesh, [1, 1], [19, 9]);
        expect(route?.points).toEqual([
            [1, 1],
            [19, 9],
        ]);
        expect(route?.length).toBeCloseTo(Math.hypot(18, 8), 9);
    });

    it('goes through the door in a Wall, turning at its jambs', () => {
        // A Wall across the hall at x = 10 with a door 2 m from its bottom end.
        const { mesh } = hall(20, 10, wall('W', [10, 0], [10, 10]), door('W', 2));
        const route = findRoute(mesh, [5, 8], [15, 8])!;
        expect(route.points.length).toBeGreaterThan(2);
        const crossing = route.points.filter((p) => Math.abs(p[0] - 10) <= 0.5);
        expect(crossing.length).toBeGreaterThan(0);
        for (const p of crossing) {
            expect(p[1]).toBeGreaterThan(1.5);
            expect(p[1]).toBeLessThan(2.5);
        }
        // The shortest way: to the passage's corners (0.3 m clear of the Wall's 0.1 m half-thickness,
        // the 0.9 m door narrowed to 0.45 m) and across it.
        expect(route.length).toBeCloseTo(2 * Math.hypot(4.6, 8 - 2.225) + 0.8, 6);
        expect(onFloor(mesh, route.points)).toBe(true);
    });

    it('finds no route into a room with no way in', () => {
        const { mesh } = hall(20, 10, wall('W', [10, 0], [10, 10]));
        expect(findRoute(mesh, [5, 5], [15, 5])).toBeNull();
    });

    it('starts beside a Wall tapped on, and ends at the edge of a Walk-around Zone', () => {
        const { mesh } = hall(20, 10, wall('W', [10, 0], [10, 6]), booth('B', rect(14, 4, 3, 3)));
        const route = findRoute(mesh, [10, 3], [14.5, 5.5])!;
        expect(route.from[0]).not.toBe(10);
        expect(locate(mesh, route.from)).not.toBe(-1);
        // The booth's nearest side, 0.3 m out: its left side is at x = 14.
        expect(route.to).toEqual([13.7, 5.5]);
        expect(onFloor(mesh, route.points)).toBe(true);
    });

    it('walks around a row of booths rather than through it', () => {
        const row = Array.from({ length: 6 }, (_, i) => booth(`B${i}`, rect(4 + 2 * i, 3, 2, 4)));
        const { mesh } = hall(20, 10, ...row);
        const route = findRoute(mesh, [10, 1], [10, 9])!;
        expect(route.length).toBeGreaterThan(8);
        expect(onFloor(mesh, route.points)).toBe(true);
    });
});

describe('messy plans', () => {
    // Rotated booths at random, near-touching edges: the cases that broke other libraries.
    it('build a mesh and give routes that stay on the floor', () => {
        let seed = 7;
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let run = 0; run < 25; run++) {
            const commands = Array.from({ length: 40 }, (_, i) => {
                const [cx, cy, w, h, a] = [
                    3 + random() * 54,
                    3 + random() * 34,
                    1 + random() * 3,
                    1 + random() * 3,
                    random() * Math.PI,
                ];
                const ring = rect(-w / 2, -h / 2, w, h).map(([x, y]): Vec2 => [
                    cx + x * Math.cos(a) - y * Math.sin(a),
                    cy + x * Math.sin(a) + y * Math.cos(a),
                ]);
                return booth(`B${i}`, ring);
            });
            const { mesh } = hall(60, 40, ...commands);
            for (let k = 0; k < 10; k++) {
                const route = findRoute(
                    mesh,
                    [random() * 60, random() * 40],
                    [random() * 60, random() * 40],
                );
                if (route) expect(onFloor(mesh, route.points)).toBe(true);
            }
        }
    });
});
