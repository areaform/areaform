// The walkable area of one Level: its floor, minus what blocks walking, shrunk by the clearance.
// Clipper2 works on integers, so everything here is in millimetres (ADR-0017).
import {
    difference,
    EndType,
    FillRule,
    inflatePaths,
    intersect,
    JoinType,
    union,
    type Path64,
    type Paths64,
} from '@countertype/clipper2-ts';
import {
    resolveOpening,
    wallOutlines,
    type AreaformDocument,
    type Level,
    type Shape,
    type Vec2,
} from '@areaform/core';

/** Millimetres per metre: plans are drawn to the millimetre at best. */
export const MM = 1000;

export interface AreaOptions {
    /** How far routes keep from Walls, Obstacles and Walk-around Zones, in metres. */
    clearance?: number;
}

export const DEFAULT_CLEARANCE = 0.3;

const toMm = (p: Vec2) => ({ x: Math.round(p[0] * MM), y: Math.round(p[1] * MM) });

/** A Shape as paths, its holes taken out (each Shape on its own, whatever its rings' winding). */
function shapePaths(shape: Shape): Paths64 {
    const rings = [shape.outer, ...(shape.holes ?? [])].map((r) => r.map(toMm));
    return union(rings, FillRule.EvenOdd);
}

/** A rectangle `length` along `angle` and `depth` across it, centred on `centre`, in mm. */
function rectangle(centre: Vec2, angle: number, length: number, depth: number): Path64 {
    const u: Vec2 = [Math.cos(angle) * (length / 2), Math.sin(angle) * (length / 2)];
    const v: Vec2 = [-Math.sin(angle) * (depth / 2), Math.cos(angle) * (depth / 2)];
    const [x, y] = centre;
    return [
        toMm([x - u[0] - v[0], y - u[1] - v[1]]),
        toMm([x + u[0] - v[0], y + u[1] - v[1]]),
        toMm([x + u[0] + v[0], y + u[1] + v[1]]),
        toMm([x - u[0] + v[0], y - u[1] + v[1]]),
    ];
}

/**
 * Where people can walk on a Level, in mm: the Outline minus Walls, Obstacles, Walk-around Zones
 * and Connection Stops, with every Opening hosted on a Wall cut back through it, then shrunk by
 * the clearance so routes keep off corners. An Opening narrower than twice the clearance is kept
 * passable: its passage is added back after the shrink, a little narrower than the Opening.
 */
export function walkableArea(
    doc: AreaformDocument,
    level: Level,
    options: AreaOptions = {},
): Paths64 {
    const clearance = options.clearance ?? DEFAULT_CLEARANCE;
    const floor = shapePaths(level.outline);

    const walls: Paths64 = [];
    for (const shape of wallOutlines(level).values()) walls.push(...shapePaths(shape));

    // Each hosted Opening: the gap in its Wall, and the passage kept open after the shrink.
    const gaps: Paths64 = [];
    const passages: Paths64 = [];
    for (const opening of level.openings) {
        if (opening.host !== 'wall') continue;
        const wall = level.walls.find((w) => w.id === opening.wallId);
        const placement = resolveOpening(level, opening);
        if (!wall || !placement) continue;
        const depth = wall.thickness + 2 * clearance + 0.01;
        gaps.push(rectangle(placement.position, placement.angle, opening.width, depth));
        const narrowed = Math.max(opening.width - 2 * clearance, opening.width / 2);
        passages.push(rectangle(placement.position, placement.angle, narrowed, depth));
    }

    const others: Paths64 = [];
    for (const obstacle of level.obstacles) others.push(...shapePaths(obstacle.shape));
    for (const zone of level.zones) if (zone.walkAround) others.push(...shapePaths(zone.shape));
    for (const connection of doc.connections)
        for (const stop of connection.stops)
            if (stop.levelId === level.id) others.push(...shapePaths(stop.shape));

    const blocked = union(difference(walls, gaps, FillRule.NonZero), others, FillRule.NonZero);
    const free = difference(floor, blocked, FillRule.NonZero);
    const shrunk = inflatePaths(free, -clearance * MM, JoinType.Miter, EndType.Polygon, 2);
    if (passages.length === 0) return shrunk;
    // A passage stays on the floor (an entrance in an outer Wall) and off anything else in its way.
    const open = difference(
        intersect(passages, floor, FillRule.NonZero),
        blocked,
        FillRule.NonZero,
    );
    return union(shrunk, open, FillRule.NonZero);
}
