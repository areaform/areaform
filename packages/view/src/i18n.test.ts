import { defaultPresets } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    categoryLabel,
    createTranslator,
    english,
    LOCALES,
    translatorFor,
    VIEW_DICTIONARIES,
} from './i18n/translator.ts';
import { en } from './i18n/messages/en.ts';
import { formatArea, formatLength, rulersFor } from './units.ts';

describe('the View’s dictionaries', () => {
    it('have every English key in every built-in language', () => {
        const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
        const keys = new Set(Object.keys(en).map(base));
        for (const locale of LOCALES) {
            expect(new Set(Object.keys(VIEW_DICTIONARIES[locale]).map(base)), locale).toEqual(keys);
        }
    });

    it('name every Zone Category of the built-in Presets', () => {
        const pl = createTranslator('pl');
        for (const preset of Object.values(defaultPresets))
            for (const category of preset.categories)
                expect(pl.lookup(`category.${category.id}`), category.id).toBeDefined();
        expect(categoryLabel(pl, 'booth', 'Booth')).toBe('Stoisko');
        expect(categoryLabel(pl, 'mine', 'Mine')).toBe('Mine');
    });
});

describe('createTranslator', () => {
    it('speaks the language asked for, a region tag included, and English otherwise', () => {
        expect(createTranslator('pl-PL').t('plan.fit')).toBe(createTranslator('pl').t('plan.fit'));
        expect(createTranslator('de').t('plan.fit')).toBe(english.t('plan.fit'));
    });

    it('lays a host’s messages over the built-in ones', () => {
        expect(createTranslator('en', { 'plan.fit': 'Show all' }).t('plan.fit')).toBe('Show all');
    });
});

describe('translatorFor', () => {
    it('lays another package’s texts over the View’s, falling back to them', () => {
        const create = translatorFor<typeof en & { 'own.hello': 'Hello {{name}}' }>({
            en: { ...VIEW_DICTIONARIES.en, 'own.hello': 'Hello {{name}}' },
            pl: { ...VIEW_DICTIONARIES.pl, 'own.hello': 'Cześć {{name}}' },
            uk: { ...VIEW_DICTIONARIES.uk, 'own.hello': 'Привіт {{name}}' },
            ru: { ...VIEW_DICTIONARIES.ru, 'own.hello': 'Привет {{name}}' },
        });

        expect(create('pl').t('own.hello', { name: 'Ala' })).toBe('Cześć Ala');
        expect(create('pl').t('plan.fit')).toBe(createTranslator('pl').t('plan.fit'));
    });
});

describe('display units', () => {
    it('write lengths, areas and rulers the language’s way', () => {
        const pl = createTranslator('pl');
        expect(formatLength(4.5, 'metric', pl)).toBe('4,50 m');
        expect(formatArea(8, 'metric')).toBe('8.00 m²');
        expect(formatLength(4.5, 'imperial')).toBe('14\' 9"');
        expect(rulersFor('metric', pl).format!(2.5)).toBe('2,5');
    });
});
