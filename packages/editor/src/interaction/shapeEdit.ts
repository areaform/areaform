// Reshaping a Zone, Obstacle or Stop: its corners, its sides and, for rectangles, its size.
import {
    containsPoint,
    containsRing,
    holesOverlap,
    type Command,
    type AreaformDocument,
    type Id,
    type Ring,
    type Shape,
    type ElementRef,
    type Vec2,
} from '@areaform/core';
import { findLevel } from './elements.ts';

/** An element whose shape the Select tool can edit. */
export type ShapedRef = { kind: 'zone' | 'obstacle' | 'stop'; id: Id; levelId: Id };

/** A corner of a shape: ring 0 is the outer ring, ring i > 0 is hole i − 1. */
export interface Corner {
    ring: number;
    index: number;
}

/** Shorter than this (metres), a side or a rectangle has collapsed. */
const MIN_SIZE = 1e-3;

export function isShaped(ref: ElementRef): ref is ShapedRef {
    return ref.kind === 'zone' || ref.kind === 'obstacle' || ref.kind === 'stop';
}

export function shapeOf(doc: AreaformDocument, ref: ShapedRef): Shape | undefined {
    if (ref.kind === 'stop') {
        const connection = doc.connections.find((c) => c.id === ref.id);
        return connection?.stops.find((s) => s.levelId === ref.levelId)?.shape;
    }
    const level = findLevel(doc, ref.levelId);
    const list = ref.kind === 'zone' ? level?.zones : level?.obstacles;
    return list?.find((e) => e.id === ref.id)?.shape;
}

export function ringsOf(shape: Shape): Ring[] {
    return [shape.outer, ...(shape.holes ?? [])];
}

export function withRing(shape: Shape, ring: number, next: Ring): Shape {
    const [outer, ...holes] = ringsOf(shape).map((r, i) => (i === ring ? next : r));
    return { outer: outer!, ...(holes.length > 0 && { holes }) };
}

export function midpoints(ring: Ring): Vec2[] {
    return ring.map((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    });
}

/** Every hole inside the outer ring (its edges too, not just its corners), and none overlap. */
export function holesValid(shape: Shape): boolean {
    return (
        (shape.holes ?? []).every((hole) => containsRing({ outer: shape.outer }, hole)) &&
        !holesOverlap(shape)
    );
}

/**
 * Width and depth of a four-cornered ring whose corners are all right angles (at any rotation),
 * the side nearer horizontal first; undefined for any other ring.
 */
export function rectangleSides(ring: Ring): [number, number] | undefined {
    if (ring.length !== 4) return undefined;
    const edges = ring.map((p, i) => sub(ring[(i + 1) % 4]!, p));
    const lengths = edges.map(([x, y]) => Math.hypot(x, y));
    if (lengths.some((l) => l === 0)) return undefined;
    const square = edges.every(([x, y], i) => {
        const [nx, ny] = edges[(i + 1) % 4]!;
        return Math.abs(x * nx + y * ny) <= 1e-6 * lengths[i]! * lengths[(i + 1) % 4]!;
    });
    if (!square) return undefined;
    const [first, second] = [lengths[0]!, lengths[1]!];
    const horizontal = (i: number) => Math.abs(edges[i]![0]) / lengths[i]!;
    return horizontal(1) > horizontal(0) + 1e-9 ? [second, first] : [first, second];
}

/** The area of a shape, holes taken out. */
export function shapeArea(shape: Shape): number {
    const area = (ring: Ring) =>
        Math.abs(
            ring.reduce((sum, [x1, y1], i) => {
                const [x2, y2] = ring[(i + 1) % ring.length]!;
                return sum + x1 * y2 - x2 * y1;
            }, 0) / 2,
        );
    return area(shape.outer) - (shape.holes ?? []).reduce((sum, h) => sum + area(h), 0);
}

/** The ring with one corner moved to `to`. */
export function moveCorner(ring: Ring, index: number, to: Vec2): Ring {
    return ring.map((p, i) => (i === index ? to : p));
}

/**
 * A rectangle with one corner dragged to `to`: the opposite corner stays, the two beside it follow
 * so every angle stays square. Undefined when that would collapse or turn it inside out.
 */
export function dragRectangleCorner(ring: Ring, index: number, to: Vec2): Ring | undefined {
    const at = (i: number) => ring[(i + 4) % 4]!;
    const opposite = at(index + 2);
    const sides = [at(index - 1), at(index + 1)].map((p) => unit(sub(p, opposite)));
    const lengths = sides.map((d) => dot(sub(to, opposite), d));
    if (lengths.some((l) => l < MIN_SIZE)) return undefined;
    const [before, after] = sides.map((d, i) => add(opposite, scale(d, lengths[i]!)));
    const next = [...ring];
    next[(index + 3) % 4] = before!;
    next[(index + 1) % 4] = after!;
    next[index] = add(before!, sub(after!, opposite));
    return next;
}

/**
 * A rectangle with the side from corner `edge` to the next one moved to pass through `to`, square
 * to the sides beside it. Undefined when that would collapse or turn it inside out.
 */
export function dragRectangleSide(ring: Ring, edge: number, to: Vec2): Ring | undefined {
    const at = (i: number) => ring[(i + 4) % 4]!;
    const [a, b] = [at(edge), at(edge + 1)];
    const inward = sub(at(edge - 1), a); // along the side before, back to the far side
    const depth = Math.hypot(...inward);
    const outward = scale(inward, -1 / depth);
    const shift = dot(sub(to, a), outward);
    if (depth + shift < MIN_SIZE) return undefined;
    const next = [...ring];
    next[edge] = add(a, scale(outward, shift));
    next[(edge + 1) % 4] = add(b, scale(outward, shift));
    return next;
}

/** The ring with a new corner in the middle of the side from corner `edge` to the next. */
export function insertCorner(ring: Ring, edge: number): Ring {
    return [...ring.slice(0, edge + 1), midpoints(ring)[edge]!, ...ring.slice(edge + 1)];
}

/**
 * The shape without a corner: a ring keeps at least three, and a hole left with three goes whole.
 * Undefined when the outer ring has only three.
 */
export function removeCorner(shape: Shape, { ring, index }: Corner): Shape | undefined {
    const rings = ringsOf(shape);
    const r = rings[ring]!;
    if (r.length > 3)
        return withRing(
            shape,
            ring,
            r.filter((_, i) => i !== index),
        );
    if (ring === 0) return undefined;
    const [outer, ...holes] = rings.filter((_, i) => i !== ring);
    return { outer: outer!, ...(holes.length > 0 && { holes }) };
}

/**
 * A rectangle resized to `width` × `depth` (the sides nearer horizontal and nearer vertical, as
 * `rectangleSides` gives them), keeping its angle and the corner at its top left on screen.
 */
export function resizeRectangle(ring: Ring, width: number, depth: number): Ring {
    // The top-left corner on screen (Y up): the one furthest up and to the left.
    const corner = ring.reduce(
        (best, p, i) => (p[1] - p[0] > ring[best]![1] - ring[best]![0] ? i : best),
        0,
    );
    const origin = ring[corner]!;
    const [u, v] = [ring[(corner + 1) % 4]!, ring[(corner + 3) % 4]!].map((p) =>
        unit(sub(p, origin)),
    );
    // The direction nearer horizontal carries the width.
    const [across, down] = Math.abs(u![0]) >= Math.abs(v![0]) ? [u!, v!] : [v!, u!];
    const w = scale(across, width);
    const d = scale(down, depth);
    return [origin, add(origin, w), add(add(origin, w), d), add(origin, d)];
}

/**
 * The Command giving the element `shape`, in the same step clearing a Zone's label position or a
 * Stop's entry point that the new shape leaves outside it.
 */
export function reshapeCommand(
    doc: AreaformDocument,
    ref: ShapedRef,
    shape: Shape,
): Command | undefined {
    const outside = (point: Vec2 | undefined) =>
        point !== undefined && !containsPoint(shape, point);
    if (ref.kind === 'stop') {
        const connection = doc.connections.find((c) => c.id === ref.id);
        if (!connection) return undefined;
        const stops = connection.stops.map((stop) => {
            if (stop.levelId !== ref.levelId) return stop;
            const { entry, ...rest } = stop;
            return outside(entry) ? { ...rest, shape } : { ...stop, shape };
        });
        return { type: 'connection.update', connectionId: ref.id, changes: { stops } };
    }
    const levelId: Id = ref.levelId;
    if (ref.kind === 'obstacle') {
        return { type: 'obstacle.update', levelId, obstacleId: ref.id, changes: { shape } };
    }
    const zone = findLevel(doc, levelId)?.zones.find((z) => z.id === ref.id);
    return {
        type: 'zone.update',
        levelId,
        zoneId: ref.id,
        changes: { shape, ...(outside(zone?.labelAnchor) && { labelAnchor: undefined }) },
    };
}

const add = (p: Vec2, q: Vec2): Vec2 => [p[0] + q[0], p[1] + q[1]];
const sub = (p: Vec2, q: Vec2): Vec2 => [p[0] - q[0], p[1] - q[1]];
const scale = (p: Vec2, k: number): Vec2 => [p[0] * k, p[1] * k];
const dot = (p: Vec2, q: Vec2) => p[0] * q[0] + p[1] * q[1];
const unit = (p: Vec2): Vec2 => scale(p, 1 / Math.hypot(p[0], p[1]));
