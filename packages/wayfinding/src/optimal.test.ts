// Routes against the true shortest path: in a polygon with holes, the shortest path turns only at
// the polygon's corners, so Dijkstra over the corners that see each other finds it exactly.
import { createEditor, createSpace, type Command, type Ring, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { buildNavMesh, findRoute, locate, type NavMesh } from './index.ts';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function hall(w: number, h: number, booths: Ring[]) {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [w, h] }));
    const levelId = editor.getDocument().levels[0]!.id;
    booths.forEach((ring, i) => {
        const command: Command = {
            type: 'zone.add',
            levelId,
            zone: { id: `B${i}`, shape: { outer: ring }, walkAround: true },
        };
        editor.exec(command);
    });
    return buildNavMesh(editor.getDocument(), levelId);
}

/** The exact shortest path length between two points on the floor, or Infinity. */
function shortest(mesh: NavMesh, from: Vec2, to: Vec2): number {
    const vertex = (i: number): Vec2 => [mesh.points[2 * i]!, mesh.points[2 * i + 1]!];
    const edges: [Vec2, Vec2][] = [];
    const corners = new Map<string, Vec2>();
    for (let t = 0; t < mesh.triangles.length / 3; t++)
        for (let k = 0; k < 3; k++) {
            if (mesh.neighbours[3 * t + k] !== -1) continue;
            const a = vertex(mesh.triangles[3 * t + k]!);
            const b = vertex(mesh.triangles[3 * t + ((k + 1) % 3)]!);
            edges.push([a, b]);
            corners.set(`${a}`, a);
        }
    const eps = 1e-9;
    const sees = (a: Vec2, b: Vec2) => {
        for (const [c, d] of edges) {
            const d1 = cross(c, d, a);
            const d2 = cross(c, d, b);
            const d3 = cross(a, b, c);
            const d4 = cross(a, b, d);
            if (
                ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
                ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
            )
                return false;
        }
        // Grazing a corner into an obstacle crosses no edge: check the segment stays on the floor.
        for (const s of [0.25, 0.5, 0.75])
            if (locate(mesh, [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]) === -1)
                return false;
        return true;
    };
    const nodes = [from, ...corners.values(), to];
    const best = nodes.map(() => Infinity);
    const done = nodes.map(() => false);
    best[0] = 0;
    for (;;) {
        let i = -1;
        for (let k = 0; k < nodes.length; k++)
            if (!done[k] && (i === -1 || best[k]! < best[i]!)) i = k;
        if (i === -1 || best[i] === Infinity) return Infinity;
        if (i === nodes.length - 1) return best[i]!;
        done[i] = true;
        for (let k = 0; k < nodes.length; k++) {
            if (done[k]) continue;
            const d = best[i]! + dist(nodes[i]!, nodes[k]!);
            if (d < best[k]! && sees(nodes[i]!, nodes[k]!)) best[k] = d;
        }
    }
}

describe('routes are the shortest way (checked against a visibility graph)', () => {
    it('round a block, the near side (a lift by a corner of the hall)', () => {
        const mesh = hall(30, 20, [rect(26, 16, 2, 2)]);
        const route = findRoute(mesh, [29, 19], [25.7, 17])!;
        expect(route.length).toBeCloseTo(shortest(mesh, [29, 19], [25.7, 17]), 2);
    });

    it('among booths placed at random, within 1% of the shortest (none found shorter)', () => {
        let seed = 11;
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const ratios: number[] = [];
        for (let run = 0; run < 20; run++) {
            const booths = Array.from({ length: 14 }, () =>
                rect(2 + random() * 24, 2 + random() * 14, 1 + random() * 3, 1 + random() * 3),
            );
            const mesh = hall(30, 20, booths);
            for (let k = 0; k < 8; k++) {
                const route = findRoute(
                    mesh,
                    [random() * 30, random() * 20],
                    [random() * 30, random() * 20],
                );
                if (!route || route.length < 1) continue;
                const best = shortest(mesh, route.from, route.to);
                ratios.push(route.length / best);
            }
        }
        // Before Polyanya, 31 of these were over, the worst by 47%.
        expect(ratios.length).toBeGreaterThan(100);
        expect(ratios.filter((r) => r > 1.01)).toEqual([]);
    });
});
