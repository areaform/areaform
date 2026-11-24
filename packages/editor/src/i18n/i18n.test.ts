import { defaultPresets } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { categoryLabel, createTranslator, english, kindLabel, LOCALES } from './index.ts';
import { en } from './messages/en.ts';
import { formatArea, formatLength, formatSize } from '../interaction/units.ts';

describe('createTranslator', () => {
    it('fills placeholders', () => {
        expect(english.t('extend.one', { name: 'Lift A' })).toBe('Extend Lift A');
        expect(createTranslator('ru').t('level.defaultName', { number: 3 })).toBe('Уровень 3');
    });

    it('picks the plural form of the language', () => {
        expect(english.t('count.wall', { count: 1 })).toBe('1 wall');
        expect(english.t('count.wall', { count: 2 })).toBe('2 walls');
        const ru = createTranslator('ru');
        expect([1, 3, 5, 21].map((count) => ru.t('count.wall', { count }))).toEqual([
            '1 стена',
            '3 стены',
            '5 стен',
            '21 стена',
        ]);
        const pl = createTranslator('pl');
        expect([1, 3, 5, 12, 22].map((count) => pl.t('count.opening', { count }))).toEqual([
            '1 otwór',
            '3 otwory',
            '5 otworów',
            '12 otworów',
            '22 otwory',
        ]);
    });

    it('takes a region tag, and falls back to English for a language without a dictionary', () => {
        expect(createTranslator('pl-PL').t('common.cancel')).toBe('Anuluj');
        expect(createTranslator('de').t('common.cancel')).toBe('Cancel');
        expect(createTranslator('not a tag!').t('common.cancel')).toBe('Cancel');
    });

    it('lays a host’s overrides over the built-in dictionary', () => {
        const i18n = createTranslator('de', { 'common.cancel': 'Abbrechen' });
        expect(i18n.t('common.cancel')).toBe('Abbrechen');
        expect(i18n.t('common.delete')).toBe('Delete');
    });

    it('formats numbers the way the language writes them', () => {
        expect(english.fixed(4.5, 2)).toBe('4.50');
        expect(createTranslator('pl').fixed(1234.5, 2)).toBe('1234,50');
        expect(english.whole(1033)).toBe('1,033');
    });

    it('has every English key in every built-in dictionary', async () => {
        const keys = Object.keys(en).sort();
        for (const locale of LOCALES) {
            const { [locale]: messages } = (await import(`./messages/${locale}.ts`)) as Record<
                string,
                Record<string, string>
            >;
            const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
            expect(new Set(Object.keys(messages!).map(base)), locale).toEqual(
                new Set(keys.map(base)),
            );
        }
    });

    it('names every built-in Space Kind and Zone Category', () => {
        for (const locale of LOCALES) {
            const i18n = createTranslator(locale);
            for (const [kind, preset] of Object.entries(defaultPresets)) {
                expect(i18n.lookup(`preset.${kind}`), `${locale} ${kind}`).toBeDefined();
                for (const c of preset.categories)
                    expect(i18n.lookup(`category.${c.id}`), `${locale} ${c.id}`).toBeDefined();
            }
        }
        expect(kindLabel(createTranslator('ru'), 'exhibition', 'Exhibition')).toBe('Выставка');
        expect(kindLabel(createTranslator('ru'), 'cinema', 'Cinema')).toBe('Cinema');
        expect(categoryLabel(createTranslator('pl'), 'booth', 'Booth')).toBe('Stoisko');
    });
});

describe('formatting lengths in a language', () => {
    it('uses the decimal comma and unit symbol of the language', () => {
        const ru = createTranslator('ru');
        expect(formatLength(4.5, 'metric', ru)).toBe('4,50 м');
        expect(formatSize(4, 2, 'metric', ru)).toBe('4,00 × 2,00 м');
        expect(formatArea(8, 'metric', ru)).toBe('8,00 м²');
        expect(formatArea(8, 'metric', createTranslator('pl'))).toBe('8,00 m²');
    });

    it('keeps English as the default', () => {
        expect(formatLength(4.5, 'metric')).toBe('4.50 m');
        expect(formatArea(96, 'imperial')).toBe('1,033 ft²');
    });
});
