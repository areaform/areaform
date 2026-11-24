// The footprint of each Wall, shared by every renderer so 2D and 3D join Walls the same way.
import type { Id, Level, Shape, Vec2, Wall } from '../model.ts';

/** How far a mitre may reach from its Wall Node, in half-thicknesses, before it is cut square. */
const MITRE_LIMIT = 4;

/** One Wall's end at a Wall Node: `u` points from the node into the Wall. */
interface WallEnd {
    wall: Wall;
    u: Vec2;
    half: number;
    angle: number;
}

/** Where one Wall end's edges stop: left and right as seen from the node looking along `u`. */
interface EndCorners {
    left: Vec2;
    right: Vec2;
    /** The node itself, where three or more Walls meet: the pieces then fill the junction. */
    tip?: Vec2;
}

/**
 * Each Wall's outline with mitred joins. At a Wall Node the meeting Walls are taken in angular
 * order, and each Wall's edges stop where they cross the facing edges of its neighbours on either
 * side: two Walls meet on a diagonal, three or more fill the junction between them, collinear
 * Walls meet flush, and a free end is square. A mitre that would reach too far (a very sharp
 * corner) is cut square instead. Walls with a missing Wall Node or no length are left out.
 */
export function wallOutlines(level: Level): Map<Id, Shape> {
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const endsAt = new Map<Id, WallEnd[]>();
    const addEnd = (node: Id, end: WallEnd) => {
        const list = endsAt.get(node);
        if (list) list.push(end);
        else endsAt.set(node, [end]);
    };
    for (const wall of level.walls) {
        const a = positions.get(wall.a);
        const b = positions.get(wall.b);
        if (!a || !b) continue;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length === 0) continue;
        const d: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        const half = wall.thickness / 2;
        addEnd(wall.a, { wall, u: d, half, angle: Math.atan2(d[1], d[0]) });
        addEnd(wall.b, { wall, u: [-d[0], -d[1]], half, angle: Math.atan2(-d[1], -d[0]) });
    }

    // Corners per Wall end, keyed by `${wallId}:${nodeId}`.
    const corners = new Map<string, EndCorners>();
    for (const [nodeId, ends] of endsAt) {
        const node = positions.get(nodeId)!;
        ends.sort((x, y) => x.angle - y.angle);
        ends.forEach((end, i) => {
            const edge = (e: WallEnd, side: 1 | -1): Vec2 => {
                const [nx, ny] = [-e.u[1], e.u[0]]; // left of `u`
                return [node[0] + nx * e.half * side, node[1] + ny * e.half * side];
            };
            const square = { left: edge(end, 1), right: edge(end, -1) };
            if (ends.length === 1) {
                corners.set(`${end.wall.id}:${nodeId}`, square);
                return;
            }
            const next = ends[(i + 1) % ends.length]!; // counter-clockwise neighbour
            const prev = ends[(i - 1 + ends.length) % ends.length]!; // clockwise neighbour
            const mitre = (side: 1 | -1, other: WallEnd): Vec2 => {
                const point = meet(
                    edge(end, side),
                    end.u,
                    edge(other, side === 1 ? -1 : 1),
                    other.u,
                );
                const limit = MITRE_LIMIT * Math.max(end.half, other.half);
                const tooFar = point && Math.hypot(point[0] - node[0], point[1] - node[1]) > limit;
                return point && !tooFar ? point : side === 1 ? square.left : square.right;
            };
            corners.set(`${end.wall.id}:${nodeId}`, {
                left: mitre(1, next),
                right: mitre(-1, prev),
                ...(ends.length >= 3 && { tip: node }),
            });
        });
    }

    const shapes = new Map<Id, Shape>();
    for (const wall of level.walls) {
        const atA = corners.get(`${wall.id}:${wall.a}`);
        const atB = corners.get(`${wall.id}:${wall.b}`);
        if (!atA || !atB) continue;
        // Counter-clockwise along the Wall: its right side from a to b, then back on its left.
        // At `a` the Wall's right is the end's right; at `b`, looking back, the sides swap.
        shapes.set(wall.id, {
            outer: [
                atA.right,
                atB.left,
                ...(atB.tip ? [atB.tip] : []),
                atB.right,
                atA.left,
                ...(atA.tip ? [atA.tip] : []),
            ],
        });
    }
    return shapes;
}

/** Where the lines p + t·u and q + s·v cross, or null when they are parallel. */
function meet(p: Vec2, u: Vec2, q: Vec2, v: Vec2): Vec2 | null {
    const cross = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(cross) < 1e-9) return null;
    const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / cross;
    return [p[0] + u[0] * t, p[1] + u[1] * t];
}
