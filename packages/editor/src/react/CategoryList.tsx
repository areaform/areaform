import type { Preset } from '@areaform/core';
import { categoryLabel } from '../i18n/index.ts';
import { useI18n } from './i18n.ts';

/** A `<datalist>` of the Preset's Zone Categories, for a text field that also takes any other. */
export function CategoryList({ id, preset }: { id: string; preset: Preset }) {
    const i18n = useI18n();
    return (
        <datalist id={id}>
            {preset.categories.map((c) => (
                <option key={c.id} value={c.id} label={categoryLabel(i18n, c.id, c.label)} />
            ))}
        </datalist>
    );
}
