import {
    containsPoint,
    resolveOpening,
    underlayCorners,
    zoneAt,
    type ElementRef,
    type AreaformDocument,
    type Id,
    type Vec2,
} from '@areaform/core';

/**
 * What a pointer at `point` (plan metres) lands on, or null for background. `tolerance` is in
 * metres (screen pixels ÷ zoom). Priority: Opening → Wall Node → Wall → Stop → Obstacle → Zone →
 * unlocked Underlay (only when its image size is known);
 * within a kind, the topmost (last drawn) wins.
 */
export function hitTest(
    doc: AreaformDocument,
    levelId: Id,
    point: Vec2,
    tolerance: number,
): ElementRef | null {
    const level = doc.levels.find((l) => l.id === levelId);
    if (!level) return null;
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const thickness = new Map(level.walls.map((w) => [w.id, w.thickness]));

    const opening = level.openings.findLast((o) => {
        const placement = resolveOpening(level, o);
        if (!placement) return false;
        const [along, across] = toLocal(point, placement.position, placement.angle);
        const depth = o.host === 'wall' ? (thickness.get(o.wallId) ?? 0) : 0;
        return Math.abs(along) <= o.width / 2 && Math.abs(across) <= depth / 2 + tolerance;
    });
    if (opening) return { kind: 'opening', id: opening.id, levelId };

    const node = level.wallNodes.findLast((n) => distance(point, n.position) <= tolerance);
    if (node) return { kind: 'wallNode', id: node.id, levelId };

    const wall = level.walls.findLast((w) => {
        const a = positions.get(w.a);
        const b = positions.get(w.b);
        return a && b && segmentDistance(point, a, b) <= w.thickness / 2 + tolerance;
    });
    if (wall) return { kind: 'wall', id: wall.id, levelId };

    const connection = doc.connections.findLast((c) =>
        c.stops.some((s) => s.levelId === levelId && containsPoint(s.shape, point)),
    );
    if (connection) return { kind: 'stop', id: connection.id, levelId };

    const obstacle = level.obstacles.findLast((o) => containsPoint(o.shape, point));
    if (obstacle) return { kind: 'obstacle', id: obstacle.id, levelId };

    const zone = zoneAt(level, point);
    if (zone) return { kind: 'zone', id: zone.id, levelId };

    const underlay = level.underlays.findLast((u) => {
        const corners = !u.locked && underlayCorners(u);
        return corners && containsPoint({ outer: corners }, point);
    });
    if (underlay) return { kind: 'underlay', id: underlay.id, levelId };

    return null;
}

/** `point` in the frame of a placement: [along its direction, across it]. */
function toLocal(point: Vec2, origin: Vec2, angle: number): Vec2 {
    const dx = point[0] - origin[0];
    const dy = point[1] - origin[1];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

function distance(p: Vec2, q: Vec2): number {
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t =
        lengthSq === 0
            ? 0
            : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}
