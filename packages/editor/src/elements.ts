// Turning a selection into Commands: moves and deletes for any mix of Elements.
import type {
    Command,
    ElementRef,
    AreaformDocument,
    Id,
    Level,
    Shape,
    Vec2,
    Wall,
} from '@areaform/core';
import { underlayCorners } from '@areaform/core';

export function findLevel(doc: AreaformDocument, levelId: Id): Level | undefined {
    return doc.levels.find((l) => l.id === levelId);
}

/** Whether the Element a ref points at still exists. */
export function exists(doc: AreaformDocument, ref: ElementRef): boolean {
    if (ref.kind === 'level') return doc.levels.some((l) => l.id === ref.id);
    if (ref.kind === 'connection') return doc.connections.some((c) => c.id === ref.id);
    if (ref.kind === 'stop') {
        return doc.connections.some(
            (c) => c.id === ref.id && c.stops.some((s) => s.levelId === ref.levelId),
        );
    }
    const level = findLevel(doc, ref.levelId);
    if (!level) return false;
    const lists = {
        wallNode: level.wallNodes,
        wall: level.walls,
        opening: level.openings,
        zone: level.zones,
        obstacle: level.obstacles,
        underlay: level.underlays,
    };
    return lists[ref.kind].some((e) => e.id === ref.id);
}

export const sameRef = (a: ElementRef, b: ElementRef) =>
    a.kind === b.kind &&
    a.id === b.id &&
    ('levelId' in a ? a.levelId : '') === ('levelId' in b ? b.levelId : '');

const translateShape = (shape: Shape, [dx, dy]: Vec2): Shape => {
    const move = (ring: Vec2[]) => ring.map(([x, y]): Vec2 => [x + dx, y + dy]);
    return {
        ...shape,
        outer: move(shape.outer),
        ...(shape.holes && { holes: shape.holes.map(move) }),
    };
};

/** One Command moving every selected Element by `delta` metres; null when nothing can move. */
export function moveCommand(
    doc: AreaformDocument,
    levelId: Id,
    refs: ElementRef[],
    delta: Vec2,
): Command | null {
    const level = findLevel(doc, levelId);
    if (!level) return null;
    const commands: Command[] = [];
    const nodes = new Set<Id>();
    const movedWalls = new Set<Id>();

    for (const ref of refs) {
        if (ref.kind === 'wallNode') nodes.add(ref.id);
        if (ref.kind === 'wall') {
            const wall = level.walls.find((w) => w.id === ref.id);
            if (wall) {
                nodes.add(wall.a);
                nodes.add(wall.b);
                movedWalls.add(wall.id);
            }
        }
    }
    for (const id of nodes) {
        const node = level.wallNodes.find((n) => n.id === id);
        if (node) {
            commands.push({
                type: 'wallNode.move',
                levelId,
                nodeId: id,
                to: [node.position[0] + delta[0], node.position[1] + delta[1]],
            });
        }
    }

    for (const ref of refs) {
        switch (ref.kind) {
            case 'zone': {
                const zone = level.zones.find((z) => z.id === ref.id);
                if (zone)
                    commands.push({
                        type: 'zone.update',
                        levelId,
                        zoneId: zone.id,
                        changes: { shape: translateShape(zone.shape, delta) },
                    });
                break;
            }
            case 'obstacle': {
                const obstacle = level.obstacles.find((o) => o.id === ref.id);
                if (obstacle)
                    commands.push({
                        type: 'obstacle.update',
                        levelId,
                        obstacleId: obstacle.id,
                        changes: { shape: translateShape(obstacle.shape, delta) },
                    });
                break;
            }
            case 'underlay': {
                const underlay = level.underlays.find((u) => u.id === ref.id);
                if (underlay && !underlay.locked) {
                    const [x, y] = underlay.position;
                    commands.push({
                        type: 'underlay.update',
                        levelId,
                        underlayId: underlay.id,
                        changes: { position: [x + delta[0], y + delta[1]] },
                    });
                }
                break;
            }
            case 'opening': {
                const opening = level.openings.find((o) => o.id === ref.id);
                if (!opening) break;
                if (opening.host === 'free') {
                    const [x, y] = opening.position;
                    commands.push({
                        type: 'opening.update',
                        levelId,
                        openingId: opening.id,
                        changes: { position: [x + delta[0], y + delta[1]] },
                    });
                } else if (!movedWalls.has(opening.wallId)) {
                    commands.push(
                        ...slideOpening(
                            level,
                            opening.id,
                            opening.wallId,
                            opening.offset,
                            opening.width,
                            delta,
                            levelId,
                        ),
                    );
                }
                break;
            }
            case 'stop': {
                const connection = doc.connections.find((c) => c.id === ref.id);
                if (connection) {
                    const stops = connection.stops.map((s) =>
                        s.levelId === levelId ? { ...s, shape: translateShape(s.shape, delta) } : s,
                    );
                    commands.push({
                        type: 'connection.update',
                        connectionId: connection.id,
                        changes: { stops },
                    });
                }
                break;
            }
            default:
                break;
        }
    }
    return commands.length > 0 ? { type: 'batch', commands } : null;
}

/** A hosted Opening moves along its Wall by the part of `delta` parallel to it. */
function slideOpening(
    level: Level,
    openingId: Id,
    wallId: Id,
    offset: number,
    width: number,
    delta: Vec2,
    levelId: Id,
): Command[] {
    const wall = level.walls.find((w) => w.id === wallId);
    const a = wall && level.wallNodes.find((n) => n.id === wall.a)?.position;
    const b = wall && level.wallNodes.find((n) => n.id === wall.b)?.position;
    if (!a || !b) return [];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = (delta[0] * (b[0] - a[0]) + delta[1] * (b[1] - a[1])) / length;
    const next = Math.min(length - width / 2, Math.max(width / 2, offset + along));
    return [{ type: 'opening.update', levelId, openingId, changes: { offset: next } }];
}

/**
 * One Command deleting every selected Element. Openings go first so that deleting their Wall in
 * the same batch does not leave them to fail; a Wall Node deletes the Walls that meet there.
 */
export function deleteCommand(
    doc: AreaformDocument,
    levelId: Id,
    refs: ElementRef[],
): Command | null {
    const level = findLevel(doc, levelId);
    if (!level) return null;
    const walls = new Set<Id>();
    const commands: Command[] = [];
    const deletedOpenings = new Set<Id>();

    for (const ref of refs) {
        if (ref.kind === 'wall') walls.add(ref.id);
        if (ref.kind === 'wallNode') {
            for (const wall of level.walls)
                if (wall.a === ref.id || wall.b === ref.id) walls.add(wall.id);
        }
    }
    for (const ref of refs) {
        switch (ref.kind) {
            case 'opening':
                commands.push({ type: 'opening.delete', levelId, openingId: ref.id });
                deletedOpenings.add(ref.id);
                break;
            case 'zone':
                commands.push({ type: 'zone.delete', levelId, zoneId: ref.id });
                break;
            case 'obstacle':
                commands.push({ type: 'obstacle.delete', levelId, obstacleId: ref.id });
                break;
            case 'underlay':
                commands.push({ type: 'underlay.delete', levelId, underlayId: ref.id });
                break;
            case 'stop':
            case 'connection':
                commands.push({ type: 'connection.delete', connectionId: ref.id });
                break;
            default:
                break;
        }
    }
    for (const id of walls) commands.push({ type: 'wall.delete', levelId, wallId: id });
    return commands.length > 0 ? { type: 'batch', commands } : null;
}

/** Elements of a Level lying entirely inside an axis-aligned box. */
export function refsInBox(level: Level, a: Vec2, b: Vec2): ElementRef[] {
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    const inside = ([x, y]: Vec2) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const levelId = level.id;
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    return [
        ...level.zones
            .filter((z) => z.shape.outer.every(inside))
            .map((z) => ({ kind: 'zone' as const, id: z.id, levelId })),
        ...level.obstacles
            .filter((o) => o.shape.outer.every(inside))
            .map((o) => ({ kind: 'obstacle' as const, id: o.id, levelId })),
        ...level.walls
            .filter((w) =>
                [w.a, w.b].every((id) => {
                    const p = positions.get(id);
                    return p !== undefined && inside(p);
                }),
            )
            .map((w) => ({ kind: 'wall' as const, id: w.id, levelId })),
    ];
}

/**
 * Sets a Wall's centre-line length by moving one end along the Wall: the far end (`b`), unless
 * only `b` is joined to other Walls, in which case the free end `a` moves so the joint stays put.
 * Walls joined at the moved end follow it. Undefined for a length that is not positive.
 */
export function wallLengthCommand(level: Level, wallId: Id, length: number): Command | undefined {
    const wall = level.walls.find((w) => w.id === wallId);
    if (!wall || !(length > 0)) return undefined;
    const position = (id: Id) => level.wallNodes.find((n) => n.id === id)?.position;
    const joined = (id: Id) =>
        level.walls.some((w) => w.id !== wallId && (w.a === id || w.b === id));
    const moveA = joined(wall.b) && !joined(wall.a);
    const [fixedId, movedId] = moveA ? [wall.b, wall.a] : [wall.a, wall.b];
    const fixed = position(fixedId);
    const moved = position(movedId);
    if (!fixed || !moved) return undefined;
    const current = Math.hypot(moved[0] - fixed[0], moved[1] - fixed[1]);
    if (current === 0) return undefined;
    const round = (v: number) => Number(v.toFixed(9));
    const to: Vec2 = [
        round(fixed[0] + ((moved[0] - fixed[0]) / current) * length),
        round(fixed[1] + ((moved[1] - fixed[1]) / current) * length),
    ];
    return { type: 'wallNode.move', levelId: level.id, nodeId: movedId, to };
}

/** Rotates `p` about `pivot` by `angle` radians CCW; quarter turns are exact (no float noise). */
export function rotatePoint([x, y]: Vec2, [px, py]: Vec2, angle: number): Vec2 {
    const quarter = angle / (Math.PI / 2);
    const exact = Math.abs(quarter - Math.round(quarter)) < 1e-12;
    const turns = ((Math.round(quarter) % 4) + 4) % 4;
    const cos = exact ? [1, 0, -1, 0][turns]! : Math.cos(angle);
    const sin = exact ? [0, 1, 0, -1][turns]! : Math.sin(angle);
    const dx = x - px;
    const dy = y - py;
    return [px + dx * cos - dy * sin, py + dx * sin + dy * cos];
}

/** Every point that defines the selected Elements, for framing and rotation pivots. */
export function selectionPoints(doc: AreaformDocument, levelId: Id, refs: ElementRef[]): Vec2[] {
    const level = findLevel(doc, levelId);
    if (!level) return [];
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const points: Vec2[] = [];
    for (const ref of refs) {
        switch (ref.kind) {
            case 'zone':
                points.push(...(level.zones.find((z) => z.id === ref.id)?.shape.outer ?? []));
                break;
            case 'obstacle':
                points.push(...(level.obstacles.find((o) => o.id === ref.id)?.shape.outer ?? []));
                break;
            case 'wall': {
                const wall = level.walls.find((w) => w.id === ref.id);
                for (const id of wall ? [wall.a, wall.b] : []) {
                    const p = positions.get(id);
                    if (p) points.push(p);
                }
                break;
            }
            case 'wallNode': {
                const p = positions.get(ref.id);
                if (p) points.push(p);
                break;
            }
            case 'opening': {
                const opening = level.openings.find((o) => o.id === ref.id);
                if (opening?.host === 'free') points.push(opening.position);
                break;
            }
            case 'underlay': {
                const underlay = level.underlays.find((u) => u.id === ref.id);
                points.push(...((underlay && underlayCorners(underlay)) ?? []));
                break;
            }
            case 'stop':
                points.push(
                    ...(doc.connections
                        .find((c) => c.id === ref.id)
                        ?.stops.find((s) => s.levelId === levelId)?.shape.outer ?? []),
                );
                break;
            default:
                break;
        }
    }
    return points;
}

/** One Command turning every selected Element by `angle` radians CCW about `pivot` (Q37). */
export function rotateCommand(
    doc: AreaformDocument,
    levelId: Id,
    refs: ElementRef[],
    pivot: Vec2,
    angle: number,
): Command | null {
    const level = findLevel(doc, levelId);
    if (!level) return null;
    const turn = (p: Vec2) => rotatePoint(p, pivot, angle);
    const turnShape = (shape: Shape): Shape => ({
        ...shape,
        outer: shape.outer.map(turn),
        ...(shape.holes && { holes: shape.holes.map((h) => h.map(turn)) }),
    });
    const commands: Command[] = [];
    const nodes = new Set<Id>();

    for (const ref of refs) {
        switch (ref.kind) {
            case 'wallNode':
                nodes.add(ref.id);
                break;
            case 'wall': {
                const wall = level.walls.find((w) => w.id === ref.id);
                if (wall) {
                    nodes.add(wall.a);
                    nodes.add(wall.b);
                }
                break;
            }
            case 'zone': {
                const zone = level.zones.find((z) => z.id === ref.id);
                if (zone) {
                    commands.push({
                        type: 'zone.update',
                        levelId,
                        zoneId: zone.id,
                        changes: {
                            shape: turnShape(zone.shape),
                            ...(zone.labelAnchor && { labelAnchor: turn(zone.labelAnchor) }),
                        },
                    });
                }
                break;
            }
            case 'obstacle': {
                const obstacle = level.obstacles.find((o) => o.id === ref.id);
                if (obstacle) {
                    commands.push({
                        type: 'obstacle.update',
                        levelId,
                        obstacleId: obstacle.id,
                        changes: { shape: turnShape(obstacle.shape) },
                    });
                }
                break;
            }
            case 'opening': {
                const opening = level.openings.find((o) => o.id === ref.id);
                if (opening?.host === 'free') {
                    commands.push({
                        type: 'opening.update',
                        levelId,
                        openingId: opening.id,
                        changes: { position: turn(opening.position), angle: opening.angle + angle },
                    });
                }
                break;
            }
            case 'stop': {
                const connection = doc.connections.find((c) => c.id === ref.id);
                if (connection) {
                    const stops = connection.stops.map((s) =>
                        s.levelId === levelId ? { ...s, shape: turnShape(s.shape) } : s,
                    );
                    commands.push({
                        type: 'connection.update',
                        connectionId: connection.id,
                        changes: { stops },
                    });
                }
                break;
            }
            case 'underlay': {
                const underlay = level.underlays.find((u) => u.id === ref.id);
                if (underlay && !underlay.locked) {
                    commands.push({
                        type: 'underlay.update',
                        levelId,
                        underlayId: underlay.id,
                        changes: {
                            position: turn(underlay.position),
                            rotation: underlay.rotation + angle,
                        },
                    });
                }
                break;
            }
            default:
                break;
        }
    }
    for (const id of nodes) {
        const node = level.wallNodes.find((n) => n.id === id);
        if (node)
            commands.push({ type: 'wallNode.move', levelId, nodeId: id, to: turn(node.position) });
    }
    return commands.length > 0 ? { type: 'batch', commands } : null;
}

/**
 * Commands turning each selected door the other way: `swing` opens it to the other side of its
 * Wall, `hinge` hangs it from the other jamb. Empty when no door is selected.
 */
export function flipDoorCommands(
    level: Level,
    refs: ElementRef[],
    part: 'hinge' | 'swing',
): Command[] {
    const ids = new Set(refs.filter((r) => r.kind === 'opening').map((r) => r.id));
    return level.openings.flatMap((opening): Command[] => {
        if (!ids.has(opening.id) || opening.kind !== 'door') return [];
        const changes =
            part === 'swing'
                ? { swing: opening.swing === 'right' ? ('left' as const) : ('right' as const) }
                : { hinge: opening.hinge === 'end' ? ('start' as const) : ('end' as const) };
        return [{ type: 'opening.update', levelId: level.id, openingId: opening.id, changes }];
    });
}

/**
 * The first Wall whose centre line passes through `point` (and that `skip` does not rule out),
 * and how far along it from its `a` node that is.
 */
export function wallAt(
    level: Level,
    point: Vec2,
    skip: (wall: Wall) => boolean = () => false,
): { wallId: Id; offset: number; length: number } | null {
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    for (const wall of level.walls) {
        const a = positions.get(wall.a);
        const b = positions.get(wall.b);
        if (a && b && !skip(wall) && onSegment(point, a, b))
            return {
                wallId: wall.id,
                offset: Math.hypot(point[0] - a[0], point[1] - a[1]),
                length: Math.hypot(b[0] - a[0], b[1] - a[1]),
            };
    }
    return null;
}

export function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dy);
    if (length === 0) return false;
    const cross = (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length;
    const along = (dx * (p[0] - a[0]) + dy * (p[1] - a[1])) / length;
    return Math.abs(cross) < 1e-6 && along >= -1e-6 && along <= length + 1e-6;
}
