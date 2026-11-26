import type { Command, ElementRef, AreaformDocument } from '@areaform/core';

// A Draft from the MCP import is a folder: the plan and the Source image its Underlay refers to
// by a relative `src`, plus Import Flags in `meta.import` (docs/product/mcp-import-design.md).
// Reading the folder is `sortDraftFiles` in @areaform/editor; the flags are the playground's.

/** Something on the plan the import asks a person to check. */
export interface ImportFlag {
    ref: ElementRef;
    reason: string;
    sourceRef?: string;
}

/** The Import Flags still to review; `meta` is free-form, so anything malformed is skipped. */
export function importFlags(doc: AreaformDocument): ImportFlag[] {
    const flags = rawFlags(doc);
    return Array.isArray(flags) ? flags.filter(isFlag) : [];
}

/** Whether the flagged Level or Element is still in the plan. */
export function flagTargetExists(doc: AreaformDocument, { ref }: ImportFlag): boolean {
    if (ref.kind === 'level') return doc.levels.some((l) => l.id === ref.id);
    if (ref.kind === 'connection' || ref.kind === 'stop') {
        return doc.connections.some((c) => c.id === ref.id);
    }
    const level = doc.levels.find((l) => l.id === ref.levelId);
    const lists = {
        wallNode: level?.wallNodes,
        wall: level?.walls,
        opening: level?.openings,
        zone: level?.zones,
        obstacle: level?.obstacles,
        underlay: level?.underlays,
    };
    return lists[ref.kind]?.some((e) => e.id === ref.id) ?? false;
}

/**
 * The undoable edit that marks a flag as reviewed, taking it off the list; undefined when the
 * flag is not on it (any more), e.g. on a second click before the list is drawn again.
 */
export function resolveFlag(doc: AreaformDocument, flag: ImportFlag): Command | undefined {
    const flags = rawFlags(doc);
    if (!Array.isArray(flags)) return undefined;
    // By value: the flag may come from an earlier Document than `doc`.
    const same = (f: unknown) =>
        isFlag(f) &&
        f.ref.kind === flag.ref.kind &&
        f.ref.id === flag.ref.id &&
        f.reason === flag.reason;
    const kept = flags.filter((f) => !same(f));
    if (kept.length === flags.length) return undefined;
    const meta = doc.meta ?? {};
    const imported = meta['import'] as Record<string, unknown>;
    return {
        type: 'space.update',
        changes: { meta: { ...meta, import: { ...imported, flags: kept } } },
    };
}

function rawFlags(doc: AreaformDocument): unknown {
    const imported = doc.meta?.['import'];
    return typeof imported === 'object' && imported !== null
        ? (imported as { flags?: unknown }).flags
        : undefined;
}

function isFlag(value: unknown): value is ImportFlag {
    if (typeof value !== 'object' || value === null) return false;
    const { ref, reason } = value as Partial<ImportFlag>;
    return (
        typeof reason === 'string' &&
        typeof ref === 'object' &&
        ref !== null &&
        typeof ref.kind === 'string' &&
        typeof ref.id === 'string'
    );
}
