import { createSpace, toJSON } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createStore, DEFAULT_PREFS, describeLoadErrors, type KeyValueStorage } from './storage.ts';

/** An in-memory stand-in for localStorage; `limit` makes writes beyond that many chars fail. */
function memory(limit = Infinity): KeyValueStorage & { items: Map<string, string> } {
    const items = new Map<string, string>();
    return {
        items,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => {
            const used = [...items].reduce((n, [k, v]) => n + (k === key ? 0 : v.length), 0);
            if (used + value.length > limit) {
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            items.set(key, value);
        },
    };
}

const hall = () => createSpace({ name: 'Hall A', kind: 'exhibition', size: [20, 10] });

describe('the playground store', () => {
    it('saves a Document and loads it back', () => {
        const store = createStore(memory());
        const doc = hall();

        expect(store.saveDocument(doc)).toEqual({ ok: true });

        expect(store.loadDocument()).toEqual({ status: 'loaded', doc });
    });

    it('reports when nothing has been saved yet', () => {
        expect(createStore(memory()).loadDocument()).toEqual({ status: 'empty' });
    });

    it('explains a saved copy that cannot be loaded, and leaves it in place', () => {
        const storage = memory();
        const future = { ...JSON.parse(toJSON(hall())), schemaVersion: 99 };
        storage.setItem('areaform:playground', JSON.stringify(future));
        const store = createStore(storage);

        const result = store.loadDocument();

        expect(result).toEqual({
            status: 'unreadable',
            message: expect.stringMatching(/newer version/),
        });
        expect(storage.items.get('areaform:playground')).toBe(JSON.stringify(future));
    });

    it('says so when the browser storage is full, keeping the previous copy', () => {
        const storage = memory(2_000);
        const store = createStore(storage);
        const small = hall();
        store.saveDocument(small);
        const big = { ...small, meta: { padding: 'x'.repeat(5_000) } };

        expect(store.saveDocument(big)).toEqual({ ok: false, reason: 'full' });
        expect(store.loadDocument()).toEqual({ status: 'loaded', doc: small });
    });

    it('remembers preferences, falling back to defaults for anything missing or odd', () => {
        const storage = memory();
        const store = createStore(storage);
        expect(store.loadPrefs()).toEqual(DEFAULT_PREFS);

        store.savePrefs({
            units: 'imperial',
            dimensions: true,
            grid: true,
            autosave: true,
            mode: 'edit',
            locale: 'pl',
            foldedSections: ['languages'],
        });
        expect(createStore(storage).loadPrefs()).toEqual({
            units: 'imperial',
            dimensions: true,
            grid: true,
            autosave: true,
            mode: 'edit',
            locale: 'pl',
            foldedSections: ['languages'],
        });

        storage.setItem('areaform:playground:prefs', '{"units":"furlongs","autosave":true}');
        expect(store.loadPrefs()).toEqual({ ...DEFAULT_PREFS, autosave: true });
        storage.setItem('areaform:playground:prefs', 'not json');
        expect(store.loadPrefs()).toEqual(DEFAULT_PREFS);
    });

    it('starts with autosave and the grid off, in metric, in View mode, in English, all open', () => {
        expect(DEFAULT_PREFS).toEqual({
            units: 'metric',
            dimensions: false,
            grid: false,
            autosave: false,
            mode: 'view',
            locale: 'en',
            foldedSections: ['levels', 'viewpoints', 'languages', 'location'],
        });
    });

    it('keeps a built-in interface language and drops any other', () => {
        const store = createStore(memory());
        store.savePrefs({ ...DEFAULT_PREFS, locale: 'uk' });
        expect(store.loadPrefs().locale).toBe('uk');
        const other = memory();
        other.setItem('areaform:playground:prefs', JSON.stringify({ locale: 'xx' }));
        expect(createStore(other).loadPrefs().locale).toBe('en');
    });

    it('keeps the folded sidebar sections it knows, once each, in its own order', () => {
        const store = createStore(memory());
        store.savePrefs({ ...DEFAULT_PREFS, foldedSections: ['location', 'viewpoints'] });
        expect(store.loadPrefs().foldedSections).toEqual(['viewpoints', 'location']);
        const other = memory();
        other.setItem(
            'areaform:playground:prefs',
            JSON.stringify({ foldedSections: ['languages', 'problems', 'languages', 'levels'] }),
        );
        expect(createStore(other).loadPrefs().foldedSections).toEqual(['levels', 'languages']);
    });
});

describe('describeLoadErrors', () => {
    it('puts the usual load errors in words', () => {
        expect(describeLoadErrors([{ code: 'invalid-json' }])).toMatch(/not valid JSON/);
        expect(describeLoadErrors([{ code: 'newer-version', version: 3 }])).toMatch(
            /newer version/,
        );
        expect(
            describeLoadErrors([{ code: 'malformed', path: 'levels[0].name', expected: 'string' }]),
        ).toMatch(/levels\[0\]\.name/);
    });
});
