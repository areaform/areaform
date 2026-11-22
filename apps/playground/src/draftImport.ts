import type { Command, ElementRef, AreaformDocument } from '@areaform/core';

// A Draft from the MCP import is a folder: the plan and the Source image its Underlay refers to
// by a relative `src`, plus Import Flags in `meta.import` (docs/product/mcp-import-design.md).

/** Something on the plan the import asks a person to check. */
export interface ImportFlag {
    ref: ElementRef;
    reason: string;
    sourceRef?: string;
}

/** The plan and images picked together, e.g. a Draft folder. */
export interface DraftFiles {
    plan: File;
    /** By file name, the way a relative Underlay `src` names them. */
    images: Map<string, File>;
}

const PLAN_FILE = 'plan.json';
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * Finds the plan among the files: the only `.json`, or `plan.json` when there are several. A
 * picked folder brings its subfolders too; only the images next to the plan are its own.
 */
export function sortDraftFiles(files: File[]): DraftFiles | { error: string } {
    const plans = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
    const named = plans.filter((f) => f.name === PLAN_FILE);
    if (named.length > 1) {
        return {
            error: `several Drafts in the folder (${named.map(pathOf).join(', ')}); pick one`,
        };
    }
    const plan = plans.length === 1 ? plans[0] : named[0];
    if (!plan) {
        return {
            error:
                plans.length === 0
                    ? 'no plan (.json) among the files'
                    : `several plans among the files and none is called ${PLAN_FILE}`,
        };
    }
    const folder = folderOf(plan);
    const images = new Map(
        files.filter((f) => IMAGE.test(f.name) && folderOf(f) === folder).map((f) => [f.name, f]),
    );
    return { plan, images };
}

/** Where a file sits in a picked folder; just its name when picked on its own. */
const pathOf = (file: File) => file.webkitRelativePath || file.name;
const folderOf = (file: File) => pathOf(file).slice(0, -file.name.length);

/** Underlay `src`s that name a file next to the plan rather than a URL. */
export function relativeSources(doc: AreaformDocument): string[] {
    const sources = doc.levels.flatMap((l) => l.underlays.map((u) => u.src));
    return [
        ...new Set(
            sources.filter((src) => !/^[a-z][a-z\d+.-]*:/i.test(src) && !src.startsWith('/')),
        ),
    ];
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
