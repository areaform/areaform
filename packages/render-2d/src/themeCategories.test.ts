import { defaultPresets, genericPreset } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { defaultTheme } from './theme.ts';

describe('defaultTheme.categories', () => {
    it('colours every category a built-in Preset suggests', () => {
        const ids = [genericPreset, ...Object.values(defaultPresets)].flatMap((p) =>
            p.categories.map((c) => c.id),
        );
        for (const id of ids) expect(defaultTheme.categories, id).toHaveProperty([id]);
    });
});
