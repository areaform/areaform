import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    fromJSON,
    isLanguageTag,
    matchLanguage,
    missingTexts,
    textIn,
    toJSON,
    type AreaformDocument,
    type ContentLanguages,
    type TextTarget,
} from './index.ts';

const offered: ContentLanguages = { default: 'en', others: ['pl', 'pt-BR'] };

describe('isLanguageTag', () => {
    it('takes BCP 47 shaped tags and refuses others', () => {
        for (const tag of ['en', 'pl', 'pt-BR', 'zh-Hant-TW', 'es-419', 'UK']) {
            expect(isLanguageTag(tag), tag).toBe(true);
        }
        for (const tag of ['', 'e', 'english', 'pt_BR', 'pl-', '-pl', 'pl PL']) {
            expect(isLanguageTag(tag), tag).toBe(false);
        }
    });
});

describe('matchLanguage', () => {
    it('finds the same tag, in any case', () => {
        expect(matchLanguage(offered, 'pl')).toBe('pl');
        expect(matchLanguage(offered, 'PT-br')).toBe('pt-BR');
    });

    it('finds a language without its region, then one with another region', () => {
        expect(matchLanguage(offered, 'pl-PL')).toBe('pl');
        expect(matchLanguage(offered, 'pt')).toBe('pt-BR');
        expect(matchLanguage(offered, 'pt-PT')).toBe('pt-BR');
    });

    it('finds nothing for a language not offered, or when the default is unknown', () => {
        expect(matchLanguage(offered, 'uk')).toBeUndefined();
        expect(matchLanguage(undefined, 'en')).toBeUndefined();
        expect(matchLanguage(offered, undefined)).toBeUndefined();
    });
});

describe('textIn', () => {
    const labels = { pl: 'Stoisko 1', de: 'Stand 1' };

    it('shows the translation in the visitor’s language', () => {
        expect(textIn('Booth 1', labels, offered, 'pl-PL')).toBe('Stoisko 1');
    });

    it('shows the default text in the default language, or with no translation', () => {
        expect(textIn('Booth 1', labels, offered, 'en-GB')).toBe('Booth 1');
        expect(textIn('Booth 1', labels, offered, 'pt-BR')).toBe('Booth 1');
        expect(textIn('Booth 1', { pl: '' }, offered, 'pl')).toBe('Booth 1');
        expect(textIn('Booth 1', undefined, offered, 'pl')).toBe('Booth 1');
    });

    it('never shows a hidden language, one the Space does not offer', () => {
        expect(textIn('Booth 1', labels, offered, 'de')).toBe('Booth 1');
    });

    it('shows the default text when the default language is unknown', () => {
        expect(textIn('Booth 1', labels, undefined, 'pl')).toBe('Booth 1');
    });
});

/**
 * A hall in English with Polish offered, or with no languages (`null`): `Z` is a Zone, `L` its
 * Level, `S` a Connection.
 */
function hall(languages: ContentLanguages | null = { default: 'en', others: ['pl'] }) {
    const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [20, 10] });
    const editor = createEditor(languages ? { ...doc, languages } : doc);
    const L = doc.levels[0]!.id;
    const run = (command: Parameters<typeof editor.exec>[0]) => {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    };
    run({ type: 'level.add', id: 'L2', name: 'Level 2' });
    run({
        type: 'zone.add',
        levelId: L,
        zone: {
            id: 'Z',
            label: 'Booth 1',
            shape: {
                outer: [
                    [1, 1],
                    [3, 1],
                    [3, 3],
                    [1, 3],
                ],
            },
        },
    });
    const square = {
        outer: [
            [8, 8],
            [9, 8],
            [9, 9],
            [8, 9],
        ] as [number, number][],
    };
    run({
        type: 'connection.add',
        connection: {
            id: 'S',
            kind: 'stairs',
            bidirectional: true,
            stops: [
                { levelId: L, shape: square },
                { levelId: 'L2', shape: square },
            ],
        },
    });
    return { editor, L };
}

const set = (target: TextTarget, language: string, text?: string) =>
    ({ type: 'text.set', target, language, ...(text !== undefined && { text }) }) as const;

describe('text.set', () => {
    it('writes a translation beside the text, and the default language into the text itself', () => {
        const { editor, L } = hall();
        const zone = { kind: 'zone', levelId: L, zoneId: 'Z' } as const;

        expect(editor.exec(set(zone, 'pl', 'Stoisko 1')).ok).toBe(true);
        expect(editor.exec(set(zone, 'en', 'Stand 1')).ok).toBe(true);

        const z = editor.getDocument().levels[0]!.zones[0]!;
        expect(z.label).toBe('Stand 1');
        expect(z.labels).toEqual({ pl: 'Stoisko 1' });
    });

    it('names the Space, a Level and a Connection in another language', () => {
        const { editor, L } = hall();

        editor.exec(set({ kind: 'space' }, 'pl', 'Hala A'));
        editor.exec(set({ kind: 'level', levelId: L }, 'pl', 'Parter'));
        editor.exec(set({ kind: 'connection', connectionId: 'S' }, 'pl', 'Schody'));

        const doc = editor.getDocument();
        expect(doc.names).toEqual({ pl: 'Hala A' });
        expect(doc.levels[0]!.names).toEqual({ pl: 'Parter' });
        expect(doc.connections[0]!.names).toEqual({ pl: 'Schody' });
        expect(doc.name).toBe('Hall A');
    });

    it('removes a translation with an empty text, and the map with its last entry', () => {
        const { editor, L } = hall();
        const zone = { kind: 'zone', levelId: L, zoneId: 'Z' } as const;
        editor.exec(set(zone, 'pl', 'Stoisko 1'));

        editor.exec(set(zone, 'pl', ''));

        expect(editor.getDocument().levels[0]!.zones[0]).not.toHaveProperty('labels');
    });

    it('clears a Zone’s label in the default language, but never a Level’s name', () => {
        const { editor, L } = hall();

        expect(editor.exec(set({ kind: 'zone', levelId: L, zoneId: 'Z' }, 'en')).ok).toBe(true);
        expect(editor.getDocument().levels[0]!.zones[0]).not.toHaveProperty('label');
        expect(editor.exec(set({ kind: 'level', levelId: L }, 'en', ''))).toMatchObject({
            ok: false,
            errors: [{ code: 'required-text', id: L }],
        });
    });

    it('stores a translation under the tag the Space offers, whatever case it was asked in', () => {
        const { editor, L } = hall({ default: 'en', others: ['pt-BR'] });

        editor.exec(set({ kind: 'zone', levelId: L, zoneId: 'Z' }, 'pt-br', 'Estande 1'));

        expect(editor.getDocument().levels[0]!.zones[0]!.labels).toEqual({ 'pt-BR': 'Estande 1' });
    });

    it('refuses a language the Space does not offer, or any while its default is unknown', () => {
        const zone = (L: string) => ({ kind: 'zone', levelId: L, zoneId: 'Z' }) as const;
        const offered = hall();
        const unknown = hall(null);

        expect(offered.editor.exec(set(zone(offered.L), 'de', 'Stand 1'))).toMatchObject({
            ok: false,
            errors: [{ code: 'unknown-language', language: 'de' }],
        });
        expect(unknown.editor.exec(set(zone(unknown.L), 'en', 'Booth 1')).ok).toBe(false);
    });

    it('is one undo step, and changes nothing when the text is already there', () => {
        const { editor, L } = hall();
        const zone = { kind: 'zone', levelId: L, zoneId: 'Z' } as const;
        const before = editor.getDocument();

        editor.exec(set(zone, 'pl', 'Stoisko 1'));
        const after = editor.getDocument();
        editor.exec(set(zone, 'pl', 'Stoisko 1'));

        expect(editor.getDocument()).toBe(after);
        editor.undo();
        expect(editor.getDocument()).toBe(before);
    });

    it('rejects an Element that does not exist', () => {
        const { editor, L } = hall();

        expect(editor.exec(set({ kind: 'zone', levelId: L, zoneId: 'nope' }, 'pl', 'x')).ok).toBe(
            false,
        );
        expect(editor.exec(set({ kind: 'connection', connectionId: 'nope' }, 'pl', 'x')).ok).toBe(
            false,
        );
    });
});

describe('space.update with Content Languages', () => {
    it('re-declares the default without moving any text, and hides a removed language', () => {
        const { editor, L } = hall();
        editor.exec(set({ kind: 'zone', levelId: L, zoneId: 'Z' }, 'pl', 'Stoisko 1'));

        editor.exec({ type: 'space.update', changes: { languages: { default: 'pl' } } });

        const zone = editor.getDocument().levels[0]!.zones[0]!;
        expect(zone.label).toBe('Booth 1');
        expect(zone.labels).toEqual({ pl: 'Stoisko 1' });
        expect(textIn(zone.label, zone.labels, editor.getDocument().languages, 'pl')).toBe(
            'Booth 1',
        );
    });

    it('rejects a malformed tag, or a language listed twice', () => {
        const { editor } = hall();
        const update = (languages: ContentLanguages) =>
            editor.exec({ type: 'space.update', changes: { languages } });

        for (const languages of [
            { default: 'english' },
            { default: 'en', others: ['pl', 'PL'] },
            { default: 'en', others: ['en'] },
        ]) {
            expect(update(languages), JSON.stringify(languages)).toMatchObject({
                ok: false,
                errors: [{ code: 'invalid-languages' }],
            });
        }
    });
});

describe('loading Content Languages', () => {
    const withLanguages = (languages: unknown): unknown => {
        const doc = createSpace({ name: 'Hall', kind: 'office', size: [10, 10] });
        return { ...(JSON.parse(toJSON(doc)) as AreaformDocument), languages };
    };

    it('round-trips languages and translations', () => {
        const { editor, L } = hall();
        editor.exec(set({ kind: 'zone', levelId: L, zoneId: 'Z' }, 'pl', 'Stoisko 1'));
        const doc = editor.getDocument();

        expect(fromJSON(toJSON(doc))).toEqual({ ok: true, doc, repairs: [] });
    });

    it('reports a translation that is not text', () => {
        const data = withLanguages({ default: 'en' }) as AreaformDocument;
        const broken = { ...data, names: { pl: 3 } };

        expect(fromJSON(broken)).toMatchObject({
            ok: false,
            errors: [{ code: 'malformed', path: 'names.pl', expected: 'string' }],
        });
    });

    it('repairs malformed languages, keeping the valid ones', () => {
        const loaded = fromJSON(withLanguages({ default: 'en', others: ['pl', 'x_y', 'PL'] }), {
            repair: true,
        });

        expect(loaded.ok && loaded.doc.languages).toEqual({ default: 'en', others: ['pl'] });
    });

    it('drops languages whose default is malformed, so the default is unknown', () => {
        const loaded = fromJSON(withLanguages({ default: 'English', others: ['pl'] }), {
            repair: true,
        });

        expect(loaded.ok && loaded.doc).not.toHaveProperty('languages');
    });
});

describe('missingTexts', () => {
    it('lists every text with a default but no translation in the language', () => {
        const { editor, L } = hall();
        editor.exec(set({ kind: 'level', levelId: L }, 'pl', 'Parter'));

        expect(missingTexts(editor.getDocument(), 'PL')).toEqual([
            { kind: 'space' },
            { kind: 'level', levelId: 'L2' },
            { kind: 'zone', levelId: L, zoneId: 'Z' },
        ]);
    });

    it('leaves out texts with nothing to translate, and is empty for the default language', () => {
        const { editor, L } = hall();
        editor.exec(set({ kind: 'zone', levelId: L, zoneId: 'Z' }, 'en'));

        expect(missingTexts(editor.getDocument(), 'pl')).not.toContainEqual(
            expect.objectContaining({ kind: 'zone' }),
        );
        expect(missingTexts(editor.getDocument(), 'en')).toEqual([]);
        expect(missingTexts(editor.getDocument(), 'de')).toEqual([]);
    });
});
