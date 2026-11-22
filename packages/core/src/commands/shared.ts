import { Rejection } from '../invariants.ts';
import type { AreaformDocument, Id, Level } from '../model.ts';

/** An element as passed to a Command: the id is optional and generated when omitted. */
export type Input<T> = T extends { id: Id } ? Omit<T, 'id'> & { id?: Id } : never;

/** The keys of `T` whose properties are optional, e.g. `label` or `category` of a Zone. */
export type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];

/**
 * Properties to change on an element. Required properties can only be set; optional ones are
 * cleared by setting them to `undefined`. The id never changes.
 */
export type Changes<T> = { [K in Exclude<keyof T, OptionalKeys<T> | 'id'>]?: T[K] } & {
    [K in OptionalKeys<T>]?: T[K] | undefined;
};

export function withChanges<T extends { id: Id }>(element: T, changes: Changes<T>): T {
    const next: Record<string, unknown> = { ...element, ...changes, id: element.id };
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete next[key];
    }
    return next as T;
}

export function updateLevel(
    doc: AreaformDocument,
    levelId: Id,
    update: (level: Level) => Level,
): AreaformDocument {
    if (!doc.levels.some((level) => level.id === levelId)) {
        throw new Rejection([{ code: 'unknown-level', levelId }]);
    }
    let changed = false;
    const levels = doc.levels.map((level) => {
        if (level.id !== levelId) return level;
        const next = update(level);
        changed = next !== level;
        return next;
    });
    // An update that changes nothing keeps the Document itself, so no empty undo step appears.
    return changed ? { ...doc, levels } : doc;
}

export function requireElement(list: { id: Id }[], id: Id): void {
    if (!list.some((element) => element.id === id)) {
        throw new Rejection([{ code: 'unknown-element', id }]);
    }
}

/** The per-Level lists of Elements that carry their own id. */
export type ElementList = 'wallNodes' | 'walls' | 'openings' | 'zones' | 'obstacles' | 'underlays';
export type ElementOf<K extends ElementList> = Level[K][number];

export function addElement<K extends ElementList>(
    doc: AreaformDocument,
    levelId: Id,
    list: K,
    element: ElementOf<K>,
): AreaformDocument {
    return updateLevel(doc, levelId, (level) => ({ ...level, [list]: [...level[list], element] }));
}

export function updateElement<K extends ElementList>(
    doc: AreaformDocument,
    levelId: Id,
    list: K,
    id: Id,
    update: (element: ElementOf<K>) => ElementOf<K>,
): AreaformDocument {
    return updateLevel(doc, levelId, (level) => {
        const elements: ElementOf<K>[] = level[list];
        requireElement(elements, id);
        return { ...level, [list]: elements.map((e) => (e.id === id ? update(e) : e)) };
    });
}

export function deleteElement<K extends ElementList>(
    doc: AreaformDocument,
    levelId: Id,
    list: K,
    id: Id,
): AreaformDocument {
    return updateLevel(doc, levelId, (level) => {
        const elements: ElementOf<K>[] = level[list];
        requireElement(elements, id);
        return { ...level, [list]: elements.filter((e) => e.id !== id) };
    });
}
