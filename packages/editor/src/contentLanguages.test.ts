import type { Zone } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    fillingInResolver,
    fillingLanguage,
    languageName,
    UNTRANSLATED_OPACITY,
} from './contentLanguages.ts';

const languages = { default: 'en', others: ['pl'] };
const zone = (extra: Partial<Zone> = {}): Zone => ({
    id: 'z',
    shape: { outer: [] },
    label: 'Booth 1',
    ...extra,
});

describe('languageName', () => {
    it('names a language in the interface language, with its tag', () => {
        expect(languageName('pl', 'en')).toBe('PL · Polish');
        expect(languageName('pl', 'pl')).toBe('PL · Polski');
        expect(languageName('pt-BR', 'en')).toBe('PT-BR · Brazilian Portuguese');
    });

    it('falls back to the tag where the browser cannot name it', () => {
        expect(languageName('xq', 'en')).toBe('XQ');
    });
});

describe('fillingInResolver', () => {
    const logos = () => ({ logo: '<svg/>' });

    it('shows a translation, and fades a name still to translate', () => {
        const resolve = fillingInResolver(undefined, languages, 'pl')!;

        expect(resolve(zone({ labels: { pl: 'Stoisko 1' } }))).toEqual({ text: 'Stoisko 1' });
        expect(resolve(zone())).toEqual({ opacity: UNTRANSLATED_OPACITY });
    });

    it('keeps the host’s logos', () => {
        expect(fillingInResolver(logos, languages, 'pl')!(zone())).toMatchObject({
            logo: '<svg/>',
        });
    });

    it('is the host’s own in the default language, or with no languages', () => {
        expect(fillingInResolver(logos, languages, 'en')).toBe(logos);
        expect(fillingInResolver(logos, undefined, 'pl')).toBe(logos);
    });
});

describe('fillingLanguage', () => {
    it('keeps an offered language and falls back to the default otherwise', () => {
        expect(fillingLanguage(languages, 'PL')).toBe('pl');
        expect(fillingLanguage(languages, 'de')).toBe('en');
        expect(fillingLanguage(languages, undefined)).toBe('en');
        expect(fillingLanguage(undefined, 'pl')).toBeUndefined();
    });
});
