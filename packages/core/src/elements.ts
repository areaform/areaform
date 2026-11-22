import type { AreaformDocument, Id } from './model.ts';

export type LevelElementKind =
    | 'wallNode'
    | 'wall'
    | 'opening'
    | 'zone'
    | 'obstacle'
    | 'underlay'
    /** A Connection's Stop on one Level; `id` is the Connection's id. */
    | 'stop';

/** Points at a Level, a Connection, or an Element on a Level. */
export type ElementRef =
    | { kind: 'level'; id: Id }
    | { kind: 'connection'; id: Id }
    | { kind: LevelElementKind; id: Id; levelId: Id };

const LISTS = [
    ['wallNode', 'wallNodes'],
    ['wall', 'walls'],
    ['opening', 'openings'],
    ['zone', 'zones'],
    ['obstacle', 'obstacles'],
    ['underlay', 'underlays'],
] as const;

/**
 * Refs present in `before` but not in `after`, including the contents of a removed Level.
 * Stops of a removed Connection are left out: they are part of it, not separate losses.
 * Levels that are the same object in both are skipped (structural sharing, ADR-0005).
 */
export function removedRefs(before: AreaformDocument, after: AreaformDocument): ElementRef[] {
    const removed: ElementRef[] = [];
    const afterLevels = new Map(after.levels.map((level) => [level.id, level]));

    for (const level of before.levels) {
        const next = afterLevels.get(level.id);
        if (next === level) continue;
        const levelId = level.id;
        if (!next) removed.push({ kind: 'level', id: levelId });
        for (const [kind, list] of LISTS) {
            if (next?.[list] === level[list]) continue;
            const remaining = new Set<Id>(next?.[list].map((element) => element.id));
            for (const { id } of level[list]) {
                if (!remaining.has(id)) removed.push({ kind, id, levelId });
            }
        }
    }

    if (after.connections !== before.connections) {
        const afterConnections = new Map(after.connections.map((c) => [c.id, c]));
        for (const connection of before.connections) {
            const next = afterConnections.get(connection.id);
            if (next === connection) continue;
            if (!next) {
                removed.push({ kind: 'connection', id: connection.id });
                continue;
            }
            const served = new Set(next.stops.map((stop) => stop.levelId));
            for (const { levelId } of connection.stops) {
                if (!served.has(levelId))
                    removed.push({ kind: 'stop', id: connection.id, levelId });
            }
        }
    }
    return removed;
}
