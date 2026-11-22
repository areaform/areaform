import type { Ring, Shape, Vec2 } from './model.ts';

/** Distances below this (metres, or segment parameter) are treated as zero. */
export const EPSILON = 1e-6;

export function samePoint(p: Vec2, q: Vec2): boolean {
    return Math.abs(p[0] - q[0]) < EPSILON && Math.abs(p[1] - q[1]) < EPSILON;
}

export function distance(p: Vec2, q: Vec2): number {
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
}

export interface SegmentHit {
    point: Vec2;
    /** Parameter along the first segment, 0 at its start, 1 at its end. */
    t: number;
    /** Parameter along the second segment. */
    u: number;
}

/** Intersection of segments p1→p2 and q1→q2; parallel and collinear segments never hit. */
export function segmentIntersection(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): SegmentHit | null {
    const r: Vec2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const s: Vec2 = [q2[0] - q1[0], q2[1] - q1[1]];
    const denominator = cross(r, s);
    if (Math.abs(denominator) < EPSILON) return null;

    const qp: Vec2 = [q1[0] - p1[0], q1[1] - p1[1]];
    const t = cross(qp, s) / denominator;
    const u = cross(qp, r) / denominator;
    if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;

    return { point: [p1[0] + t * r[0], p1[1] + t * r[1]], t, u };
}

function cross(a: Vec2, b: Vec2): number {
    return a[0] * b[1] - a[1] * b[0];
}

/** Shoelace area: positive for counter-clockwise rings (Y-up), negative for clockwise. */
export function signedArea(ring: Ring): number {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
}

/** At least three finite, distinct consecutive points, non-zero area, and no edge crossings. */
export function isValidRing(ring: Ring): boolean {
    if (ring.length < 3) return false;
    if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return false;
    if (ring.some((p, i) => samePoint(p, ring[(i + 1) % ring.length]!))) return false;
    if (Math.abs(signedArea(ring)) < EPSILON) return false;

    const n = ring.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
            const hit = segmentIntersection(
                ring[i]!,
                ring[(i + 1) % n]!,
                ring[j]!,
                ring[(j + 1) % n]!,
            );
            if (hit) return false;
        }
    }
    return true;
}

export function isValidShape(shape: Shape): boolean {
    return isValidRing(shape.outer) && (shape.holes ?? []).every(isValidRing);
}

/** Outer ring counter-clockwise, holes clockwise (ADR-0002). Returns rings as-is when already so. */
export function normalizeShape(shape: Shape): Shape {
    const orient = (ring: Ring, ccw: boolean) =>
        signedArea(ring) > 0 === ccw ? ring : [...ring].reverse();
    return {
        ...shape,
        outer: orient(shape.outer, true),
        ...(shape.holes && { holes: shape.holes.map((hole) => orient(hole, false)) }),
    };
}

export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
    const length = distance(a, b);
    if (length < EPSILON) return distance(p, a) < EPSILON;
    const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length ** 2;
    const clamped = Math.max(0, Math.min(1, t));
    const closest: Vec2 = [a[0] + clamped * (b[0] - a[0]), a[1] + clamped * (b[1] - a[1])];
    return distance(p, closest) < EPSILON;
}

export type Location = 'inside' | 'boundary' | 'outside';

export function locateInRing(p: Vec2, ring: Ring): Location {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (pointOnSegment(p, a, b)) return 'boundary';
        if (a[1] > p[1] !== b[1] > p[1]) {
            const x = a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
            if (p[0] < x) inside = !inside;
        }
    }
    return inside ? 'inside' : 'outside';
}

/** Inside the outer ring and not inside any hole; boundaries of either count as boundary. */
export function locateInShape(p: Vec2, shape: Shape): Location {
    const outer = locateInRing(p, shape.outer);
    if (outer !== 'inside') return outer;
    for (const hole of shape.holes ?? []) {
        const inHole = locateInRing(p, hole);
        if (inHole === 'boundary') return 'boundary';
        if (inHole === 'inside') return 'outside';
    }
    return 'inside';
}

function edges(ring: Ring): [Vec2, Vec2][] {
    return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!]);
}

const midpoint = ([a, b]: [Vec2, Vec2]): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Some edge of `a` crosses some edge of `b` at a point interior to both. */
function ringsCross(a: Ring, b: Ring): boolean {
    for (const [p1, p2] of edges(a)) {
        for (const [q1, q2] of edges(b)) {
            const hit = segmentIntersection(p1, p2, q1, q2);
            if (
                hit &&
                hit.t > EPSILON &&
                hit.t < 1 - EPSILON &&
                hit.u > EPSILON &&
                hit.u < 1 - EPSILON
            ) {
                return true;
            }
        }
    }
    return false;
}

/** Whether `ring` lies within `shape`, touching its boundary allowed. */
export function ringWithinShape(ring: Ring, shape: Shape): boolean {
    const probes = [...ring, ...edges(ring).map(midpoint)];
    if (probes.some((p) => locateInShape(p, shape) === 'outside')) return false;
    const rings = [shape.outer, ...(shape.holes ?? [])];
    if (rings.some((other) => ringsCross(ring, other))) return false;
    // A ring around a hole has every vertex in the shape, yet covers the hole.
    return !(shape.holes ?? []).some((hole) =>
        hole.some((p) => locateInRing(p, ring) === 'inside'),
    );
}

/** Whether the interiors of two rings overlap; sharing edges or corners does not count. */
export function ringsOverlap(a: Ring, b: Ring): boolean {
    if (ringsCross(a, b)) return true;
    const strictlyInside = (probes: Vec2[], ring: Ring) =>
        probes.some((p) => locateInRing(p, ring) === 'inside');
    const probesOf = (ring: Ring) => [...ring, ...edges(ring).map(midpoint), centroid(ring)];
    return strictlyInside(probesOf(a), b) || strictlyInside(probesOf(b), a);
}

/** Area centroid of a simple ring. */
export function centroid(ring: Ring): Vec2 {
    const area = signedArea(ring);
    let cx = 0;
    let cy = 0;
    for (const [[x1, y1], [x2, y2]] of edges(ring)) {
        const f = x1 * y2 - x2 * y1;
        cx += (x1 + x2) * f;
        cy += (y1 + y2) * f;
    }
    return [cx / (6 * area), cy / (6 * area)];
}

export interface Box {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export function boundingBox(points: Vec2[]): Box {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
    };
}

/** Index pairs [i, j] (i < j in input order) whose boxes overlap or touch; sweep along X. */
export function overlappingBoxPairs(boxes: Box[]): [number, number][] {
    const order = boxes.map((_, i) => i).sort((i, j) => boxes[i]!.minX - boxes[j]!.minX);
    const pairs: [number, number][] = [];
    const active: number[] = [];
    for (const i of order) {
        const box = boxes[i]!;
        for (let k = active.length - 1; k >= 0; k--) {
            if (boxes[active[k]!]!.maxX < box.minX - EPSILON) active.splice(k, 1);
        }
        for (const j of active) {
            const other = boxes[j]!;
            if (other.minY <= box.maxY + EPSILON && box.minY <= other.maxY + EPSILON) {
                pairs.push(i < j ? [i, j] : [j, i]);
            }
        }
        active.push(i);
    }
    return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** Length of the shared part of two collinear segments, or 0 if they are not collinear. */
export function collinearOverlap(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
    const length = distance(a1, a2);
    if (length < EPSILON) return 0;
    const dir: Vec2 = [(a2[0] - a1[0]) / length, (a2[1] - a1[1]) / length];
    const offLine = (p: Vec2) => Math.abs((p[0] - a1[0]) * dir[1] - (p[1] - a1[1]) * dir[0]);
    if (offLine(b1) > EPSILON || offLine(b2) > EPSILON) return 0;
    const along = (p: Vec2) => (p[0] - a1[0]) * dir[0] + (p[1] - a1[1]) * dir[1];
    const [s1, s2] = [along(b1), along(b2)].sort((x, y) => x - y) as [number, number];
    return Math.max(0, Math.min(length, s2) - Math.max(0, s1));
}
