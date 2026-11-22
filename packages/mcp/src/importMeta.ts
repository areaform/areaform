import type { AreaformDocument, Id, SpaceUpdate, Vec2 } from '@areaform/core';

/**
 * What the import records in `document.meta.import` ([design](../../../docs/product/mcp-import-design.md)).
 * Fields appear as the Draft is built, so all but `importedAt` are optional.
 */
export interface ImportMeta {
    importedAt: string;
    source?: { kind: 'figma' | 'image'; ref: string };
    /** Metres per source unit (a Figma point or an image pixel). */
    scale?: number;
    /** Width and height of the Source in its own units; its top-left corner maps to `[0, height · scale]`. */
    sourceSize?: Vec2;
    /** The Underlay showing the Source, once attached. */
    underlayId?: Id;
    flags?: ImportFlag[];
    /** Element id → the Figma node it was read from, for a future re-import. */
    sourceRefs?: Record<Id, string>;
}

/** What can carry an Import Flag: a Level (for its Outline) or an Element the import drew; an `ElementRef`. */
export type FlaggedRef =
    | { kind: 'level'; id: Id }
    | { kind: 'wallNode' | 'wall' | 'opening' | 'zone' | 'obstacle'; id: Id; levelId: Id };

/** Something on the Draft a person should check ([CONTEXT](../../../CONTEXT.md)). */
export interface ImportFlag {
    ref: FlaggedRef;
    reason: string;
    /** Where in the Source it came from, e.g. a Figma node id. */
    sourceRef?: string;
}

const FLAGGABLE = [
    ['wallNode', 'wallNodes'],
    ['wall', 'walls'],
    ['opening', 'openings'],
    ['zone', 'zones'],
    ['obstacle', 'obstacles'],
] as const;

/** The Level or Element with this id; ids are unique across a Document. */
export function findFlaggable(doc: AreaformDocument, id: Id): FlaggedRef | undefined {
    for (const level of doc.levels) {
        if (level.id === id) return { kind: 'level', id };
        for (const [kind, list] of FLAGGABLE) {
            if (level[list].some((element) => element.id === id)) {
                return { kind, id, levelId: level.id };
            }
        }
    }
    return undefined;
}

export function readImportMeta(doc: AreaformDocument): ImportMeta | undefined {
    return doc.meta?.['import'] as ImportMeta | undefined;
}

/** A `space.update` that merges `changes` into the Document's `meta.import`. */
export function updateImportMeta(doc: AreaformDocument, changes: Partial<ImportMeta>): SpaceUpdate {
    const current = readImportMeta(doc);
    return {
        type: 'space.update',
        changes: { meta: { ...doc.meta, import: { ...current, ...changes } } },
    };
}
