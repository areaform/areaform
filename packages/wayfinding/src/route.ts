// Route search on a navmesh: a quick corridor route, then the exact shortest path by Polyanya.
import type { Vec2 } from '@areaform/core';
import type { NavMesh } from './mesh.ts';

export interface Route {
    /** From the start to the end, through the corners it turns at. */
    points: Vec2[];
    /** Metres along `points`. */
    length: number;
}

/** A point on the walkable floor and the triangle it lies in. */
export interface Placed {
    point: Vec2;
    triangle: number;
}

const vertex = (mesh: NavMesh, i: number): Vec2 => [mesh.points[2 * i]!, mesh.points[2 * i + 1]!];
const corner = (mesh: NavMesh, t: number, k: number) => vertex(mesh, mesh.triangles[3 * t + k]!);
const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** The triangle a point lies in (edges included), or -1. */
export function locate(mesh: NavMesh, p: Vec2): number {
    const count = mesh.triangles.length / 3;
    for (let t = 0; t < count; t++) {
        const a = corner(mesh, t, 0);
        const b = corner(mesh, t, 1);
        const c = corner(mesh, t, 2);
        if (cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12)
            return t;
    }
    return -1;
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const s =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return [a[0] + s * dx, a[1] + s * dy];
}

/**
 * The point itself if it is on the floor, else the nearest point on the floor: a tap on a Wall,
 * an Obstacle or a Walk-around Zone lands beside it. With `component`, only that piece of floor
 * counts, so a destination snaps to the side of a Wall the route can reach. Null on an empty mesh.
 */
export function snap(mesh: NavMesh, p: Vec2, component?: number): Placed | null {
    const t = locate(mesh, p);
    if (t !== -1 && (component === undefined || mesh.components[t] === component))
        return { point: p, triangle: t };
    let best: Placed | null = null;
    let bestDistance = Infinity;
    const count = mesh.triangles.length / 3;
    for (let u = 0; u < count; u++) {
        if (component !== undefined && mesh.components[u] !== component) continue;
        for (let k = 0; k < 3; k++) {
            if (mesh.neighbours[3 * u + k] !== -1) continue;
            const q = closestOnSegment(p, corner(mesh, u, k), corner(mesh, u, (k + 1) % 3));
            const d = dist(p, q);
            if (d < bestDistance) {
                bestDistance = d;
                best = { point: q, triangle: u };
            }
        }
    }
    return best;
}

// --- A quick route: a corridor of triangles, pulled tight ------------------------------------------

/**
 * Where a path from `p` heading for `goal` crosses the edge `a`–`b`: where the straight line
 * crosses it, else the end of the edge that makes the way through it shortest.
 */
function crossing(p: Vec2, goal: Vec2, a: Vec2, b: Vec2): Vec2 {
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
    const [dx, dy] = [goal[0] - p[0], goal[1] - p[1]];
    const denominator = dx * ey - dy * ex;
    if (denominator !== 0) {
        const s = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / denominator;
        if (s >= 0 && s <= 1) return [a[0] + s * ex, a[1] + s * ey];
    }
    return dist(p, a) + dist(a, goal) <= dist(p, b) + dist(b, goal) ? a : b;
}

/**
 * The triangles from `from` to `to` by A*, crossing each edge where a path heading for the goal
 * would; null if they are not joined. Fast, but it can pick the wrong side of an obstacle.
 */
function corridor(mesh: NavMesh, from: Placed, to: Placed): number[] | null {
    if (mesh.components[from.triangle] !== mesh.components[to.triangle]) return null;
    const count = mesh.triangles.length / 3;
    const cost = new Float64Array(count).fill(Infinity);
    const at: (Vec2 | undefined)[] = new Array(count);
    const came = new Int32Array(count).fill(-1);
    const done = new Uint8Array(count);
    const open = heap<{ f: number; t: number }>();

    cost[from.triangle] = 0;
    at[from.triangle] = from.point;
    open.push({ f: dist(from.point, to.point), t: from.triangle });
    while (open.size > 0) {
        const { t } = open.pop();
        if (done[t]) continue;
        done[t] = 1;
        if (t === to.triangle) break;
        const here = at[t]!;
        for (let k = 0; k < 3; k++) {
            const u = mesh.neighbours[3 * t + k]!;
            if (u === -1 || done[u]) continue;
            const a = corner(mesh, t, k);
            const b = corner(mesh, t, (k + 1) % 3);
            const mid: Vec2 = u === to.triangle ? to.point : crossing(here, to.point, a, b);
            const g = cost[t]! + dist(here, mid);
            if (g >= cost[u]!) continue;
            cost[u] = g;
            at[u] = mid;
            came[u] = t;
            open.push({ f: g + dist(mid, to.point), t: u });
        }
    }
    if (!done[to.triangle]) return null;
    const path = [to.triangle];
    while (path.at(-1) !== from.triangle) path.push(came[path.at(-1)!]!);
    return path.reverse();
}

/** The edge two neighbouring triangles share, as [left, right] seen walking from `t` into `u`. */
function portal(mesh: NavMesh, t: number, u: number): [Vec2, Vec2] {
    for (let k = 0; k < 3; k++)
        if (mesh.neighbours[3 * t + k] === u) {
            // `t` turns counter-clockwise, so leaving it across edge a → b, b is on the left.
            return [corner(mesh, t, (k + 1) % 3), corner(mesh, t, k)];
        }
    throw new Error('Triangles are not neighbours');
}

/** The shortest path through the portals (the "simple stupid funnel algorithm"). */
function funnel(start: Vec2, end: Vec2, portals: [Vec2, Vec2][]): Vec2[] {
    const all: [Vec2, Vec2][] = [[start, start], ...portals, [end, end]];
    const path: Vec2[] = [start];
    let apex = start;
    let [left, right] = all[0]!;
    let leftIndex = 0;
    let rightIndex = 0;
    for (let i = 1; i < all.length; i++) {
        const [l, r] = all[i]!;
        // The right side swings left (narrowing the funnel) unless it would cross the left side.
        if (cross(apex, right, r) >= 0) {
            if (same(apex, right) || cross(apex, left, r) < 0) {
                right = r;
                rightIndex = i;
            } else {
                if (!same(path.at(-1)!, left)) path.push(left);
                // The left side becomes the apex; start again from the portal it came from.
                apex = left;
                right = apex;
                rightIndex = leftIndex;
                i = leftIndex;
                continue;
            }
        }
        if (cross(apex, left, l) <= 0) {
            if (same(apex, left) || cross(apex, right, l) > 0) {
                left = l;
                leftIndex = i;
            } else {
                if (!same(path.at(-1)!, right)) path.push(right);
                apex = right;
                left = apex;
                leftIndex = rightIndex;
                i = rightIndex;
                continue;
            }
        }
    }
    if (!same(path.at(-1)!, end)) path.push(end);
    return path;
}

// --- The shortest path: Polyanya ---------------------------------------------------------------
//
// Polyanya (Cui, Harabor and Grastien, 2017) finds the exact shortest path on a navmesh. A search
// node is a root, the last point the path turned at (or the start), and an interval of a triangle
// edge seen from it. Expanding one projects the interval across the next triangle: what the root
// still sees keeps the root; what lies around a corner at an interval's end turns there, and that
// corner becomes a root. Every vertex of our mesh lies on the floor's edge, so any can be a corner.

/** A point the path turns at, with the length of the path to it. */
interface Root {
    point: Vec2;
    g: number;
    parent: Root | null;
    /** The mesh vertex it is, or -1 for the start. */
    vertex: number;
}

/** Root sees the part `s0`…`s1` of edge `k` of triangle `t` (corner k → corner k+1); it expands into `t`. */
interface Interval {
    root: Root;
    t: number;
    k: number;
    s0: number;
    s1: number;
}

type Item = { f: number; interval: Interval } | { f: number; goal: Root };

const EPS = 1e-9;
const lerp = (a: Vec2, b: Vec2, s: number): Vec2 => [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
];
/** Clamps a parameter along an edge, snapping it to an end when within rounding of it. */
const unit = (s: number) => (s < EPS ? 0 : s > 1 - EPS ? 1 : s);

/** A binary heap ordered by `f`. */
function heap<T extends { f: number }>() {
    const items: T[] = [];
    return {
        get size() {
            return items.length;
        },
        push(item: T) {
            items.push(item);
            let i = items.length - 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (items[parent]!.f <= items[i]!.f) break;
                [items[parent], items[i]] = [items[i]!, items[parent]!];
                i = parent;
            }
        },
        pop(): T {
            const top = items[0]!;
            const last = items.pop()!;
            if (items.length > 0) {
                items[0] = last;
                let i = 0;
                for (;;) {
                    const l = 2 * i + 1;
                    const r = l + 1;
                    let m = i;
                    if (l < items.length && items[l]!.f < items[m]!.f) m = l;
                    if (r < items.length && items[r]!.f < items[m]!.f) m = r;
                    if (m === i) break;
                    [items[m], items[i]] = [items[i]!, items[m]!];
                    i = m;
                }
            }
            return top;
        },
    };
}

/**
 * Whether the floor turns at each vertex more than a straight angle: a corner of a booth, a column
 * or a Wall sticking into the floor. Only there can a shortest path turn. Built once per mesh.
 */
const reflexes = new WeakMap<NavMesh, Uint8Array>();
function isReflex(mesh: NavMesh, vertex: number): boolean {
    let all = reflexes.get(mesh);
    if (!all) {
        const angle = new Float64Array(mesh.points.length / 2);
        for (let t = 0; t < mesh.triangles.length / 3; t++)
            for (let k = 0; k < 3; k++) {
                const o = corner(mesh, t, k);
                const p = corner(mesh, t, (k + 1) % 3);
                const q = corner(mesh, t, (k + 2) % 3);
                const turn = Math.atan2(
                    cross(o, p, q),
                    (p[0] - o[0]) * (q[0] - o[0]) + (p[1] - o[1]) * (q[1] - o[1]),
                );
                const i = mesh.triangles[3 * t + k]!;
                angle[i] = angle[i]! + Math.abs(turn);
            }
        all = new Uint8Array(angle.length);
        // A vertex inside the floor (a full turn) is no corner either.
        for (let i = 0; i < angle.length; i++)
            all[i] = angle[i]! > Math.PI + 1e-6 && angle[i]! < 2 * Math.PI - 1e-6 ? 1 : 0;
        reflexes.set(mesh, all);
    }
    return all[vertex] === 1;
}

/**
 * The least length of a path from `r` through the segment `a`–`b` to `goal`: straight when the line
 * crosses it, else by its nearer end. A goal on the root's side is mirrored across the edge first,
 * as the path must cross it and come back.
 */
function estimate(r: Vec2, a: Vec2, b: Vec2, goal: Vec2): number {
    let g = goal;
    const sr = cross(a, b, r);
    const sg = cross(a, b, goal);
    if ((sr > 0 && sg > 0) || (sr < 0 && sg < 0)) {
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const len2 = dx * dx + dy * dy;
        const s = ((goal[0] - a[0]) * dx + (goal[1] - a[1]) * dy) / len2;
        const foot: Vec2 = [a[0] + s * dx, a[1] + s * dy];
        g = [2 * foot[0] - goal[0], 2 * foot[1] - goal[1]];
    }
    const ca = cross(r, g, a);
    const cb = cross(r, g, b);
    if ((ca <= 0 && cb >= 0) || (ca >= 0 && cb <= 0)) return dist(r, g);
    return Math.min(dist(r, a) + dist(a, g), dist(r, b) + dist(b, g));
}

/**
 * Where the ray from `r` through `p`, a point of a triangle's entry edge `u`–`v` (`w` its third
 * corner), leaves the triangle, as a position along its far side: 0 at `v`, 1 at `w`, 2 at `u`.
 * A ray through `u` or `v` itself may pass outside the triangle: it then leaves where it came in.
 */
function exit(r: Vec2, p: Vec2, u: Vec2, v: Vec2, w: Vec2): number {
    const d: Vec2 = [p[0] - r[0], p[1] - r[1]];
    /** Where the line r → p meets q0 → q1: [along it, along the ray], or null if parallel. */
    const meet = (q0: Vec2, q1: Vec2): [number, number] | null => {
        const e: Vec2 = [q1[0] - q0[0], q1[1] - q0[1]];
        const denominator = d[0] * e[1] - d[1] * e[0];
        if (Math.abs(denominator) < 1e-15) return null;
        const q: Vec2 = [q0[0] - r[0], q0[1] - r[1]];
        return [
            (q[0] * d[1] - q[1] * d[0]) / denominator,
            (q[0] * e[1] - q[1] * e[0]) / denominator,
        ];
    };
    let best: number | null = null;
    let furthest = 1 + 1e-9; // beyond p, which is at 1 along the ray
    for (const [q0, q1, offset] of [
        [v, w, 0],
        [w, u, 1],
    ] as const) {
        const hit = meet(q0, q1);
        if (!hit || hit[0] < -1e-9 || hit[0] > 1 + 1e-9 || hit[1] <= furthest) continue;
        furthest = hit[1];
        best = offset + Math.max(0, Math.min(1, hit[0]));
    }
    if (best !== null) return best;
    return dist(p, u) <= dist(p, v) ? 2 : 0;
}

/**
 * The shortest path from `from` to `to` on the floor, through the corners it turns at. Only paths
 * shorter than `bound` are looked for; null when there is none, or after `budget` steps.
 */
function shortestPath(
    mesh: NavMesh,
    from: Placed,
    to: Placed,
    bound: number,
    budget: number,
): Vec2[] | null {
    if (mesh.components[from.triangle] !== mesh.components[to.triangle]) return null;
    if (from.triangle === to.triangle) return [from.point, to.point];
    const goal = to.point;
    const open = heap<Item>();

    /** Each interval once per root: a corner reached along several edges queues the same parts. */
    const queued = new Set<string>();
    let rootIds = 0;
    const ids = new WeakMap<Root, number>();
    const push = (root: Root, t: number, k: number, s0: number, s1: number) => {
        if (s1 < s0 || (s1 - s0 < EPS && s0 !== 0 && s1 !== 1)) return;
        let id = ids.get(root);
        if (id === undefined) ids.set(root, (id = rootIds++));
        const key = `${id} ${t} ${k} ${s0.toFixed(6)} ${s1.toFixed(6)}`;
        if (queued.has(key)) return;
        queued.add(key);
        const a = lerp(corner(mesh, t, k), corner(mesh, t, (k + 1) % 3), s0);
        const b = lerp(corner(mesh, t, k), corner(mesh, t, (k + 1) % 3), s1);
        const f = root.g + estimate(root.point, a, b, goal);
        if (f < bound) open.push({ f, interval: { root, t, k, s0, s1 } });
    };
    /** Part `s0`…`s1` of edge `k` of `t`, seen from `root`, expanding into the triangle across it. */
    const across = (root: Root, t: number, k: number, s0: number, s1: number) => {
        const u = mesh.neighbours[3 * t + k]!;
        if (u === -1) return;
        for (let j = 0; j < 3; j++)
            if (mesh.neighbours[3 * u + j] === t)
                return push(root, u, j, unit(1 - s1), unit(1 - s0));
    };
    const roots = new Map<number, Root>();
    /** The corner `vertex` as a root, unless it was reached more cheaply before. */
    const turnAt = (parent: Root, vertex: number): Root | null => {
        if (vertex === parent.vertex || !isReflex(mesh, vertex)) return null;
        const point = vertex2(mesh, vertex);
        const g = parent.g + dist(parent.point, point);
        const known = roots.get(vertex);
        if (known && g > known.g - EPS) return g < known.g + EPS ? known : null;
        const root: Root = { point, g, parent, vertex };
        roots.set(vertex, root);
        return root;
    };

    const start: Root = { point: from.point, g: 0, parent: null, vertex: -1 };
    for (let k = 0; k < 3; k++) across(start, from.triangle, k, 0, 1);

    let steps = 0;
    for (; open.size > 0 && steps < budget; steps++) {
        const item = open.pop();
        if ('goal' in item) {
            const path: Vec2[] = [goal];
            for (let r: Root | null = item.goal; r; r = r.parent) path.push(r.point);
            return path.reverse();
        }
        const { root, t, k, s0, s1 } = item.interval;
        // A corner reached more cheaply since this was queued: that root's own intervals cover it.
        if (root.vertex !== -1 && roots.get(root.vertex) !== root) continue;
        const iu = mesh.triangles[3 * t + k]!;
        const iv = mesh.triangles[3 * t + ((k + 1) % 3)]!;
        const u = corner(mesh, t, k);
        const v = corner(mesh, t, (k + 1) % 3);
        const w = corner(mesh, t, (k + 2) % 3);
        const r = root.point;

        // A root at a corner of this edge sees the whole triangle.
        if (root.vertex === iu || root.vertex === iv) {
            if (t === to.triangle) open.push({ f: root.g + dist(r, goal), goal: root });
            across(root, t, (k + 1) % 3, 0, 1);
            across(root, t, (k + 2) % 3, 0, 1);
            continue;
        }
        const a = lerp(u, v, s0);
        const b = lerp(u, v, s1);
        if (t === to.triangle) {
            const ca = cross(r, a, goal);
            const cb = cross(r, b, goal);
            if ((ca >= -EPS && cb <= EPS) || (ca <= EPS && cb >= -EPS)) {
                open.push({ f: root.g + dist(r, goal), goal: root });
            }
        }
        // What the root sees of the far side: from where the ray through b leaves (near v) to
        // where the ray through a leaves (near u). Far edge v → w is edge k+1, w → u is edge k+2.
        const lo = exit(r, b, u, v, w);
        const hi = Math.max(lo, exit(r, a, u, v, w));
        const part = (from0: number, to0: number, root0: Root) => {
            if (from0 < 1) across(root0, t, (k + 1) % 3, unit(from0), unit(Math.min(to0, 1)));
            if (to0 > 1) across(root0, t, (k + 2) % 3, unit(Math.max(from0, 1) - 1), unit(to0 - 1));
        };
        if (hi - lo > EPS || s1 - s0 > EPS) part(lo, hi, root);
        // Past a corner at either end, what the root cannot see the corner can: the far side
        // between where the ray through the corner leaves and the corner itself.
        if (s0 === 0 && hi < 2 - EPS) {
            const turned = turnAt(root, iu);
            if (turned) {
                if (t === to.triangle)
                    open.push({ f: turned.g + dist(turned.point, goal), goal: turned });
                part(hi, 2, turned);
            }
        }
        if (s1 === 1 && lo > EPS) {
            const turned = turnAt(root, iv);
            if (turned) {
                if (t === to.triangle)
                    open.push({ f: turned.g + dist(turned.point, goal), goal: turned });
                part(0, lo, turned);
            }
        }
    }
    return null;
}

const vertex2 = (mesh: NavMesh, i: number): Vec2 => [mesh.points[2 * i]!, mesh.points[2 * i + 1]!];

/** Steps the exact search may take before the quick route stands: about 60 ms. */
const BUDGET = 20_000;

/**
 * The walking route between two points on the floor (see `snap`), or null when no route joins
 * them, e.g. a room sealed by Walls with no Opening. A quick route through a corridor of triangles
 * comes first; the exact search (Polyanya) then looks for a shorter one, which it finds on most
 * plans. On a huge, dense plan a long route may stop there, a few per cent longer at most.
 */
export function route(mesh: NavMesh, from: Placed, to: Placed): Route | null {
    const triangles = corridor(mesh, from, to);
    if (!triangles) return null;
    const portals: [Vec2, Vec2][] = [];
    for (let i = 0; i + 1 < triangles.length; i++)
        portals.push(portal(mesh, triangles[i]!, triangles[i + 1]!));
    const quick = funnel(from.point, to.point, portals);
    const quickLength = lengthOf(quick);
    const exact = shortestPath(mesh, from, to, quickLength - 1e-6, BUDGET);
    const points = exact ?? quick;
    return { points, length: exact ? lengthOf(exact) : quickLength };
}

function lengthOf(points: Vec2[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += dist(points[i - 1]!, points[i]!);
    return length;
}
