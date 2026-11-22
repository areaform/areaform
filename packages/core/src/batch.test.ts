import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    defaultPresets,
    exclusiveCategories,
    genericPreset,
    presetFor,
    type Preset,
    type PresetCategory,
    type Ring,
} from './index.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

function officeEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const level = () => editor.getDocument().levels[0]!;
    editor.exec({ type: 'wall.add', levelId, id: 'W', a: [0, 5], b: [10, 5], thickness: 0.1 });
    editor.exec({
        type: 'opening.add',
        levelId,
        opening: { id: 'D', kind: 'door', width: 0.9, host: 'wall', wallId: 'W', offset: 2 },
    });
    editor.exec({
        type: 'zone.add',
        levelId,
        zone: { id: 'Z1', shape: { outer: square(1, 1, 2) } },
    });
    editor.exec({
        type: 'zone.add',
        levelId,
        zone: { id: 'Z2', shape: { outer: square(4, 1, 2) } },
    });
    return { editor, levelId, level };
}

describe('batch', () => {
    it('applies several Commands as one undo step', () => {
        const { editor, levelId, level } = officeEditor();
        const before = editor.getDocument();

        const result = editor.exec({
            type: 'batch',
            commands: [
                { type: 'zone.delete', levelId, zoneId: 'Z1' },
                { type: 'zone.delete', levelId, zoneId: 'Z2' },
            ],
        });

        expect(result.ok).toBe(true);
        expect(level().zones).toEqual([]);
        editor.undo();
        expect(editor.getDocument()).toBe(before);
    });

    it('is rejected as a whole when any Command in it is rejected', () => {
        const { editor, levelId } = officeEditor();
        const before = editor.getDocument();

        const result = editor.exec({
            type: 'batch',
            commands: [
                { type: 'zone.delete', levelId, zoneId: 'Z1' },
                { type: 'zone.delete', levelId, zoneId: 'ghost' },
            ],
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'unknown-element', id: 'ghost' }] });
        expect(editor.getDocument()).toBe(before);
    });

    it('can be previewed, listing everything every Command in it removes', () => {
        const { editor, levelId } = officeEditor();

        const preview = editor.preview({
            type: 'batch',
            commands: [
                { type: 'wall.delete', levelId, wallId: 'W' },
                { type: 'zone.delete', levelId, zoneId: 'Z1' },
            ],
        });

        const ids = preview.ok ? preview.removed.map((r) => r.id).sort() : [];
        expect(ids).toEqual(expect.arrayContaining(['D', 'W', 'Z1']));
    });
});

describe('opening.update / opening.delete', () => {
    it('changes and removes an Opening', () => {
        const { editor, levelId, level } = officeEditor();

        editor.exec({
            type: 'opening.update',
            levelId,
            openingId: 'D',
            changes: { width: 1.2, offset: 4 },
        });
        expect(level().openings[0]).toMatchObject({ width: 1.2, offset: 4 });

        editor.exec({ type: 'opening.delete', levelId, openingId: 'D' });
        expect(level().openings).toEqual([]);
    });
});

describe('wall.update', () => {
    it('changes thickness and height, but not the Wall Nodes', () => {
        const { editor, levelId, level } = officeEditor();
        const { a, b } = level().walls[0]!;

        editor.exec({
            type: 'wall.update',
            levelId,
            wallId: 'W',
            changes: { thickness: 0.3, height: 2.5 },
        });

        expect(level().walls[0]).toEqual({ id: 'W', a, b, thickness: 0.3, height: 2.5 });
    });
});

describe('presetFor', () => {
    it('exposes the Preset of a Space Kind', () => {
        expect(exclusiveCategories(presetFor('exhibition'))).toEqual(['booth']);
        expect(presetFor('warehouse').zoneCategory).toBe('bay');
    });

    it('gives the generic Preset to a Kind without one, even one named like an Object key', () => {
        expect(presetFor('parking')).toBe(genericPreset);
        expect(presetFor('constructor')).toBe(genericPreset);
    });

    it("looks the Kind up in a host's own Presets", () => {
        const parking: Preset = {
            label: 'Parking',
            gridStep: 2.5,
            levelHeight: 2.4,
            categories: [],
        };
        const presets = { ...defaultPresets, parking };

        expect(presetFor('parking', presets)).toBe(parking);
        expect(presetFor('flat', presets)).toBe(defaultPresets.flat);
        expect(createSpace({ name: 'P', kind: 'parking', size: [50, 30], presets }).grid.step).toBe(
            2.5,
        );
    });

    it('lists each category once, includes its Zone tool category, and agrees on Restricted and Walk-around', () => {
        const byId = new Map<string, PresetCategory>();
        for (const preset of [genericPreset, ...Object.values(defaultPresets)]) {
            expect(new Set(preset.categories.map((c) => c.id)).size).toBe(preset.categories.length);
            if (preset.zoneCategory !== undefined)
                expect(preset.categories.map((c) => c.id)).toContain(preset.zoneCategory);
            for (const category of preset.categories) {
                const seen = byId.get(category.id);
                if (seen) {
                    expect(category.restricted).toBe(seen.restricted);
                    expect(category.walkAround).toBe(seen.walkAround);
                }
                byId.set(category.id, category);
            }
        }
    });
});
