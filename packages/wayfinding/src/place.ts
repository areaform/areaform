// Where a place is, for a route (ADR-0017): in the building, or outside it and reached through a
// door. Plain geometry on the Document, no navmesh, so a Plugin can tell at a tap.
import {
    resolveOpening,
    type AreaformDocument,
    type Id,
    type Level,
    type Shape,
    type Vec2,
} from '@areaform/core';

/** A point on one Level. */
export interface LevelPoint {
    levelId: Id;
    point: Vec2;
}

/** A way out of a Level: an Opening with the Outline on one side and the outside on the other. */
export interface Exit {
    levelId: Id;
    openingId: Id;
    /** The middle of the doorway. */
    point: Vec2;
    /** Straight out of the doorway, `OUTSIDE_CLEARANCE` beyond the Wall: where the way on starts. */
    out: Vec2;
}

/** A way out toward a place outside, with the way on to it. */
export interface WayOut extends Exit {
    /**
     * From the doorway to the place, outside the Outline: straight out of the door, then the
     * shortest way round the building, keeping `OUTSIDE_CLEARANCE` off it.
     */
    way: Vec2[];
}

/**
 * Where a place tapped on a Level is: `inside` the building, on that Level or, outside its
 * Outline, on the nearest Level below whose Outline holds it (under an atrium or beside a
 * gallery); `outside` it, reached through one of `exits`, each with the way on outside; or
 * `nowhere` a visitor can be routed: outside, with no way out drawn that the way on can reach it
 * from (a courtyard from the street, or the street from a courtyard).
 */
export type Place =
    | { kind: 'inside'; place: LevelPoint }
    | { kind: 'outside'; exits: WayOut[] }
    | { kind: 'nowhere' };

/** How far either side of a doorway is looked at, beyond its Wall, to tell in from out, metres. */
const DOORWAY_REACH = 0.3;

/** How far the way on outside keeps off the Outline, metres: clear of the Walls, seen in 3D. */
export const OUTSIDE_CLEARANCE = 1;

/** Whether a point is inside a Shape, its holes left out (even–odd, so either winding). */
export function inShape(p: Vec2, shape: Shape): boolean {
    let odd = false;
    for (const ring of [shape.outer, ...(shape.holes ?? [])])
        ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length]!;
            if (
                a[1] > p[1] !== b[1] > p[1] &&
                p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
            )
                odd = !odd;
        });
    return odd;
}

/** Whether a point is inside its Level's Outline: where a visitor can stand. */
export function isInside(doc: AreaformDocument, at: LevelPoint): boolean {
    const level = doc.levels.find((l) => l.id === at.levelId);
    return level !== undefined && inShape(at.point, level.outline);
}

/** Below when it stands lower, by elevation and then ordinal. */
const isBelow = (level: Level, than: Level) =>
    level.elevation !== than.elevation
        ? level.elevation < than.elevation
        : level.ordinal < than.ordinal;

/**
 * The ways out of a Level: each Opening, but an emergency exit, with the Outline on one side and
 * the outside on the other. Visitors are not sent out by an emergency exit.
 */
export function exitsOf(level: Level): Exit[] {
    const exits: Exit[] = [];
    for (const opening of level.openings) {
        if (opening.kind === 'emergency-exit') continue;
        const placement = resolveOpening(level, opening);
        if (!placement) continue;
        const wall =
            opening.host === 'wall' ? level.walls.find((w) => w.id === opening.wallId) : undefined;
        const half = wall ? wall.thickness / 2 : 0;
        const [x, y] = placement.position;
        const [nx, ny] = [-Math.sin(placement.angle), Math.cos(placement.angle)];
        const at = (d: number): Vec2 => [x + nx * d, y + ny * d];
        const reach = half + DOORWAY_REACH;
        const [front, back] = [
            inShape(at(reach), level.outline),
            inShape(at(-reach), level.outline),
        ];
        if (front === back) continue;
        const out = at((front ? -1 : 1) * (half + OUTSIDE_CLEARANCE));
        exits.push({ levelId: level.id, openingId: opening.id, point: placement.position, out });
    }
    return exits;
}

/** Where a place tapped at `at` is, for a route to it (see `Place`). */
export function placeOf(doc: AreaformDocument, at: LevelPoint): Place {
    const level = doc.levels.find((l) => l.id === at.levelId);
    if (!level || inShape(at.point, level.outline)) return { kind: 'inside', place: at };
    const below = doc.levels
        .filter((l) => isBelow(l, level) && inShape(at.point, l.outline))
        .sort((a, b) => (isBelow(a, b) ? 1 : -1))[0];
    if (below) return { kind: 'inside', place: { levelId: below.id, point: at.point } };
    const exits = doc.levels.flatMap((l) =>
        exitsOf(l).flatMap((exit): WayOut[] => {
            const way = wayOutside(l.outline, exit.out, at.point);
            return way ? [{ ...exit, way: [exit.point, ...way] }] : [];
        }),
    );
    return exits.length > 0 ? { kind: 'outside', exits } : { kind: 'nowhere' };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** How far `p` is from the segment `a`–`b`. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
    return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Whether two segments cross, each through the other's inside (touching does not count). */
function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const eps = 1e-9;
    const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
    return (
        ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
        ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
    );
}

/**
 * The shortest way from `from` to `to` that stays outside `outline`, turning only at its corners,
 * each pushed `OUTSIDE_CLEARANCE` out along both its sides so the way cuts round the corner a
 * little off the Walls: `from`, the corners turned at, `to`. Null when the outline is in the way
 * whichever way round: one of them is in a courtyard, the other not.
 */
export function wayOutside(outline: Shape, from: Vec2, to: Vec2): Vec2[] | null {
    const rings = [outline.outer, ...(outline.holes ?? [])];
    const edges = rings.flatMap((ring) =>
        ring.map((a, i): [Vec2, Vec2] => [a, ring[(i + 1) % ring.length]!]),
    );
    /** How far a point is from the Outline. */
    const clear = (p: Vec2) => Math.min(...edges.map(([c, d]) => toSegment(p, c, d)));
    /**
     * Whether the way can go straight from `a` to `b`: outside, crossing no edge, and at least
     * half `OUTSIDE_CLEARANCE` off the Outline (a corner cut at a metre out along both sides
     * passes it at 0.7 m), or as near as an end already is: a place by a Wall.
     */
    const sees = (a: Vec2, b: Vec2) => {
        const keep = Math.min(OUTSIDE_CLEARANCE / 2, clear(a), clear(b)) - 1e-6;
        for (const [c, d] of edges) {
            if (crosses(a, b, c, d)) return false;
            const near = Math.min(
                toSegment(a, c, d),
                toSegment(b, c, d),
                toSegment(c, a, b),
                toSegment(d, a, b),
            );
            if (near < keep) return false;
        }
        // Into the building through a corner crosses no edge: the way must stay outside.
        const middle: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return !inShape(middle, outline);
    };
    if (sees(from, to)) return [from, to];

    /** Out of the building across the edge `a`–`b`: its unit normal toward the outside. */
    const outward = (a: Vec2, b: Vec2): Vec2 => {
        const length = dist(a, b) || 1;
        const n: Vec2 = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
        const mid: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 1e-3, (a[1] + b[1]) / 2 + n[1] * 1e-3];
        return inShape(mid, outline) ? [-n[0], -n[1]] : n;
    };
    const corners: Vec2[] = [];
    for (const ring of rings)
        ring.forEach((v, i) => {
            const previous = ring[(i + ring.length - 1) % ring.length]!;
            const next = ring[(i + 1) % ring.length]!;
            for (const [nx, ny] of [outward(previous, v), outward(v, next)]) {
                const p: Vec2 = [v[0] + nx * OUTSIDE_CLEARANCE, v[1] + ny * OUTSIDE_CLEARANCE];
                if (!inShape(p, outline) && !corners.some((q) => dist(p, q) < 1e-6))
                    corners.push(p);
            }
        });

    // Dijkstra over `from` (0), the corners, `to` (last), along the segments that stay outside.
    const nodes = [from, ...corners, to];
    const best = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const done = nodes.map(() => false);
    best[0] = 0;
    for (;;) {
        let i = -1;
        for (let k = 0; k < nodes.length; k++)
            if (!done[k] && best[k]! < Infinity && (i === -1 || best[k]! < best[i]!)) i = k;
        if (i === -1) return null;
        if (i === nodes.length - 1) break;
        done[i] = true;
        for (let k = 0; k < nodes.length; k++) {
            if (done[k]) continue;
            const d = best[i]! + dist(nodes[i]!, nodes[k]!);
            if (d < best[k]! && sees(nodes[i]!, nodes[k]!)) {
                best[k] = d;
                previous[k] = i;
            }
        }
    }
    const way: Vec2[] = [];
    for (let i = nodes.length - 1; i !== -1; i = previous[i]!) way.unshift(nodes[i]!);
    return way;
}
