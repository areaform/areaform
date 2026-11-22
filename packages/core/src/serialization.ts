import { removedRefs, type ElementRef } from './elements.ts';
import { checkInvariants, type InvariantError } from './invariants.ts';
import { isLanguageTag } from './languages.ts';
import type { AreaformDocument, Id, Level } from './model.ts';
import {
    CURRENT_SCHEMA_VERSION,
    migrate,
    type DocumentData,
    type MigrationError,
} from './migrations.ts';
import { checkSchemaV1 } from './schema.ts';

export type LoadError =
    | { code: 'invalid-json' }
    | { code: 'not-a-document' }
    | MigrationError
    | { code: 'malformed'; path: string; expected: string }
    | InvariantError;

/** One element removal made by `repair`, and the Invariant it fixed. */
export interface Repair {
    error: InvariantError;
    removed: ElementRef[];
}

export type LoadResult =
    | {
          ok: true;
          doc: AreaformDocument;
          repairs: Repair[];
          /** The schema version the data was upgraded from, when it was older (ADR-0006). */
          migratedFrom?: number;
      }
    | { ok: false; errors: LoadError[] };

export interface LoadOptions {
    /** Drop elements that break Invariants instead of rejecting the Document. */
    repair?: boolean;
}

/**
 * The address of the current schema version's JSON Schema, which every file `toJSON` writes names
 * in `$schema`. Each version keeps its own address (`v1`, `v2`, …).
 */
export const DOCUMENT_SCHEMA_URL = `https://areaform.app/schema/v${CURRENT_SCHEMA_VERSION}/document.json`;

export interface SaveOptions {
    /** Spaces to indent by, for a file people read; none when absent. */
    indent?: number;
}

/**
 * Writes a Document as JSON, naming its JSON Schema in a leading `$schema`, so editors and
 * validators know the format and a person opening the file sees where it is described.
 */
export function toJSON(doc: AreaformDocument, { indent }: SaveOptions = {}): string {
    const data: Record<string, unknown> = { $schema: DOCUMENT_SCHEMA_URL, ...doc };
    // A `$schema` a host left on the Document must not name another version.
    data.$schema = DOCUMENT_SCHEMA_URL;
    return JSON.stringify(data, null, indent);
}

/** Loads a Document from a JSON string or already-parsed data. Never throws. */
export function fromJSON(input: unknown, options: LoadOptions = {}): LoadResult {
    let data = input;
    if (typeof input === 'string') {
        try {
            data = JSON.parse(input);
        } catch {
            return { ok: false, errors: [{ code: 'invalid-json' }] };
        }
    }
    if (typeof data !== 'object' || data === null || !('schemaVersion' in data)) {
        return { ok: false, errors: [{ code: 'not-a-document' }] };
    }
    // `$schema` describes the file, not the Space: it is dropped here and `toJSON` writes it anew.
    if ('$schema' in data) {
        const document: Record<string, unknown> = { ...data };
        delete document.$schema;
        data = document;
    }
    const migrated = migrate(data as DocumentData);
    if (!migrated.ok) return { ok: false, errors: [migrated.error] };
    const upgraded = migrated.data.schemaVersion !== migrated.from;

    const schemaError = checkSchemaV1(migrated.data);
    if (schemaError) return { ok: false, errors: [{ code: 'malformed', ...schemaError }] };

    let doc = migrated.data as unknown as AreaformDocument;
    const repairs: Repair[] = [];
    for (;;) {
        const errors = checkInvariants(doc);
        if (errors.length === 0) {
            return { ok: true, doc, repairs, ...(upgraded && { migratedFrom: migrated.from }) };
        }
        if (!options.repair) return { ok: false, errors };

        const fix = errors
            .map((error) => ({ error, next: repairOne(doc, error) }))
            .find((attempt) => attempt.next !== null);
        if (!fix?.next) return { ok: false, errors };
        repairs.push({ error: fix.error, removed: removedRefs(doc, fix.next) });
        doc = fix.next;
    }
}

/** Removes whatever breaks this Invariant, or returns null when removal cannot fix it. */
function repairOne(doc: AreaformDocument, error: InvariantError): AreaformDocument | null {
    switch (error.code) {
        case 'duplicate-id':
        case 'degenerate-wall':
        case 'invalid-underlay':
        case 'invalid-viewpoint':
            return removeLast(doc, error.id);
        case 'too-few-stops':
            return removeLast(doc, error.id);
        case 'invalid-shape':
            // A Level's Outline is the Level itself; dropping a whole Level is too destructive.
            return doc.levels.some((level) => level.id === error.id)
                ? null
                : removeLast(doc, error.id);
        case 'dangling-reference': {
            const connection = doc.connections.find((c) => c.id === error.id);
            if (!connection) return removeLast(doc, error.id);
            return withConnectionStops(doc, error.id, (stops) =>
                stops.filter((stop) => stop.levelId !== error.ref),
            );
        }
        case 'duplicate-stop':
            return withConnectionStops(doc, error.id, (stops) =>
                withoutLast(stops, (stop) => stop.levelId === error.levelId),
            );
        case 'invalid-languages':
            return withValidLanguages(doc);
        case 'invalid-level':
        case 'invalid-grid':
        case 'unknown-language':
        case 'required-text':
        case 'no-levels':
        case 'unknown-level':
        case 'unknown-element':
            return null;
    }
}

/**
 * Keeps the Content Languages that are well formed: other languages with a malformed tag or
 * listed twice are dropped, and the whole list when the default itself is malformed.
 */
function withValidLanguages(doc: AreaformDocument): AreaformDocument {
    const { languages, ...rest } = doc;
    if (!languages || !isLanguageTag(languages.default)) return rest;
    const seen = new Set([languages.default.toLowerCase()]);
    const others = (languages.others ?? []).filter((tag) => {
        const ok = isLanguageTag(tag) && !seen.has(tag.toLowerCase());
        seen.add(tag.toLowerCase());
        return ok;
    });
    return { ...rest, languages: { default: languages.default, ...(others.length && { others }) } };
}

/** Removes the last element (Level, Level element or Connection) with this id. */
function removeLast(doc: AreaformDocument, id: Id): AreaformDocument | null {
    const isTarget = (element: { id: Id }) => element.id === id;
    if (doc.connections.some(isTarget)) {
        return { ...doc, connections: withoutLast(doc.connections, isTarget) };
    }

    const lists = ['wallNodes', 'walls', 'openings', 'zones', 'obstacles', 'underlays'] as const;
    for (let i = doc.levels.length - 1; i >= 0; i--) {
        const level = doc.levels[i]!;
        // A Level's Viewpoints come after its Elements, as the Invariants claim their ids.
        if (level.viewpoints?.some(isTarget)) {
            const updated: Level = {
                ...level,
                viewpoints: withoutLast(level.viewpoints, isTarget),
            };
            return { ...doc, levels: doc.levels.map((l, j) => (j === i ? updated : l)) };
        }
        const list = lists.findLast((name) => level[name].some(isTarget));
        if (list) {
            const updated: Level = {
                ...level,
                [list]: withoutLast<{ id: Id }>(level[list], isTarget),
            };
            return { ...doc, levels: doc.levels.map((l, j) => (j === i ? updated : l)) };
        }
        if (isTarget(level) && doc.levels.filter(isTarget).length > 1) {
            return { ...doc, levels: doc.levels.filter((_, j) => j !== i) };
        }
    }
    return null;
}

function withConnectionStops(
    doc: AreaformDocument,
    connectionId: Id,
    update: (stops: AreaformDocument['connections'][number]['stops']) => typeof stops,
): AreaformDocument {
    return {
        ...doc,
        connections: doc.connections.map((c) =>
            c.id === connectionId ? { ...c, stops: update(c.stops) } : c,
        ),
    };
}

function withoutLast<T>(list: T[], predicate: (item: T) => boolean): T[] {
    const index = list.findLastIndex(predicate);
    return index === -1 ? list : list.filter((_, i) => i !== index);
}
