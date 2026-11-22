import {
    containsPoint,
    resolveOpening,
    type Level,
    type Opening,
    type Ring,
    type Shape,
    type Vec2,
} from '@areaform/core';

/**
 * How close an imported Level is to the plan it was drawn from; the round-trip measure of the
 * Draft import (docs/product/mcp-import-design.md, decision 18). Elements are matched by place, not id:
 * the import invents its own ids. Where the plan's origin lies is arbitrary (the Draft's is the
 * Source's lower-left corner), so the found Level is first moved onto the expected Outline.
 */
export interface Score {
    /** How far the found Level was moved so the two Outlines' lower-left corners coincide. */
    offset: Vec2;
    zones: {
        expected: number;
        found: number;
        /** Expected Zones with a found Zone overlapping them at IoU ≥ `MATCH_IOU`. */
        matched: number;
        /** Labels (or ids, when unlabelled) of expected Zones with no match. */
        missing: string[];
        /** Found Zones that match no expected one. */
        extra: number;
        /** Mean IoU over matched pairs. */
        meanIoU: number;
        /** Matched pairs with the same category, and with the same label. */
        sameCategory: number;
        sameLabel: number;
        sameRestricted: number;
    };
    /** IoU of everything covered by Zones, matched or not. */
    zoneAreaIoU: number;
    walls: { expectedLength: number; foundLength: number };
    openings: {
        expected: number;
        found: number;
        /** Expected Openings with a found one whose centre is within `OPENING_DISTANCE`. */
        matched: number;
        sameKind: number;
        /** Mean width difference over matched pairs, metres. */
        meanWidthError: number;
    };
    obstacles: { expected: number; found: number; matched: number };
}

export const MATCH_IOU = 0.5;
export const OPENING_DISTANCE = 1;
/** Sampling steps for areas, metres: fine for one Zone a few metres across, coarser for a hall. */
const STEP = 0.1;
const HALL_STEP = 0.25;

export function score(expected: Level, unaligned: Level): Score {
    const [ex, ey] = box(expected.outline.outer);
    const [fx, fy] = box(unaligned.outline.outer);
    const offset: Vec2 = [ex - fx, ey - fy];
    const found = translate(unaligned, offset);
    const zonePairs = match(expected.zones, found.zones, (z) => z.shape);
    const obstaclePairs = match(expected.obstacles, found.obstacles, (o) => o.shape);
    const openingPairs = matchOpenings(expected, found);

    return {
        offset,
        zones: {
            expected: expected.zones.length,
            found: found.zones.length,
            matched: zonePairs.length,
            missing: expected.zones
                .filter((z) => !zonePairs.some(([e]) => e === z))
                .map((z) => z.label ?? z.id),
            extra: found.zones.length - zonePairs.length,
            meanIoU: mean(zonePairs.map(([, , iou]) => iou)),
            sameCategory: zonePairs.filter(([e, f]) => e.category === f.category).length,
            sameLabel: zonePairs.filter(([e, f]) => e.label === f.label).length,
            sameRestricted: zonePairs.filter(
                ([e, f]) => (e.restricted ?? false) === (f.restricted ?? false),
            ).length,
        },
        zoneAreaIoU: iou(
            expected.zones.map((z) => z.shape),
            found.zones.map((z) => z.shape),
            HALL_STEP,
        ),
        walls: { expectedLength: wallLength(expected), foundLength: wallLength(found) },
        openings: {
            expected: expected.openings.length,
            found: found.openings.length,
            matched: openingPairs.length,
            sameKind: openingPairs.filter(([e, f]) => e.kind === f.kind).length,
            meanWidthError: mean(openingPairs.map(([e, f]) => Math.abs(e.width - f.width))),
        },
        obstacles: {
            expected: expected.obstacles.length,
            found: found.obstacles.length,
            matched: obstaclePairs.length,
        },
    };
}

/** Pairs each expected item with the unused found item it overlaps most, best pairs first. */
function match<T>(expected: T[], found: T[], shapeOf: (item: T) => Shape): [T, T, number][] {
    const candidates: [T, T, number][] = [];
    for (const e of expected) {
        for (const f of found) {
            if (!boxesOverlap(shapeOf(e).outer, shapeOf(f).outer)) continue;
            const value = iou([shapeOf(e)], [shapeOf(f)]);
            if (value >= MATCH_IOU) candidates.push([e, f, value]);
        }
    }
    candidates.sort((a, b) => b[2] - a[2]);
    const used = new Set<T>();
    return candidates.filter(([e, f]) => {
        if (used.has(e) || used.has(f)) return false;
        used.add(e).add(f);
        return true;
    });
}

function matchOpenings(expected: Level, found: Level): [Opening, Opening][] {
    const centres = (level: Level) =>
        level.openings.flatMap((o) => {
            const at = resolveOpening(level, o);
            return at ? [{ opening: o, centre: at.position }] : [];
        });
    const theirs = centres(found);
    const used = new Set<Opening>();
    const pairs: [Opening, Opening][] = [];
    for (const { opening, centre } of centres(expected)) {
        const nearest = theirs
            .filter((t) => !used.has(t.opening))
            .map((t) => ({
                ...t,
                distance: Math.hypot(t.centre[0] - centre[0], t.centre[1] - centre[1]),
            }))
            .sort((a, b) => a.distance - b.distance)[0];
        if (nearest && nearest.distance <= OPENING_DISTANCE) {
            used.add(nearest.opening);
            pairs.push([opening, nearest.opening]);
        }
    }
    return pairs;
}

/** Intersection over union of two sets of shapes, by sampling cell centres. */
function iou(a: Shape[], b: Shape[], step = STEP): number {
    const rings = [...a, ...b].map((s) => s.outer);
    if (rings.length === 0) return 1;
    const [minX, minY, maxX, maxY] = box(rings.flat());
    let both = 0;
    let either = 0;
    for (let x = minX + step / 2; x < maxX; x += step) {
        for (let y = minY + step / 2; y < maxY; y += step) {
            const inA = a.some((s) => containsPoint(s, [x, y]));
            const inB = b.some((s) => containsPoint(s, [x, y]));
            if (inA && inB) both++;
            if (inA || inB) either++;
        }
    }
    return either === 0 ? 1 : both / either;
}

function translate(level: Level, [dx, dy]: Vec2): Level {
    const move = ([x, y]: Vec2): Vec2 => [x + dx, y + dy];
    const shape = (s: Shape): Shape => ({
        outer: s.outer.map(move),
        ...(s.holes && { holes: s.holes.map((h) => h.map(move)) }),
    });
    return {
        ...level,
        outline: shape(level.outline),
        wallNodes: level.wallNodes.map((n) => ({ ...n, position: move(n.position) })),
        openings: level.openings.map((o) =>
            o.host === 'free' ? { ...o, position: move(o.position) } : o,
        ),
        zones: level.zones.map((z) => ({ ...z, shape: shape(z.shape) })),
        obstacles: level.obstacles.map((o) => ({ ...o, shape: shape(o.shape) })),
    };
}

function wallLength(level: Level): number {
    const at = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    return level.walls.reduce((sum, w) => {
        const [a, b] = [at.get(w.a), at.get(w.b)];
        return a && b ? sum + Math.hypot(b[0] - a[0], b[1] - a[1]) : sum;
    }, 0);
}

function box(points: Vec2[]): [number, number, number, number] {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function boxesOverlap(a: Ring, b: Ring): boolean {
    const [ax0, ay0, ax1, ay1] = box(a);
    const [bx0, by0, bx1, by1] = box(b);
    return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

function mean(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}
