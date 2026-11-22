import { normalizeShape } from '../geometry.ts';
import { newId } from '../ids.ts';
import { Rejection } from '../invariants.ts';
import type { AreaformDocument, Id, Level, Shape } from '../model.ts';
import { updateLevel, withChanges, type Changes } from './shared.ts';

export interface LevelAdd {
    type: 'level.add';
    id?: Id;
    name: string;
    /** Level Group to add to; the new Level goes on top of that group's stack. */
    group?: string;
    /** `top` (default) stacks above the group's highest Level; `bottom` goes below its lowest (basements). */
    at?: 'top' | 'bottom';
    elevation?: number;
    height?: number;
}

export interface LevelSetOutline {
    type: 'level.setOutline';
    levelId: Id;
    outline: Shape;
}

export interface LevelDuplicate {
    type: 'level.duplicate';
    levelId: Id;
    id?: Id;
    name?: string;
}

export interface LevelUpdate {
    type: 'level.update';
    levelId: Id;
    changes: Changes<Pick<Level, 'id' | 'name' | 'names' | 'elevation' | 'height' | 'group'>>;
}

/** Swaps a Level with its neighbour above or below in the stack (within its Level Group). */
export interface LevelMove {
    type: 'level.move';
    levelId: Id;
    direction: 'up' | 'down';
}

export interface LevelDelete {
    type: 'level.delete';
    levelId: Id;
}

export type LevelCommand =
    LevelAdd | LevelSetOutline | LevelUpdate | LevelMove | LevelDuplicate | LevelDelete;

export function applyLevelCommand(doc: AreaformDocument, command: LevelCommand): AreaformDocument {
    switch (command.type) {
        case 'level.add':
            return levelAdd(doc, command);
        case 'level.setOutline':
            return updateLevel(doc, command.levelId, (level) => ({
                ...level,
                outline: normalizeShape(command.outline),
            }));
        case 'level.update':
            return updateLevel(doc, command.levelId, (level) =>
                withChanges(level, command.changes as Changes<Level>),
            );
        case 'level.move':
            return levelMove(doc, command);
        case 'level.duplicate':
            return levelDuplicate(doc, command);
        case 'level.delete':
            return levelDelete(doc, command);
    }
}

/**
 * Adds a Level on top of its group's stack, or below its lowest Level with `at: 'bottom'` (the
 * ungrouped Levels count as one stack). The first Level of a group starts at the ground; it
 * borrows the Outline of the Space's top Level.
 */
function levelAdd(doc: AreaformDocument, command: LevelAdd): AreaformDocument {
    const bottom = command.at === 'bottom';
    const neighbour = bottom ? groupBottom(doc, command.group) : groupTop(doc, command.group);
    const template = neighbour ?? topLevel(doc);
    const height = command.height ?? template.height;
    const stacked = neighbour
        ? bottom
            ? { ordinal: neighbour.ordinal - 1, elevation: neighbour.elevation - height }
            : { ordinal: neighbour.ordinal + 1, elevation: neighbour.elevation + neighbour.height }
        : { ordinal: 0, elevation: 0 };
    const level: Level = {
        id: command.id ?? newId(),
        name: command.name,
        ...(command.group !== undefined && { group: command.group }),
        ordinal: stacked.ordinal,
        elevation: command.elevation ?? stacked.elevation,
        height,
        // Documents are immutable, so sharing the Outline between Levels is safe.
        outline: template.outline,
        wallNodes: [],
        walls: [],
        openings: [],
        zones: [],
        obstacles: [],
        underlays: [],
    };
    return { ...doc, levels: [...doc.levels, level] };
}

/**
 * Copies a Level and everything on it to the top of its group's stack. Every copied element gets a new
 * id, with references remapped inside the copy. Connections are not extended to it.
 */
function levelDuplicate(doc: AreaformDocument, command: LevelDuplicate): AreaformDocument {
    const source = doc.levels.find((level) => level.id === command.levelId);
    if (!source) throw new Rejection([{ code: 'unknown-level', levelId: command.levelId }]);
    const top = groupTop(doc, source.group) ?? source;

    const ids = new Map<Id, Id>();
    const remap = (id: Id) => ids.get(id) ?? id;
    const fresh = <T extends { id: Id }>(element: T): T => {
        const id = newId();
        ids.set(element.id, id);
        return { ...element, id };
    };
    // Nodes and Walls first, so Walls and Openings can be remapped to the copies.
    const wallNodes = source.wallNodes.map(fresh);
    const walls = source.walls.map((wall) => ({
        ...fresh(wall),
        a: remap(wall.a),
        b: remap(wall.b),
    }));
    const openings = source.openings.map((opening) =>
        opening.host === 'wall'
            ? { ...fresh(opening), wallId: remap(opening.wallId) }
            : fresh(opening),
    );

    const copy: Level = {
        ...source,
        id: command.id ?? newId(),
        name: command.name ?? `${source.name} copy`,
        ordinal: top.ordinal + 1,
        elevation: top.elevation + top.height,
        wallNodes,
        walls,
        openings,
        zones: source.zones.map(fresh),
        obstacles: source.obstacles.map(fresh),
        underlays: source.underlays.map(fresh),
        ...(source.viewpoints && { viewpoints: source.viewpoints.map(fresh) }),
    };
    return { ...doc, levels: [...doc.levels, copy] };
}

/** Removes the Level, its Stops, and any Connection left with fewer than two Stops. */
function levelDelete(doc: AreaformDocument, { levelId }: LevelDelete): AreaformDocument {
    if (!doc.levels.some((level) => level.id === levelId)) {
        throw new Rejection([{ code: 'unknown-level', levelId }]);
    }
    const connections = doc.connections.flatMap((connection) => {
        if (!connection.stops.some((stop) => stop.levelId === levelId)) return [connection];
        const stops = connection.stops.filter((stop) => stop.levelId !== levelId);
        return stops.length >= 2 ? [{ ...connection, stops }] : [];
    });
    return { ...doc, levels: doc.levels.filter((level) => level.id !== levelId), connections };
}

/**
 * Swaps the two Levels' places in the stack: the one that ends up lower takes the old lower
 * elevation, and the other sits on top of it, keeping any gap that was between them.
 */
function levelMove(doc: AreaformDocument, { levelId, direction }: LevelMove): AreaformDocument {
    const level = doc.levels.find((l) => l.id === levelId);
    if (!level) throw new Rejection([{ code: 'unknown-level', levelId }]);
    const sameGroup = doc.levels.filter((l) => l.group === level.group && l.id !== level.id);
    const neighbour =
        direction === 'up'
            ? sameGroup
                  .filter((l) => l.ordinal > level.ordinal)
                  .sort((a, b) => a.ordinal - b.ordinal)[0]
            : sameGroup
                  .filter((l) => l.ordinal < level.ordinal)
                  .sort((a, b) => b.ordinal - a.ordinal)[0];
    if (!neighbour) return doc;

    const [lower, upper] = direction === 'up' ? [level, neighbour] : [neighbour, level];
    const gap = upper.elevation - (lower.elevation + lower.height);
    const moved = new Map<Id, Level>([
        [upper.id, { ...upper, ordinal: lower.ordinal, elevation: lower.elevation }],
        [
            lower.id,
            { ...lower, ordinal: upper.ordinal, elevation: lower.elevation + upper.height + gap },
        ],
    ]);
    return { ...doc, levels: doc.levels.map((l) => moved.get(l.id) ?? l) };
}

/** The highest Level of a Level Group (`undefined` = the ungrouped Levels), if it has any. */
function groupTop(doc: AreaformDocument, group: string | undefined): Level | undefined {
    const members = doc.levels.filter((l) => l.group === group);
    return members.length > 0
        ? members.reduce((top, l) => (l.ordinal > top.ordinal ? l : top))
        : undefined;
}

/** The lowest Level of a Level Group (`undefined` = the ungrouped Levels), if it has any. */
function groupBottom(doc: AreaformDocument, group: string | undefined): Level | undefined {
    const members = doc.levels.filter((l) => l.group === group);
    return members.length > 0
        ? members.reduce((low, l) => (l.ordinal < low.ordinal ? l : low))
        : undefined;
}

function topLevel(doc: AreaformDocument): Level {
    return doc.levels.reduce((top, level) => (level.ordinal > top.ordinal ? level : top));
}
