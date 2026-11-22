// Display units. Documents always store metres (ADR-0002); imperial is only how lengths are shown
// (and, in the Editor, typed).

import type { Rulers } from '@areaform/render-2d';
import { english, type Translator } from './i18n/translator.ts';

export type DisplayUnits = 'metric' | 'imperial';

export const METRES_PER_INCH = 0.0254;
export const METRES_PER_FOOT = 0.3048;
const SQUARE_METRES_PER_SQUARE_FOOT = METRES_PER_FOOT * METRES_PER_FOOT;

/** `4.50 m`, or `14' 9"` to the nearest inch; `4,50 м` in Russian. */
export function formatLength(
    metres: number,
    units: DisplayUnits,
    i18n: Translator = english,
): string {
    if (units === 'metric') return `${i18n.fixed(metres, 2)} ${i18n.t('unit.m')}`;
    const inches = Math.round(metres / METRES_PER_INCH);
    return `${Math.floor(inches / 12)}' ${inches % 12}"`;
}

/** `4.00 × 2.00 m`, or `13' 1" × 6' 7"`. */
export function formatSize(
    width: number,
    depth: number,
    units: DisplayUnits,
    i18n: Translator = english,
): string {
    if (units === 'metric')
        return `${i18n.fixed(width, 2)} × ${i18n.fixed(depth, 2)} ${i18n.t('unit.m')}`;
    return `${formatLength(width, units)} × ${formatLength(depth, units)}`;
}

/** `8.00 m²`, or `1,033 ft²` in whole square feet. */
export function formatArea(
    squareMetres: number,
    units: DisplayUnits,
    i18n: Translator = english,
): string {
    if (units === 'metric') return `${i18n.fixed(squareMetres, 2)} ${i18n.t('unit.m2')}`;
    return `${i18n.whole(Math.round(squareMetres / SQUARE_METRES_PER_SQUARE_FOOT))} ${i18n.t('unit.ft2')}`;
}

/** The unit name for field labels: `m` or `ft` (`м` or `фт` in Russian). */
export const unitLabel = (units: DisplayUnits, i18n: Translator = english) =>
    i18n.t(units === 'metric' ? 'unit.m' : 'unit.ft');

/**
 * The renderer's rulers in these units: metres on the grid's strong lines, or feet in round
 * steps; numbers in the interface language (`2,5` in Polish), with no more decimals than they have.
 */
export function rulersFor(units: DisplayUnits, i18n: Translator = english): Rulers {
    return {
        unit: units === 'metric' ? 1 : METRES_PER_FOOT,
        format: (value) => formatDecimal(value, i18n),
        unitLabel: unitLabel(units, i18n),
    };
}

/** A number to at most 3 decimals, with only those it has: `2.5`, `-10`, `2,5` in Polish. */
export function formatDecimal(value: number, i18n: Translator = english): string {
    const rounded = Number(value.toFixed(3)) + 0;
    return i18n.fixed(rounded, (String(rounded).split('.')[1] ?? '').length);
}
