import { newId } from '../ids.ts';
import { Rejection } from '../checks/invariants.ts';
import type { AreaformDocument, Id, Level, Viewpoint } from '../model.ts';
import { requireElement, updateLevel, withChanges, type Changes, type Input } from './shared.ts';

/** Saves a camera on a Level (ADR-0025): last in its tour, or at `index`. */
export interface ViewpointAdd {
    type: 'viewpoint.add';
    levelId: Id;
    viewpoint: Input<Viewpoint>;
    /** Its place in the tour, from 0; the end when absent. */
    index?: number;
}

/** Changes a Viewpoint; an optional property set to `undefined` is cleared. */
export interface ViewpointUpdate {
    type: 'viewpoint.update';
    levelId: Id;
    viewpointId: Id;
    changes: Changes<Viewpoint>;
}

/** Removes a Viewpoint from its Level's tour. */
export interface ViewpointDelete {
    type: 'viewpoint.delete';
    levelId: Id;
    viewpointId: Id;
}

/** Moves a Viewpoint to another place in its Level's tour, from 0; the others keep their order. */
export interface ViewpointMove {
    type: 'viewpoint.move';
    levelId: Id;
    viewpointId: Id;
    index: number;
}

export type ViewpointCommand = ViewpointAdd | ViewpointUpdate | ViewpointDelete | ViewpointMove;

/** Applies a `viewpoint.*` Command, keeping the Level as it was when nothing changes (ADR-0005). */
export function applyViewpointCommand(
    doc: AreaformDocument,
    command: ViewpointCommand,
): AreaformDocument {
    switch (command.type) {
        case 'viewpoint.add': {
            const viewpoint = { ...command.viewpoint, id: command.viewpoint.id ?? newId() };
            return withViewpoints(doc, command.levelId, (list) =>
                insertAt(list, viewpoint, command.index ?? list.length, viewpoint.id),
            );
        }
        case 'viewpoint.update':
            return withViewpoints(doc, command.levelId, (list) => {
                requireElement(list, command.viewpointId);
                return list.map((v) =>
                    v.id === command.viewpointId ? withChanges(v, command.changes) : v,
                );
            });
        case 'viewpoint.delete':
            return withViewpoints(doc, command.levelId, (list) => {
                requireElement(list, command.viewpointId);
                return list.filter((v) => v.id !== command.viewpointId);
            });
        case 'viewpoint.move':
            return withViewpoints(doc, command.levelId, (list) => {
                requireElement(list, command.viewpointId);
                const moved = list.find((v) => v.id === command.viewpointId)!;
                const rest = list.filter((v) => v !== moved);
                const next = insertAt(rest, moved, command.index, moved.id);
                return next.every((v, i) => v === list[i]) ? list : next;
            });
    }
}

/** The Level with its Viewpoints changed; a Level left with none drops the property. */
function withViewpoints(
    doc: AreaformDocument,
    levelId: Id,
    update: (list: Viewpoint[]) => Viewpoint[],
): AreaformDocument {
    return updateLevel(doc, levelId, (level): Level => {
        const list = level.viewpoints ?? [];
        const next = update(list);
        if (next === list) return level;
        if (next.length > 0) return { ...level, viewpoints: next };
        const rest: Level = { ...level };
        delete rest.viewpoints;
        return rest;
    });
}

/** `item` at `index` in `list`; a place outside the list rejects the Command for Viewpoint `id`. */
function insertAt<T>(list: T[], item: T, index: number, id: Id): T[] {
    if (!Number.isInteger(index) || index < 0 || index > list.length)
        throw new Rejection([{ code: 'invalid-viewpoint', id }]);
    return [...list.slice(0, index), item, ...list.slice(index)];
}
