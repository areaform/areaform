// Display units: shown through the View's formatting, typed and read back here. Documents always
// store metres (ADR-0002).

import { formatDecimal, METRES_PER_FOOT, METRES_PER_INCH, type DisplayUnits } from '@areaform/view';
import { english, type Translator } from '../i18n/index.ts';

export {
    formatArea,
    formatDecimal,
    formatLength,
    formatSize,
    rulersFor,
    unitLabel,
    type DisplayUnits,
} from '@areaform/view';

/** Reads a typed number with a decimal point or comma (`2.5`, `2,5`, `−1`); undefined if none. */
export function parseDecimal(text: string): number | undefined {
    const trimmed = text.trim().replace(',', '.').replace('\u2212', '-');
    if (trimmed === '') return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
}

/** A length as an editable number: metres, or decimal feet, in the interface language (`0,3`). */
export function toInputValue(
    metres: number,
    units: DisplayUnits,
    i18n: Translator = english,
): string {
    return formatDecimal(units === 'metric' ? metres : metres / METRES_PER_FOOT, i18n);
}

/**
 * Reads a typed length back as metres: a number in metres or feet (a decimal comma is fine), or
 * in imperial also `10'`, `10' 6"`, `10'6"` or `6"`. Undefined when it is not a length.
 */
export function parseLength(text: string, units: DisplayUnits): number | undefined {
    const plain = parseDecimal(text);
    if (plain !== undefined) return units === 'metric' ? plain : plain * METRES_PER_FOOT;
    const trimmed = text.trim().replace(',', '.');
    if (trimmed === '') return undefined;
    if (units === 'metric') return undefined;
    const match = /^(?:(\d+(?:\.\d+)?)\s*')?\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(trimmed);
    if (!match || (match[1] === undefined && match[2] === undefined)) return undefined;
    const feet = Number(match[1] ?? 0);
    const inches = Number(match[2] ?? 0);
    return feet * METRES_PER_FOOT + inches * METRES_PER_INCH;
}
