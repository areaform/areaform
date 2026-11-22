// The navmesh: the walkable area triangulated, with each triangle's neighbours across open edges.
import Constrainautor from '@kninnug/constrainautor';
import type { Paths64 } from '@countertype/clipper2-ts';
import Delaunator from 'delaunator';
import { MM } from './area.ts';

export interface NavMesh {
    /** Vertex coordinates in metres: x, y, x, y, … */
    points: Float64Array;
    /** Three vertex indices per triangle, counter-clockwise. */
    triangles: Uint32Array;
    /**
     * Per triangle, the neighbour across each edge (edge `i` runs from vertex `i` to `i + 1`), or
     * -1 where the edge is the boundary of the walkable area.
     */
    neighbours: Int32Array;
    /** Per triangle, the connected piece of floor it belongs to: no route joins two pieces. */
    components: Uint32Array;
}

/** A planar straight-line graph: integer points (mm) and undirected edges between them. */
interface Graph {
    points: [number, number][];
    edges: [number, number][];
}

/**
 * The rings as one graph with every edge split where a point lies on it. After the shrink two rings
 * can touch along a line (the floor narrows to nothing there); a triangulator refuses such input
 * until the edges meet at shared points. Exact: the coordinates are integers.
 */
export function cleanGraph(paths: Paths64): Graph {
    const points: [number, number][] = [];
    const index = new Map<string, number>();
    const raw: [number, number][] = [];
    for (const path of paths) {
        const ids: number[] = [];
        for (const { x, y } of path) {
            const key = `${x},${y}`;
            let id = index.get(key);
            if (id === undefined) {
                id = points.length;
                index.set(key, id);
                points.push([x, y]);
            }
            if (ids.at(-1) !== id) ids.push(id);
        }
        if (ids.length > 1 && ids[0] === ids.at(-1)) ids.pop();
        if (ids.length < 3) continue;
        ids.forEach((id, i) => raw.push([id, ids[(i + 1) % ids.length]!]));
    }

    // Points sorted by x, so each edge only checks the points within its x-range.
    const byX = points.map((_, i) => i).sort((i, j) => points[i]![0] - points[j]![0]);
    const firstAtOrAfter = (x: number) => {
        let lo = 0;
        let hi = byX.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (points[byX[mid]!]![0] < x) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };

    const edges = new Map<string, [number, number]>();
    const add = (u: number, v: number) => {
        if (u !== v) edges.set(u < v ? `${u}:${v}` : `${v}:${u}`, [u, v]);
    };
    for (const [a, b] of raw) {
        const [ax, ay] = points[a]!;
        const [bx, by] = points[b]!;
        const on: number[] = [];
        for (let k = firstAtOrAfter(Math.min(ax, bx)); k < byX.length; k++) {
            const i = byX[k]!;
            const [px, py] = points[i]!;
            if (px > Math.max(ax, bx)) break;
            if (i === a || i === b) continue;
            if (py < Math.min(ay, by) || py > Math.max(ay, by)) continue;
            if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) === 0) on.push(i);
        }
        const along = (i: number) =>
            (points[i]![0] - ax) * (bx - ax) + (points[i]![1] - ay) * (by - ay);
        on.sort((i, j) => along(i) - along(j));
        const chain = [a, ...on, b];
        for (let i = 0; i + 1 < chain.length; i++) add(chain[i]!, chain[i + 1]!);
    }
    return { points, edges: [...edges.values()] };
}

const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Triangulates the walkable area (mm paths) into a navmesh in metres. */
export function triangulate(paths: Paths64): NavMesh {
    const { points, edges } = cleanGraph(paths);
    const empty: NavMesh = {
        points: new Float64Array(),
        triangles: new Uint32Array(),
        neighbours: new Int32Array(),
        components: new Uint32Array(),
    };
    if (points.length < 3) return empty;

    const del = Delaunator.from(points);
    const con = new Constrainautor(del);
    con.constrainAll(edges);
    const { triangles, halfedges } = del;
    const count = triangles.length / 3;

    // Inside or outside, by flooding from the hull: crossing a constrained edge flips the side.
    const inside = new Int8Array(count).fill(-1);
    const queue: number[] = [];
    for (let e = 0; e < halfedges.length; e++) {
        if (halfedges[e] !== -1) continue;
        const t = Math.floor(e / 3);
        if (inside[t] !== -1) continue;
        inside[t] = con.isConstrained(e) ? 1 : 0;
        queue.push(t);
    }
    while (queue.length > 0) {
        const t = queue.pop()!;
        for (let k = 0; k < 3; k++) {
            const e = 3 * t + k;
            const o = halfedges[e]!;
            if (o === -1) continue;
            const u = Math.floor(o / 3);
            if (inside[u] !== -1) continue;
            inside[u] = con.isConstrained(e) ? 1 - inside[t]! : inside[t]!;
            queue.push(u);
        }
    }

    // Keep the inside triangles, counter-clockwise, renumbered.
    const kept: number[] = [];
    const newIndex = new Int32Array(count).fill(-1);
    for (let t = 0; t < count; t++) {
        if (inside[t] !== 1) continue;
        // A sliver of zero area (collinear points) carries no floor.
        const [a, b, c] = [triangles[3 * t]!, triangles[3 * t + 1]!, triangles[3 * t + 2]!];
        if (cross(points[a]!, points[b]!, points[c]!) === 0) continue;
        newIndex[t] = kept.length;
        kept.push(t);
    }
    if (kept.length === 0) return empty;

    const out = new Uint32Array(kept.length * 3);
    const neighbours = new Int32Array(kept.length * 3).fill(-1);
    kept.forEach((t, n) => {
        const ids = [triangles[3 * t]!, triangles[3 * t + 1]!, triangles[3 * t + 2]!];
        // Delaunator's triangles turn clockwise in a y-up plan; ours turn counter-clockwise.
        const ccw = cross(points[ids[0]!]!, points[ids[1]!]!, points[ids[2]!]!) > 0;
        const order = ccw ? [0, 1, 2] : [0, 2, 1];
        for (let i = 0; i < 3; i++) out[3 * n + i] = ids[order[i]!]!;
        for (let i = 0; i < 3; i++) {
            // Our edge i runs from order[i] to order[i + 1]; find Delaunator's halfedge for it.
            const from = ids[order[i]!]!;
            const to = ids[order[(i + 1) % 3]!]!;
            for (let k = 0; k < 3; k++) {
                const e = 3 * t + k;
                const s = triangles[e]!;
                const d = triangles[3 * t + ((k + 1) % 3)]!;
                if (!((s === from && d === to) || (s === to && d === from))) continue;
                const o = halfedges[e]!;
                if (o !== -1 && !con.isConstrained(e))
                    neighbours[3 * n + i] = newIndex[Math.floor(o / 3)]!;
            }
        }
    });

    // Points used by kept triangles, renumbered, in metres.
    const used = new Int32Array(points.length).fill(-1);
    const coords: number[] = [];
    for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (used[p] === -1) {
            used[p] = coords.length / 2;
            coords.push(points[p]![0] / MM, points[p]![1] / MM);
        }
        out[i] = used[p]!;
    }

    // Connected pieces of floor.
    const components = new Uint32Array(kept.length).fill(0xffffffff);
    let next = 0;
    for (let start = 0; start < kept.length; start++) {
        if (components[start] !== 0xffffffff) continue;
        components[start] = next;
        const stack = [start];
        while (stack.length > 0) {
            const t = stack.pop()!;
            for (let i = 0; i < 3; i++) {
                const u = neighbours[3 * t + i]!;
                if (u !== -1 && components[u] === 0xffffffff) {
                    components[u] = next;
                    stack.push(u);
                }
            }
        }
        next++;
    }

    return { points: new Float64Array(coords), triangles: out, neighbours, components };
}
