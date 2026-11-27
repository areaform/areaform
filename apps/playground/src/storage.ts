// How the playground, as a host app, keeps the plan and a few preferences in the browser.
// The engine itself never stores anything; this is the host's job.
import { fromJSON, toJSON, type AreaformDocument, type LoadError } from '@areaform/core';
import { LOCALES, type BuiltInLocale, type DisplayUnits } from '@areaform/editor';
import { DEFAULT_FOLDED_SECTIONS, type SidebarSection } from '@areaform/editor/react';

const SECTIONS: readonly SidebarSection[] = [
    'properties',
    'levels',
    'viewpoints',
    'page',
    'languages',
    'location',
];

/** The part of `localStorage` the store uses, so tests can pass a stand-in. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface Prefs {
    units: DisplayUnits;
    dimensions: boolean;
    grid: boolean;
    autosave: boolean;
    mode: 'view' | 'edit';
    /** The editor's interface language. */
    locale: BuiltInLocale;
    /** The editor's sidebar sections folded shut. */
    foldedSections: SidebarSection[];
}

export const DEFAULT_PREFS: Prefs = {
    units: 'metric',
    dimensions: false,
    grid: false,
    autosave: false,
    mode: 'view',
    locale: 'en',
    foldedSections: [...DEFAULT_FOLDED_SECTIONS],
};

export type DocumentLoad =
    | { status: 'loaded'; doc: AreaformDocument }
    | { status: 'empty' }
    /** A saved copy exists but does not load; it is left as it is. */
    | { status: 'unreadable'; message: string };

export type DocumentSave = { ok: true } | { ok: false; reason: 'full' | 'failed' };

const DOCUMENT_KEY = 'areaform:playground';
const PREFS_KEY = 'areaform:playground:prefs';

export function createStore(storage: KeyValueStorage) {
    return {
        loadDocument(): DocumentLoad {
            const saved = read(storage, DOCUMENT_KEY);
            if (saved === null) return { status: 'empty' };
            const loaded = fromJSON(saved);
            if (!loaded.ok) {
                return {
                    status: 'unreadable',
                    message: `The saved plan could not be opened: ${describeLoadErrors(loaded.errors)}.`,
                };
            }
            return { status: 'loaded', doc: loaded.doc };
        },

        /** Writes the Document; on failure the previous saved copy stays. */
        saveDocument(doc: AreaformDocument): DocumentSave {
            try {
                storage.setItem(DOCUMENT_KEY, toJSON(doc));
                return { ok: true };
            } catch (error) {
                const full = error instanceof DOMException && error.name === 'QuotaExceededError';
                return { ok: false, reason: full ? 'full' : 'failed' };
            }
        },

        loadPrefs(): Prefs {
            let data: unknown;
            try {
                data = JSON.parse(read(storage, PREFS_KEY) ?? '{}');
            } catch {
                return DEFAULT_PREFS;
            }
            if (typeof data !== 'object' || data === null) return DEFAULT_PREFS;
            const p = data as Record<string, unknown>;
            return {
                units:
                    p.units === 'imperial' || p.units === 'metric' ? p.units : DEFAULT_PREFS.units,
                dimensions:
                    typeof p.dimensions === 'boolean' ? p.dimensions : DEFAULT_PREFS.dimensions,
                grid: typeof p.grid === 'boolean' ? p.grid : DEFAULT_PREFS.grid,
                autosave: typeof p.autosave === 'boolean' ? p.autosave : DEFAULT_PREFS.autosave,
                mode: p.mode === 'edit' || p.mode === 'view' ? p.mode : DEFAULT_PREFS.mode,
                locale: LOCALES.find((l) => l === p.locale) ?? DEFAULT_PREFS.locale,
                foldedSections: Array.isArray(p.foldedSections)
                    ? SECTIONS.filter((s) => (p.foldedSections as unknown[]).includes(s))
                    : DEFAULT_PREFS.foldedSections,
            };
        },

        /** Preferences are a convenience: a failed write is ignored. */
        savePrefs(prefs: Prefs): void {
            try {
                storage.setItem(PREFS_KEY, JSON.stringify(prefs));
            } catch {
                // Storage full or blocked: the preferences just are not remembered.
            }
        },
    };
}

export type Store = ReturnType<typeof createStore>;

/** `getItem` can throw when storage is blocked; treat that as nothing saved. */
function read(storage: KeyValueStorage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

/** Load errors in words, for notices. */
export function describeLoadErrors(errors: LoadError[]): string {
    const first = errors[0];
    if (!first) return 'unknown problem';
    switch (first.code) {
        case 'invalid-json':
            return 'it is not valid JSON';
        case 'not-a-document':
            return 'it is not an Areaform Document';
        case 'newer-version':
            return `it was saved by a newer version of the editor (schema ${first.version})`;
        case 'unsupported-version':
            return `its schema version (${String(first.version)}) is not supported`;
        case 'malformed':
            return `${first.path} should be ${first.expected}`;
        default:
            return `it breaks the plan's rules (${errors.map((e) => e.code).join(', ')})`;
    }
}
