import type { ElementRef, Id, Level, Ring, Vec2 } from '@areaform/core';

export interface SnapContext {
    level: Level;
    grid: { step: number; snap: boolean };
    /** How close counts as "on" a node, vertex or edge, metres (screen pixels ÷ zoom). */
    tolerance: number;
    /** The previous point of the shape being drawn, for angle snapping. */
    anchor?: Vec2;
    /** Wall Nodes to ignore, e.g. the ones being dragged. */
    exclude?: Set<Id>;
    /** Alt held: no snapping at all. */
    bypass?: boolean;
}

export type SnapKind = 'node' | 'vertex' | 'edge' | 'grid' | 'angle' | 'none';

export interface SnapResult {
    point: Vec2;
    kind: SnapKind;
    /** What was snapped to, for node, vertex and edge snaps. */
    ref?: ElementRef;
}

const ANGLE_STEP = Math.PI / 12; // 15°

/** Priority: Wall Node → vertex → edge → grid → angle (grid off, with an anchor) → none. */
export function snap(point: Vec2, ctx: SnapContext): SnapResult {
    if (ctx.bypass) return { point, kind: 'none' };
    const tiers = [nodeCandidates, vertexCandidates, edgeCandidates];
    for (const candidates of tiers) {
        const hit = nearest(point, candidates(point, ctx), ctx.tolerance);
        if (hit) return hit;
    }

    if (ctx.grid.snap && ctx.grid.step > 0) {
        const step = ctx.grid.step;
        return { point: [roundTo(point[0], step), roundTo(point[1], step)], kind: 'grid' };
    }

    if (ctx.anchor) {
        const [ax, ay] = ctx.anchor;
        const length = dist(point, ctx.anchor);
        const angle =
            Math.round(Math.atan2(point[1] - ay, point[0] - ax) / ANGLE_STEP) * ANGLE_STEP;
        return {
            point: [ax + length * Math.cos(angle), ay + length * Math.sin(angle)],
            kind: 'angle',
        };
    }

    return { point, kind: 'none' };
}

function nearest(point: Vec2, candidates: SnapResult[], tolerance: number): SnapResult | null {
    let best: SnapResult | null = null;
    let bestDistance = tolerance;
    for (const candidate of candidates) {
        const d = dist(point, candidate.point);
        if (d <= bestDistance) {
            best = candidate;
            bestDistance = d;
        }
    }
    return best;
}

function nodeCandidates(_point: Vec2, { level, exclude }: SnapContext): SnapResult[] {
    return level.wallNodes
        .filter((node) => !exclude?.has(node.id))
        .map((node) => ({
            point: node.position,
            kind: 'node' as const,
            ref: { kind: 'wallNode' as const, id: node.id, levelId: level.id },
        }));
}

function vertexCandidates(_point: Vec2, { level }: SnapContext): SnapResult[] {
    return shapes(level).flatMap(({ ref, rings }) =>
        rings.flat().map((vertex) => ({ point: vertex, kind: 'vertex' as const, ref })),
    );
}

function edgeCandidates(point: Vec2, { level, exclude }: SnapContext): SnapResult[] {
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const walls = level.walls.flatMap((wall): SnapResult[] => {
        const a = positions.get(wall.a);
        const b = positions.get(wall.b);
        if (!a || !b || exclude?.has(wall.a) || exclude?.has(wall.b)) return [];
        return [
            {
                point: project(point, a, b),
                kind: 'edge',
                ref: { kind: 'wall', id: wall.id, levelId: level.id },
            },
        ];
    });
    const rings = shapes(level).flatMap(({ ref, rings }) =>
        rings.flatMap((ring) =>
            ring.map((a, i) => ({
                point: project(point, a, ring[(i + 1) % ring.length]!),
                kind: 'edge' as const,
                ref,
            })),
        ),
    );
    return [...walls, ...rings];
}

function shapes(level: Level): { ref: ElementRef; rings: Ring[] }[] {
    const levelId = level.id;
    const rings = (shape: { outer: Ring; holes?: Ring[] }) => [shape.outer, ...(shape.holes ?? [])];
    return [
        { ref: { kind: 'level', id: levelId }, rings: rings(level.outline) },
        ...level.zones.map((z) => ({
            ref: { kind: 'zone' as const, id: z.id, levelId },
            rings: rings(z.shape),
        })),
        ...level.obstacles.map((o) => ({
            ref: { kind: 'obstacle' as const, id: o.id, levelId },
            rings: rings(o.shape),
        })),
    ];
}

/** Rounds to the step, avoiding floating noise such as 6.500000001. */
function roundTo(value: number, step: number): number {
    return Number((Math.round(value / step) * step).toFixed(9));
}

function dist(p: Vec2, q: Vec2): number {
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/** The point of segment a–b closest to p. */
function project(p: Vec2, a: Vec2, b: Vec2): Vec2 {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t =
        lengthSq === 0
            ? 0
            : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return [a[0] + t * dx, a[1] + t * dy];
}
