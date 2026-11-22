// Which Zones visitors cannot walk to (ADR-0017): a Zone sealed by Walls with no door, a booth
// boxed in by others. The Editor lists them as Problems, so missing doors are found before visitors do.
import {
    containsPoint,
    resolveOpening,
    type AreaformDocument,
    type ElementRef,
    type Level,
    type Shape,
    type Vec2,
} from '@areaform/core';
import { DEFAULT_CLEARANCE, walkableArea, type AreaOptions } from './area.ts';
import { triangulate, type NavMesh } from './mesh.ts';
import { snap } from './route.ts';

/** A Zone no route reaches from the ways into its Level. */
export interface UnreachableZone {
    code: 'zone-unreachable';
    ref: ElementRef & { kind: 'zone' };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const s =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return dist(p, [a[0] + s * dx, a[1] + s * dy]);
}

/** How far a point is from a shape: 0 inside it. */
function distanceToShape(p: Vec2, shape: Shape): number {
    if (containsPoint(shape, p)) return 0;
    let best = Infinity;
    for (const ring of [shape.outer, ...(shape.holes ?? [])])
        ring.forEach(
            (a, i) =>
                (best = Math.min(best, distanceToSegment(p, a, ring[(i + 1) % ring.length]!))),
        );
    return best;
}

/** A point inside a shape, or near it: the middle of its outer ring's corners. */
const middleOf = (shape: Shape): Vec2 => {
    const n = shape.outer.length;
    return [
        shape.outer.reduce((s, p) => s + p[0], 0) / n,
        shape.outer.reduce((s, p) => s + p[1], 0) / n,
    ];
};

/**
 * The pieces of floor visitors arrive on: inside each Opening in the Level's outer edge (an
 * entrance or a door to the outside; emergency exits are not a way in), and beside each Stop of a
 * Connection. A Level with neither counts its largest piece of floor.
 */
function arrivals(
    doc: AreaformDocument,
    level: Level,
    mesh: NavMesh,
    clearance: number,
): Set<number> {
    const found = new Set<number>();
    const add = (p: Vec2) => {
        const placed = snap(mesh, p);
        if (placed) found.add(mesh.components[placed.triangle]!);
    };
    for (const opening of level.openings) {
        if (opening.kind === 'emergency-exit') continue;
        const placement = resolveOpening(level, opening);
        if (!placement) continue;
        const wall =
            opening.host === 'wall' ? level.walls.find((w) => w.id === opening.wallId) : undefined;
        const reach = (wall?.thickness ?? 0) / 2 + clearance + 0.2;
        const normal: Vec2 = [-Math.sin(placement.angle), Math.cos(placement.angle)];
        const [x, y] = placement.position;
        const sides: Vec2[] = [
            [x + normal[0] * reach, y + normal[1] * reach],
            [x - normal[0] * reach, y - normal[1] * reach],
        ];
        const inside = sides.filter((p) => containsPoint(level.outline, p));
        // A way in has the outside on one side of it; a door between two rooms does not.
        if (inside.length === 1) add(inside[0]!);
    }
    for (const connection of doc.connections)
        for (const stop of connection.stops)
            if (stop.levelId === level.id) add(stop.entry ?? middleOf(stop.shape));
    if (found.size > 0) return found;

    // No way in: the largest piece of floor stands for the Level.
    const area = new Map<number, number>();
    for (let t = 0; t < mesh.components.length; t++) {
        const [a, b, c] = [0, 1, 2].map((k) => mesh.triangles[3 * t + k]!);
        const p = (i: number): Vec2 => [mesh.points[2 * i]!, mesh.points[2 * i + 1]!];
        const [pa, pb, pc] = [p(a!), p(b!), p(c!)];
        const size =
            Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])) / 2;
        const component = mesh.components[t]!;
        area.set(component, (area.get(component) ?? 0) + size);
    }
    let largest = -1;
    let most = -1;
    for (const [component, size] of area)
        if (size > most) {
            most = size;
            largest = component;
        }
    if (largest !== -1) found.add(largest);
    return found;
}

const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** How far a triangle is from a shape: 0 when they overlap. */
function triangleToShape(tri: [Vec2, Vec2, Vec2], shape: Shape): number {
    const inTriangle = (p: Vec2) => {
        const [a, b, c] = tri;
        const s = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
        return s.every((v) => v >= 0) || s.every((v) => v <= 0);
    };
    let best = Infinity;
    for (const p of tri) best = Math.min(best, distanceToShape(p, shape));
    if (best === 0) return 0;
    for (const ring of [shape.outer, ...(shape.holes ?? [])])
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i]!;
            const b = ring[(i + 1) % ring.length]!;
            if (inTriangle(a)) return 0;
            for (let k = 0; k < 3; k++) {
                const [c, d] = [tri[k]!, tri[(k + 1) % 3]!];
                if (segmentsCross(a, b, c, d)) return 0;
                best = Math.min(best, distanceToSegment(c, a, b), distanceToSegment(a, c, d));
            }
        }
    return best;
}

/** The reached floor's triangles by grid cell, to find those near a Zone quickly. */
function floorGrid(mesh: NavMesh, reached: Set<number>) {
    const count = mesh.triangles.length / 3;
    const corner = (t: number, k: number): Vec2 => {
        const i = mesh.triangles[3 * t + k]!;
        return [mesh.points[2 * i]!, mesh.points[2 * i + 1]!];
    };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < mesh.points.length; i += 2) {
        minX = Math.min(minX, mesh.points[i]!);
        maxX = Math.max(maxX, mesh.points[i]!);
        minY = Math.min(minY, mesh.points[i + 1]!);
        maxY = Math.max(maxY, mesh.points[i + 1]!);
    }
    const size = Math.max(1, Math.sqrt(((maxX - minX) * (maxY - minY)) / Math.max(1, count)) * 2);
    const cells = new Map<string, number[]>();
    const key = (cx: number, cy: number) => `${cx},${cy}`;
    for (let t = 0; t < count; t++) {
        if (!reached.has(mesh.components[t]!)) continue;
        const tri = [corner(t, 0), corner(t, 1), corner(t, 2)];
        const x0 = Math.floor((Math.min(...tri.map((p) => p[0])) - minX) / size);
        const x1 = Math.floor((Math.max(...tri.map((p) => p[0])) - minX) / size);
        const y0 = Math.floor((Math.min(...tri.map((p) => p[1])) - minY) / size);
        const y1 = Math.floor((Math.max(...tri.map((p) => p[1])) - minY) / size);
        for (let cx = x0; cx <= x1; cx++)
            for (let cy = y0; cy <= y1; cy++) {
                const list = cells.get(key(cx, cy));
                if (list) list.push(t);
                else cells.set(key(cx, cy), [t]);
            }
    }
    /** Whether reached floor comes within `near` of the shape. */
    return (shape: Shape, near: number) => {
        const xs = shape.outer.map((p) => p[0]);
        const ys = shape.outer.map((p) => p[1]);
        const x0 = Math.floor((Math.min(...xs) - near - minX) / size);
        const x1 = Math.floor((Math.max(...xs) + near - minX) / size);
        const y0 = Math.floor((Math.min(...ys) - near - minY) / size);
        const y1 = Math.floor((Math.max(...ys) + near - minY) / size);
        const seen = new Set<number>();
        for (let cx = x0; cx <= x1; cx++)
            for (let cy = y0; cy <= y1; cy++)
                for (const t of cells.get(key(cx, cy)) ?? []) {
                    if (seen.has(t)) continue;
                    seen.add(t);
                    if (triangleToShape([corner(t, 0), corner(t, 1), corner(t, 2)], shape) <= near)
                        return true;
                }
        return false;
    };
}

/**
 * The Zones on `level` that no route reaches from where visitors arrive on it (`arrivals`). A Zone
 * counts as reached when that floor comes within the clearance of it: a room through its door, a
 * booth from the aisle beside it. Restricted Zones are checked too (an aisle nobody can get to).
 */
export function unreachableZonesOn(
    doc: AreaformDocument,
    level: Level,
    options: AreaOptions = {},
    mesh: NavMesh = triangulate(walkableArea(doc, level, options)),
): UnreachableZone[] {
    if (mesh.triangles.length === 0 || level.zones.length === 0) return [];
    const clearance = options.clearance ?? DEFAULT_CLEARANCE;
    const reachedNear = floorGrid(mesh, arrivals(doc, level, mesh, clearance));
    // Rounding to whole millimetres, plus room for a Wall drawn only 4 cm thick.
    const near = clearance + 0.02;
    return level.zones
        .filter((zone) => !reachedNear(zone.shape, near))
        .map((zone) => ({
            code: 'zone-unreachable' as const,
            ref: { kind: 'zone' as const, id: zone.id, levelId: level.id },
        }));
}

/** The Zones visitors cannot walk to, on every Level (see `unreachableZonesOn`). */
export function unreachableZones(
    doc: AreaformDocument,
    options: AreaOptions = {},
): UnreachableZone[] {
    return doc.levels.flatMap((level) => unreachableZonesOn(doc, level, options));
}
