import {
    collinearOverlap,
    distance,
    EPSILON,
    samePoint,
    segmentIntersection,
} from '../geometry/geometry.ts';
import { Rejection } from '../checks/invariants.ts';
import { newId } from '../ids.ts';
import type { AreaformDocument, Id, Level, Opening, Vec2, Wall, WallNode } from '../model.ts';
import { requireElement, updateElement, updateLevel, withChanges, type Changes } from './shared.ts';

/** A point to place a new Wall Node at, or an existing Wall Node. */
export type WallEnd = Vec2 | { nodeId: Id };

export interface WallAdd {
    type: 'wall.add';
    levelId: Id;
    id?: Id;
    a: WallEnd;
    b: WallEnd;
    thickness: number;
    height?: number;
}

export interface WallNodeMove {
    type: 'wallNode.move';
    levelId: Id;
    nodeId: Id;
    to: Vec2;
}

/**
 * Joins one Wall Node into another: its Walls end at `into` instead, and it goes. A Wall that
 * ran between the two goes too (with its Openings); one that now doubles another Wall is folded
 * into it, its Openings moving across.
 */
export interface WallNodeMerge {
    type: 'wallNode.merge';
    levelId: Id;
    nodeId: Id;
    into: Id;
}

/**
 * Splits a Wall at `offset` metres from its `a` node with a new Wall Node (id `nodeId` when
 * given). The first piece keeps the Wall's id; Openings stay on the piece holding their centre.
 */
export interface WallSplit {
    type: 'wall.split';
    levelId: Id;
    wallId: Id;
    offset: number;
    nodeId?: Id;
}

export interface WallDelete {
    type: 'wall.delete';
    levelId: Id;
    wallId: Id;
}

/** Changes to a Wall's own properties; its ends are changed by moving Wall Nodes. */
export interface WallUpdate {
    type: 'wall.update';
    levelId: Id;
    wallId: Id;
    changes: Changes<Pick<Wall, 'id' | 'thickness' | 'height'>>;
}

/**
 * Adds a Wall along every Outline edge (and hole edge, unless `holes` is false) that existing
 * Walls do not already cover. A one-shot generator: later Outline edits do not move the Walls.
 */
export interface WallsFromOutline {
    type: 'walls.fromOutline';
    levelId: Id;
    thickness: number;
    height?: number;
    holes?: boolean;
}

export type WallCommand =
    WallAdd | WallNodeMove | WallNodeMerge | WallSplit | WallUpdate | WallDelete | WallsFromOutline;

export function applyWallCommand(doc: AreaformDocument, command: WallCommand): AreaformDocument {
    switch (command.type) {
        case 'wall.add':
            return updateLevel(doc, command.levelId, (level) => wallAdd(level, command));
        case 'wallNode.move':
            return updateElement(doc, command.levelId, 'wallNodes', command.nodeId, (node) => ({
                ...node,
                position: command.to,
            }));
        case 'wallNode.merge':
            return updateLevel(doc, command.levelId, (level) => wallNodeMerge(level, command));
        case 'wall.split':
            return updateLevel(doc, command.levelId, (level) => wallSplit(level, command));
        case 'wall.update':
            return updateElement(doc, command.levelId, 'walls', command.wallId, (wall) =>
                withChanges(wall, command.changes as Changes<Wall>),
            );
        case 'wall.delete':
            return updateLevel(doc, command.levelId, (level) => wallDelete(level, command));
        case 'walls.fromOutline':
            return updateLevel(doc, command.levelId, (level) => wallsFromOutline(level, command));
    }
}

function wallsFromOutline(level: Level, command: WallsFromOutline): Level {
    const { outer, holes = [] } = level.outline;
    const rings = command.holes === false ? [outer] : [outer, ...holes];
    let next = level;
    for (const ring of rings) {
        ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length]!;
            if (covered(next, a, b)) return;
            next = wallAdd(next, {
                type: 'wall.add',
                levelId: level.id,
                a,
                b,
                thickness: command.thickness,
                ...(command.height !== undefined && { height: command.height }),
            });
        });
    }
    return next;
}

/** Whether existing Walls lying along segment a–b cover its whole length. */
function covered(level: Level, a: Vec2, b: Vec2): boolean {
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    let length = 0;
    for (const wall of level.walls) {
        const p = positions.get(wall.a);
        const q = positions.get(wall.b);
        if (p && q) length += collinearOverlap(a, b, p, q);
    }
    return length >= distance(a, b) - EPSILON;
}

/**
 * Adds a Wall, keeping the graph connected: an existing Wall that the new one ends on or crosses
 * is split at that point, and the new Wall is split wherever it passes through a junction.
 */
function wallAdd(level: Level, command: WallAdd): Level {
    const wallNodes = [...level.wallNodes];
    const positions = new Map(wallNodes.map((node) => [node.id, node.position]));
    const nodeAt = (point: Vec2): Id => {
        const existing = wallNodes.find((node) => samePoint(node.position, point));
        if (existing) return existing.id;
        const node: WallNode = { id: newId(), position: point };
        wallNodes.push(node);
        positions.set(node.id, point);
        return node.id;
    };

    const a = Array.isArray(command.a) ? nodeAt(command.a) : command.a.nodeId;
    const b = Array.isArray(command.b) ? nodeAt(command.b) : command.b.nodeId;
    const props = {
        thickness: command.thickness,
        ...(command.height !== undefined && { height: command.height }),
    };
    const firstId = command.id ?? newId();

    const pa = positions.get(a);
    const pb = positions.get(b);
    if (!pa || !pb || samePoint(pa, pb)) {
        // Invalid input; the Invariant check rejects it.
        return { ...level, wallNodes, walls: [...level.walls, { id: firstId, a, b, ...props }] };
    }

    const walls: Wall[] = [];
    let openings = level.openings;
    const cuts: { t: number; node: Id }[] = [];
    for (const wall of level.walls) {
        const p = positions.get(wall.a);
        const q = positions.get(wall.b);
        const hit = p && q && segmentIntersection(pa, pb, p, q);
        if (!hit) {
            walls.push(wall);
            continue;
        }
        const node = nodeAt(hit.point);
        if (node !== a && node !== b) cuts.push({ t: hit.t, node });
        if (node !== wall.a && node !== wall.b) {
            const tail: Wall = { ...wall, id: newId(), a: node };
            walls.push({ ...wall, b: node }, tail);
            openings = moveOpeningsPast(openings, wall.id, hit.u * distance(p, q), tail.id);
        } else {
            walls.push(wall);
        }
    }

    const through = [...new Set(cuts.sort((x, y) => x.t - y.t).map((cut) => cut.node))];
    const chain = [a, ...through, b];
    for (let i = 0; i < chain.length - 1; i++) {
        walls.push({ id: i === 0 ? firstId : newId(), a: chain[i]!, b: chain[i + 1]!, ...props });
    }
    return { ...level, wallNodes, walls, openings };
}

function wallNodeMerge(level: Level, { nodeId, into }: WallNodeMerge): Level {
    requireElement(level.wallNodes, nodeId);
    requireElement(level.wallNodes, into);
    if (nodeId === into) return level;
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const lengthOf = (wall: Wall) => distance(positions.get(wall.a)!, positions.get(wall.b)!);
    const rewire = (id: Id) => (id === nodeId ? into : id);

    const walls: Wall[] = [];
    const removed = new Set<Id>();
    /** Openings of a folded Wall, re-hosted on the Wall kept in its place. */
    const moved = new Map<Id, { wall: Wall; reversed: boolean; length: number }>();
    for (const wall of level.walls) {
        const next = { ...wall, a: rewire(wall.a), b: rewire(wall.b) };
        if (next.a === next.b) {
            removed.add(wall.id);
            continue;
        }
        const twin = walls.find(
            (w) => (w.a === next.a && w.b === next.b) || (w.a === next.b && w.b === next.a),
        );
        if (twin) {
            moved.set(wall.id, { wall: twin, reversed: twin.a !== next.a, length: lengthOf(twin) });
            continue;
        }
        walls.push(next.a === wall.a && next.b === wall.b ? wall : next);
    }
    const openings = level.openings.flatMap((opening): Opening[] => {
        if (opening.host !== 'wall') return [opening];
        if (removed.has(opening.wallId)) return [];
        const fold = moved.get(opening.wallId);
        if (!fold) return [opening];
        const offset = fold.reversed ? fold.length - opening.offset : opening.offset;
        return [{ ...opening, wallId: fold.wall.id, offset }];
    });
    const used = new Set(walls.flatMap((wall) => [wall.a, wall.b]));
    return {
        ...level,
        walls,
        openings,
        wallNodes: level.wallNodes.filter((node) => node.id !== nodeId && used.has(node.id)),
    };
}

function wallSplit(level: Level, { wallId, offset, nodeId }: WallSplit): Level {
    requireElement(level.walls, wallId);
    const wall = level.walls.find((w) => w.id === wallId)!;
    const a = level.wallNodes.find((n) => n.id === wall.a)?.position;
    const b = level.wallNodes.find((n) => n.id === wall.b)?.position;
    if (!a || !b) throw new Rejection([{ code: 'dangling-reference', id: wall.id, ref: wall.a }]);
    const length = distance(a, b);
    if (!(offset > EPSILON && offset < length - EPSILON)) {
        throw new Rejection([{ code: 'degenerate-wall', id: wall.id }]);
    }
    const t = offset / length;
    const node: WallNode = {
        id: nodeId ?? newId(),
        position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    };
    const tail: Wall = { ...wall, id: newId(), a: node.id };
    return {
        ...level,
        wallNodes: [...level.wallNodes, node],
        walls: level.walls.flatMap((w) => (w.id === wallId ? [{ ...w, b: node.id }, tail] : [w])),
        openings: moveOpeningsPast(level.openings, wallId, offset, tail.id),
    };
}

/** After a split at `at` metres along a Wall, Openings beyond that point move to the tail piece. */
function moveOpeningsPast(openings: Opening[], wallId: Id, at: number, tailId: Id): Opening[] {
    return openings.map((opening) =>
        opening.host === 'wall' && opening.wallId === wallId && opening.offset > at
            ? { ...opening, wallId: tailId, offset: opening.offset - at }
            : opening,
    );
}

/** Removes the Wall, its hosted Openings, and any Wall Node it leaves unused. */
function wallDelete(level: Level, { wallId }: WallDelete): Level {
    requireElement(level.walls, wallId);
    const walls = level.walls.filter((wall) => wall.id !== wallId);
    const used = new Set(walls.flatMap((wall) => [wall.a, wall.b]));
    return {
        ...level,
        walls,
        wallNodes: level.wallNodes.filter((node) => used.has(node.id)),
        openings: level.openings.filter(
            (opening) => opening.host !== 'wall' || opening.wallId !== wallId,
        ),
    };
}
