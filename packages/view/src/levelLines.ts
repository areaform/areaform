import type { AreaformDocument, Level, Shape, Vec2 } from '@areaform/core';

/** A Level's lines as SVG path data, y up like the plan (every y negated), one path per kind. */
export interface LevelLines {
    /** `minX minY width height` in metres, around the outline, or what the Level has without one. */
    viewBox: [number, number, number, number];
    outline: string;
    zones: string;
    /** Columns and the like. */
    obstacles: string;
    /** Stairs, lifts and ramps where they stop on this Level. */
    stops: string;
    walls: string;
}

/**
 * The lines of a Level for a quick drawing without the renderer: `embed.js`'s loader draws them while
 * the plan loads, the web app as a small sketch of each Space. Fitted as the 2D renderer fits a
 * Level, to its outline, else to its Walls and Zones; `null` for an empty Level.
 */
export function levelLines(doc: AreaformDocument, level: Level): LevelLines | null {
    const points: Vec2[] = level.outline.outer.length
        ? level.outline.outer
        : [...level.wallNodes.map((n) => n.position), ...level.zones.flatMap((z) => z.shape.outer)];
    if (points.length === 0) return null;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
    ];
    const at = (p: Vec2) => `${p[0]} ${-p[1]}`;
    const ring = (r: Vec2[]) => (r.length ? `M${r.map(at).join('L')}Z` : '');
    const shapes = (list: Shape[]) => list.map((shape) => ring(shape.outer)).join('');
    const nodes = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const stops = doc.connections.flatMap((c) => c.stops.filter((s) => s.levelId === level.id));
    return {
        viewBox: [minX, -maxY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1)],
        outline: ring(level.outline.outer),
        zones: shapes(level.zones.map((z) => z.shape)),
        obstacles: shapes(level.obstacles.map((o) => o.shape)),
        stops: shapes(stops.map((s) => s.shape)),
        walls: level.walls
            .map((wall) => {
                const a = nodes.get(wall.a);
                const b = nodes.get(wall.b);
                return a && b ? `M${at(a)}L${at(b)}` : '';
            })
            .join(''),
    };
}
