// The minimal set of row changes between two Documents, for hosts that sync to a backend
// (ADR-0005). Unchanged parts are skipped by reference; the rest is compared by value, so a
// Document reloaded from JSON diffs as unchanged.
import type { ElementRef } from './elements.ts';
import type {
    Connection,
    AreaformDocument,
    Id,
    Level,
    Obstacle,
    Opening,
    Underlay,
    Wall,
    WallNode,
    Zone,
} from './model.ts';

/** A Space's own properties: everything but its Levels and Connections. */
export type SpaceProps = Omit<AreaformDocument, 'levels' | 'connections'>;

/** A Level's own properties: everything but its Element lists. */
export type LevelProps = Omit<Level, ElementListKey>;

/** The Element lists of a Level. */
export type ElementListKey =
    'wallNodes' | 'walls' | 'openings' | 'zones' | 'obstacles' | 'underlays';

/** Each Level Element kind (as in an `ElementRef`) and its type. */
export interface ElementValues {
    wallNode: WallNode;
    wall: Wall;
    opening: Opening;
    zone: Zone;
    obstacle: Obstacle;
    underlay: Underlay;
}

/** One row and its new value: a Level's own properties, a Connection, or an Element. */
export type DiffEntry =
    | { ref: { kind: 'level'; id: Id }; value: LevelProps }
    | { ref: { kind: 'connection'; id: Id }; value: Connection }
    | {
          [K in keyof ElementValues]: {
              ref: { kind: K; id: Id; levelId: Id };
              value: ElementValues[K];
          };
      }[keyof ElementValues];

export interface DocumentDiff {
    /** The Space's own properties, when any of them changed. */
    document?: SpaceProps;
    /** New rows, a Level before its Elements. */
    added: DiffEntry[];
    /** Rows whose value changed. */
    updated: DiffEntry[];
    /** Rows that are gone, a Level's Elements before the Level itself. */
    removed: ElementRef[];
}

const LISTS = [
    ['wallNode', 'wallNodes'],
    ['wall', 'walls'],
    ['opening', 'openings'],
    ['zone', 'zones'],
    ['obstacle', 'obstacles'],
    ['underlay', 'underlays'],
] as const;

/**
 * What changed from `prev` to `next`, row by row: Levels (their own properties), Elements, and
 * Connections (with their Stops). Order within a list is not reported.
 */
export function diff(prev: AreaformDocument, next: AreaformDocument): DocumentDiff {
    const result: DocumentDiff = { added: [], updated: [], removed: [] };
    if (prev === next) return result;

    const space = (doc: AreaformDocument): SpaceProps => {
        const props: Partial<AreaformDocument> = { ...doc };
        delete props.levels;
        delete props.connections;
        return props as SpaceProps;
    };
    if (!equal(space(prev), space(next))) result.document = space(next);

    const prevLevels = new Map(prev.levels.map((level) => [level.id, level]));
    const nextIds = new Set(next.levels.map((level) => level.id));
    for (const level of next.levels) {
        const before = prevLevels.get(level.id);
        if (before === level) continue;
        const ref = { kind: 'level' as const, id: level.id };
        if (!before) {
            result.added.push({ ref, value: levelProps(level) });
            for (const entry of elementsOf(level)) result.added.push(entry);
            continue;
        }
        if (!equal(levelProps(before), levelProps(level))) {
            result.updated.push({ ref, value: levelProps(level) });
        }
        diffElements(before, level, result);
    }
    for (const level of prev.levels) {
        if (nextIds.has(level.id)) continue;
        for (const { ref } of elementsOf(level)) result.removed.push(ref);
        result.removed.push({ kind: 'level', id: level.id });
    }

    if (prev.connections !== next.connections) {
        const before = new Map(prev.connections.map((c) => [c.id, c]));
        const after = new Set(next.connections.map((c) => c.id));
        for (const connection of next.connections) {
            const old = before.get(connection.id);
            const ref = { kind: 'connection' as const, id: connection.id };
            if (!old) result.added.push({ ref, value: connection });
            else if (old !== connection && !equal(old, connection)) {
                result.updated.push({ ref, value: connection });
            }
        }
        for (const connection of prev.connections) {
            if (!after.has(connection.id)) {
                result.removed.push({ kind: 'connection', id: connection.id });
            }
        }
    }
    return result;
}

function diffElements(prev: Level, next: Level, result: DocumentDiff): void {
    const levelId = next.id;
    for (const [kind, key] of LISTS) {
        if (prev[key] === next[key]) continue;
        const before = new Map<Id, unknown>(prev[key].map((e) => [e.id, e]));
        const after = new Set<Id>(next[key].map((e) => e.id));
        for (const element of next[key]) {
            const old = before.get(element.id);
            const entry = { ref: { kind, id: element.id, levelId }, value: element } as DiffEntry;
            if (old === undefined) result.added.push(entry);
            else if (old !== element && !equal(old, element)) result.updated.push(entry);
        }
        for (const element of prev[key]) {
            if (!after.has(element.id)) result.removed.push({ kind, id: element.id, levelId });
        }
    }
}

function elementsOf(level: Level): DiffEntry[] {
    return LISTS.flatMap(([kind, key]) =>
        level[key].map(
            (element) =>
                ({ ref: { kind, id: element.id, levelId: level.id }, value: element }) as DiffEntry,
        ),
    );
}

function levelProps(level: Level): LevelProps {
    const props: Partial<Level> = { ...level };
    for (const [, key] of LISTS) delete props[key];
    return props as LevelProps;
}

/** Deep equality of plain JSON-like data; key order does not matter. */
function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        const other = b as unknown[];
        return a.length === other.length && a.every((v, i) => equal(v, other[i]));
    }
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    const keys = Object.keys(x).filter((k) => x[k] !== undefined);
    const otherKeys = Object.keys(y).filter((k) => y[k] !== undefined);
    return keys.length === otherKeys.length && keys.every((k) => equal(x[k], y[k]));
}
