// An Inner Space laid into the outer Space it is shown in (Inner Space, CONTEXT.md): every point of its
// Document turned and moved by the Zone's `fit`, so the shop's plan lies on its unit in the
// centre's coordinates. Both are in metres, so nothing is scaled, and a turn and a move keep each
// ring's winding (ADR-0002).
import type { AreaformDocument, InnerSpaceFit, Level, Shape, Vec2 } from '../model.ts';
import { boundingBox, distance, locateInShape } from './geometry.ts';
import { resolveOpening } from './queries.ts';

/** Where `fit` puts the point `p` of the Inner Space: turned by `rotation`, then moved. */
export function placePoint(p: Vec2, fit: InnerSpaceFit): Vec2 {
    const cos = Math.cos(fit.rotation);
    const sin = Math.sin(fit.rotation);
    return [p[0] * cos - p[1] * sin + fit.x, p[0] * sin + p[1] * cos + fit.y];
}

/** A compass bearing, degrees clockwise from +Y, after the plan turns `rotation` radians CCW. */
function placeBearing(bearing: number, rotation: number): number {
    const turned = bearing - (rotation * 180) / Math.PI;
    return ((turned % 360) + 360) % 360;
}

/**
 * The Document with every position laid in by `fit`: Level outlines, Wall Nodes, free Openings,
 * Zones, Obstacles, Underlays, Viewpoints and Connection Stops. Ids, names and data stay, so a
 * Zone of the placed plan is the Zone of the shop's own. Openings in a Wall follow their Wall.
 */
export function placeDocument(doc: AreaformDocument, fit: InnerSpaceFit): AreaformDocument {
    const at = (p: Vec2) => placePoint(p, fit);
    const shape = (s: Shape): Shape => ({
        ...s,
        outer: s.outer.map(at),
        ...(s.holes && { holes: s.holes.map((ring) => ring.map(at)) }),
    });
    const level = (l: Level): Level => ({
        ...l,
        outline: shape(l.outline),
        wallNodes: l.wallNodes.map((n) => ({ ...n, position: at(n.position) })),
        openings: l.openings.map((o) =>
            o.host === 'free'
                ? { ...o, position: at(o.position), angle: o.angle + fit.rotation }
                : o,
        ),
        zones: l.zones.map((z) => ({
            ...z,
            shape: shape(z.shape),
            ...(z.labelAnchor && { labelAnchor: at(z.labelAnchor) }),
        })),
        obstacles: l.obstacles.map((o) => ({ ...o, shape: shape(o.shape) })),
        underlays: l.underlays.map((u) => ({
            ...u,
            position: at(u.position),
            rotation: u.rotation + fit.rotation,
        })),
        ...(l.viewpoints && {
            viewpoints: l.viewpoints.map((v) => ({
                ...v,
                target: at(v.target),
                bearing: placeBearing(v.bearing, fit.rotation),
            })),
        }),
    });
    return {
        ...doc,
        levels: doc.levels.map(level),
        connections: doc.connections.map((c) => ({
            ...c,
            stops: c.stops.map((s) => ({
                ...s,
                shape: shape(s.shape),
                ...(s.entry && { entry: at(s.entry) }),
            })),
        })),
    };
}

/** The Level a shop's plan is fitted by: the one at elevation 0, its ground floor, else the lowest. */
function groundOf(doc: AreaformDocument): Level {
    return (
        doc.levels.find((l) => l.elevation === 0) ??
        doc.levels.reduce((low, l) => (l.elevation < low.elevation ? l : low))
    );
}

/** How far an Inner Space may reach past its unit, metres: a wall's width, drawn either way. */
export const FIT_TOLERANCE = 0.3;

/** The distance from `p` to the nearest edge of `shape`, metres. */
function toEdge(p: Vec2, shape: Shape): number {
    let nearest = Infinity;
    for (const ring of [shape.outer, ...(shape.holes ?? [])])
        ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length]!;
            const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
            const length = dx * dx + dy * dy;
            const t =
                length === 0
                    ? 0
                    : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
            nearest = Math.min(nearest, distance(p, [a[0] + t * dx, a[1] + t * dy]));
        });
    return nearest;
}

/**
 * Whether the Inner Space, laid in by `fit`, lies in its unit: every corner of its ground floor's
 * Outline inside `unit`, or at most `FIT_TOLERANCE` past its edge. False once the shop's plan
 * changed shape and no longer fits, a Problem for the centre's owner (Inner Space, CONTEXT.md).
 */
export function fitsUnit(unit: Shape, inner: AreaformDocument, fit: InnerSpaceFit): boolean {
    return groundOf(inner).outline.outer.every((corner) => {
        const p = placePoint(corner, fit);
        return locateInShape(p, unit) !== 'outside' || toEdge(p, unit) <= FIT_TOLERANCE;
    });
}

/**
 * A first fit of the Inner Space into its unit: its ground floor turned a quarter at a time until
 * its long side runs as the unit's, and centred on it. **Fit to the unit** starts from it; the
 * owner corrects it where the shop's plan is not drawn square to the unit.
 */
export function fitToUnit(unit: Shape, inner: AreaformDocument): InnerSpaceFit {
    const u = boundingBox(unit.outer);
    const i = boundingBox(groundOf(inner).outline.outer);
    const [uw, uh] = [u.maxX - u.minX, u.maxY - u.minY];
    const [iw, ih] = [i.maxX - i.minX, i.maxY - i.minY];
    // A quarter turn swaps the sides; with a square either way, the plan is left as drawn.
    const turned = Math.abs(ih - uw) + Math.abs(iw - uh) < Math.abs(iw - uw) + Math.abs(ih - uh);
    const rotation = turned ? Math.PI / 2 : 0;
    const middle: Vec2 = [(i.minX + i.maxX) / 2, (i.minY + i.maxY) / 2];
    const at = placePoint(middle, { x: 0, y: 0, rotation });
    return { x: (u.minX + u.maxX) / 2 - at[0], y: (u.minY + u.maxY) / 2 - at[1], rotation };
}

/** How far an Opening's middle may be from the shop's Outline and still be a way in, metres. */
const ON_OUTLINE = 0.3;
/** The thickness of the walls drawn along a shop's Outline for routing, metres. */
const OUTLINE_WALL = 0.1;

/**
 * The shop's Outline as walls, open only where an Opening stands on it, its ways in: so a route
 * goes in through the shop's entrance, even where the shop drew no wall of its own.
 */
function outlineWalls(level: Level, prefix: (id: string) => string) {
    const gaps = level.openings.flatMap((opening) => {
        const at = resolveOpening(level, opening);
        return at ? [{ at: at.position, half: opening.width / 2 }] : [];
    });
    const wallNodes: Level['wallNodes'] = [];
    const walls: Level['walls'] = [];
    const ring = level.outline.outer;
    ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        const length = distance(a, b);
        if (length === 0) return;
        const along = (p: Vec2) =>
            ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length;
        // The ways in on this side, as stretches along it, in order.
        const open = gaps
            .filter(({ at }) => {
                const t = along(at);
                const foot: Vec2 = [
                    a[0] + ((b[0] - a[0]) * t) / length,
                    a[1] + ((b[1] - a[1]) * t) / length,
                ];
                return t > 0 && t < length && distance(foot, at) <= ON_OUTLINE;
            })
            .map(({ at, half }) => [along(at) - half, along(at) + half] as const)
            .sort((x, y) => x[0] - y[0]);
        let from = 0;
        const point = (t: number): Vec2 => [
            a[0] + ((b[0] - a[0]) * t) / length,
            a[1] + ((b[1] - a[1]) * t) / length,
        ];
        const wall = (t0: number, t1: number) => {
            if (t1 - t0 <= 1e-6) return;
            const n = wallNodes.length;
            wallNodes.push(
                { id: prefix(`outline-${n}`), position: point(t0) },
                { id: prefix(`outline-${n + 1}`), position: point(t1) },
            );
            walls.push({
                id: prefix(`outline-wall-${n}`),
                a: prefix(`outline-${n}`),
                b: prefix(`outline-${n + 1}`),
                thickness: OUTLINE_WALL,
            });
        };
        for (const [start, end] of open) {
            wall(from, Math.max(from, start));
            from = Math.max(from, end);
        }
        wall(from, length);
    });
    return { wallNodes, walls };
}

/**
 * The outer Document with an Inner Space's ground floor laid into its unit, for one route from
 * the outer Space through the shop's entrance to a place inside it (a Through route, CONTEXT.md).
 * `placed` is the Inner Space already laid in by its fit (`placeDocument`). Its Walls, Openings,
 * Zones and Obstacles join the unit's Level under ids prefixed with the unit's
 * (`unit-g06/watches`); its Outline becomes walls, open where its Openings stand on it; its own
 * stairs and lifts block the way, as their Stops; and the unit is no longer walked around, so a
 * route goes in through the shop's entrance. For routing only: never shown or saved.
 */
export function withInnerSpace(
    outer: AreaformDocument,
    unit: { levelId: string; zoneId: string },
    placed: AreaformDocument,
): AreaformDocument {
    const inner = groundOf(placed);
    const prefix = (own: string) => `${unit.zoneId}/${own}`;
    const outline = outlineWalls(inner, prefix);
    const stops = placed.connections.flatMap((c) =>
        c.stops
            .filter((stop) => stop.levelId === inner.id)
            .map((stop, i) => ({
                id: prefix(`${c.id}-stop-${i}`),
                kind: 'other' as const,
                shape: stop.shape,
            })),
    );
    /** The outer Level's own list, then the shop's under its prefixed ids. */
    const joined = <T extends { id: string }>(own: T[], shop: T[], more: T[] = []) => [
        ...own,
        ...shop.map((item) => ({ ...item, id: prefix(item.id) })),
        ...more,
    ];
    return {
        ...outer,
        levels: outer.levels.map((level) =>
            level.id !== unit.levelId
                ? level
                : {
                      ...level,
                      wallNodes: joined(level.wallNodes, inner.wallNodes, outline.wallNodes),
                      walls: joined(
                          level.walls,
                          inner.walls.map((w) => ({ ...w, a: prefix(w.a), b: prefix(w.b) })),
                          outline.walls,
                      ),
                      openings: joined(
                          level.openings,
                          inner.openings.map((o) =>
                              o.host === 'wall' ? { ...o, wallId: prefix(o.wallId) } : o,
                          ),
                      ),
                      zones: joined(
                          level.zones.map((z) =>
                              z.id === unit.zoneId ? { ...z, walkAround: false } : z,
                          ),
                          inner.zones,
                      ),
                      obstacles: joined(level.obstacles, inner.obstacles, stops),
                  },
        ),
    };
}
