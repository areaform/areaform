import type { Preset, Zone } from '@areaform/core';
import { categoryLabel, type Translator } from '../i18n/index.ts';

/**
 * The category stored for what the user typed: a suggested category's id when the text is its id
 * or label (any case, in English or in `i18n`'s language), so "Meeting room" and "Переговорная"
 * stay `meeting-room`; otherwise the text itself, trimmed. Null for blank text, meaning no category.
 */
export function categoryFromText(preset: Preset, text: string, i18n?: Translator): string | null {
    const typed = text.trim();
    if (typed === '') return null;
    const lower = typed.toLowerCase();
    const suggested = preset.categories.find(
        (c) =>
            c.id.toLowerCase() === lower ||
            c.label.toLowerCase() === lower ||
            (i18n !== undefined && categoryLabel(i18n, c.id, c.label).toLowerCase() === lower),
    );
    return suggested?.id ?? typed;
}

/**
 * The flags the Preset turns on for Zones given this category: Restricted, Walk-around. Only
 * flags that are on are returned, so spreading the result never turns one off.
 */
export function categoryFlags(
    preset: Preset,
    category: string | null | undefined,
): Pick<Zone, 'restricted' | 'walkAround'> {
    const c = preset.categories.find((c) => c.id === category);
    return {
        ...(c?.restricted === true && { restricted: true }),
        ...(c?.walkAround === true && { walkAround: true }),
    };
}
