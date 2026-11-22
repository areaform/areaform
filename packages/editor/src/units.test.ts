import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n/index.ts';
import {
    formatArea,
    formatLength,
    formatSize,
    parseDecimal,
    parseLength,
    rulersFor,
    toInputValue,
} from './units.ts';

describe('display units', () => {
    it('formats metric lengths, sizes and areas as before', () => {
        expect(formatLength(4.5, 'metric')).toBe('4.50 m');
        expect(formatSize(4, 2, 'metric')).toBe('4.00 × 2.00 m');
        expect(formatArea(8, 'metric')).toBe('8.00 m²');
    });

    it('formats imperial lengths as feet and inches, to the nearest inch', () => {
        expect(formatLength(10, 'imperial')).toBe(`32' 10"`);
        expect(formatLength(0.2, 'imperial')).toBe(`0' 8"`);
        expect(formatLength(3.048, 'imperial')).toBe(`10' 0"`);
        // 11.99 inches rounds up to a whole foot, not 0' 12".
        expect(formatLength(0.3045, 'imperial')).toBe(`1' 0"`);
    });

    it('formats imperial sizes and areas', () => {
        expect(formatSize(4, 2, 'imperial')).toBe(`13' 1" × 6' 7"`);
        expect(formatArea(96, 'imperial')).toBe('1,033 ft²');
    });

    it('shows a length for editing in metres or decimal feet', () => {
        expect(toInputValue(0.15, 'metric')).toBe('0.15');
        expect(toInputValue(3.048, 'imperial')).toBe('10');
        expect(toInputValue(0.2, 'imperial')).toBe('0.656');
    });

    it('reads metres, or feet in decimal or feet-and-inches form, back as metres', () => {
        expect(parseLength('2.5', 'metric')).toBe(2.5);
        expect(parseLength('2,5', 'metric')).toBe(2.5);
        expect(parseLength('10', 'imperial')).toBeCloseTo(3.048);
        expect(parseLength(`10'`, 'imperial')).toBeCloseTo(3.048);
        expect(parseLength(`10' 6"`, 'imperial')).toBeCloseTo(3.2004);
        expect(parseLength(`10'6"`, 'imperial')).toBeCloseTo(3.2004);
        expect(parseLength(`6"`, 'imperial')).toBeCloseTo(0.1524);
    });

    it('gives undefined for text that is not a length', () => {
        expect(parseLength('', 'metric')).toBeUndefined();
        expect(parseLength('abc', 'imperial')).toBeUndefined();
        expect(parseLength(`5" 3'`, 'imperial')).toBeUndefined();
    });
});

describe('rulersFor', () => {
    it('numbers metres with only the decimals a number has', () => {
        const rulers = rulersFor('metric');

        expect(rulers.unit).toBe(1);
        expect(rulers.unitLabel).toBe('m');
        expect([0, 5, -10, 2.5, 1.25, 0.1 + 0.2].map(rulers.format!)).toEqual([
            '0',
            '5',
            '-10',
            '2.5',
            '1.25',
            '0.3',
        ]);
    });

    it('writes numbers the interface language way', () => {
        const rulers = rulersFor('metric', createTranslator('pl'));

        expect(rulers.format!(2.5)).toBe('2,5');
        expect(rulers.format!(-1000)).toBe('-1000');
    });

    it('counts feet', () => {
        const rulers = rulersFor('imperial', createTranslator('ru'));

        expect(rulers.unit).toBe(0.3048);
        expect(rulers.unitLabel).toBe('фт');
    });
});

describe('numbers in fields', () => {
    it('shows lengths in the interface language, not the browser one', () => {
        expect(toInputValue(0.3, 'metric')).toBe('0.3');
        expect(toInputValue(0.3, 'metric', createTranslator('pl'))).toBe('0,3');
        expect(toInputValue(0.3, 'imperial', createTranslator('uk'))).toBe('0,984');
        expect(toInputValue(12, 'metric', createTranslator('ru'))).toBe('12');
    });

    it('reads a decimal point or comma, and a typographic minus', () => {
        expect(parseDecimal('2,5')).toBe(2.5);
        expect(parseDecimal(' 2.5 ')).toBe(2.5);
        expect(parseDecimal('\u22124')).toBe(-4);
        expect(parseDecimal('')).toBeUndefined();
        expect(parseDecimal('abc')).toBeUndefined();
        expect(parseLength('0,3', 'metric')).toBe(0.3);
    });
});
