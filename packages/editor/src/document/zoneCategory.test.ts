import { createEditor, createSpace, defaultPresets, presetFor } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { categoryFlags, categoryFromText } from './categories.ts';
import { createEditorController } from '../interaction/controller.ts';
import { harness } from '../testing.ts';

describe('the Zone tool category', () => {
    it('starts at the Preset’s category, or none', () => {
        expect(harness('exhibition').controller.getState().zoneCategory).toBe('booth');
        expect(harness('warehouse').controller.getState().zoneCategory).toBe('bay');
        expect(harness('office').controller.getState().zoneCategory).toBeNull();
    });

    it('gives new Zones the category picked, with the flags the Preset gives it', () => {
        const h = harness('warehouse');
        h.controller.setTool('zone');

        h.controller.setZoneCategory('road');
        h.drag([1, 1], [9, 3]);
        h.controller.setZoneCategory('bay');
        h.drag([1, 5], [3, 7]);

        const [road, bay] = h.level().zones;
        expect(road).toMatchObject({ category: 'road', restricted: true });
        expect(road).not.toHaveProperty('walkAround');
        expect(bay).toMatchObject({ category: 'bay', walkAround: true });
        expect(bay).not.toHaveProperty('restricted');
    });

    it('takes a custom category, and none', () => {
        const h = harness('exhibition');
        h.controller.setTool('zone');

        h.controller.setZoneCategory('press-area');
        h.drag([1, 1], [3, 3]);
        h.controller.setZoneCategory(null);
        h.drag([5, 1], [7, 3]);

        expect(h.level().zones[0]?.category).toBe('press-area');
        expect(h.level().zones[1]).not.toHaveProperty('category');
    });

    it("starts from the host's own Preset", () => {
        const doc = createSpace({ name: 'P', kind: 'parking', size: [20, 10] });
        const parking = {
            label: 'Parking',
            gridStep: 2.5,
            levelHeight: 2.4,
            categories: [{ id: 'spot', label: 'Spot', exclusive: true }],
            zoneCategory: 'spot',
        };
        const controller = createEditorController(createEditor(doc), {
            levelId: doc.levels[0]!.id,
            presets: { parking },
        });

        expect(controller.getState().zoneCategory).toBe('spot');
    });
});

describe('categoryFromText', () => {
    const office = presetFor('office');

    it('stores a suggested category by id, whether its id or label was typed', () => {
        expect(categoryFromText(office, 'meeting-room')).toBe('meeting-room');
        expect(categoryFromText(office, ' Meeting Room ')).toBe('meeting-room');
        expect(categoryFromText(office, 'WC')).toBe('wc');
    });

    it('keeps any other text as typed, and blank as no category', () => {
        expect(categoryFromText(office, ' Server room ')).toBe('Server room');
        expect(categoryFromText(office, '  ')).toBeNull();
    });
});

describe('categoryFlags', () => {
    it('gives only the flags the Preset turns on for the category', () => {
        expect(categoryFlags(defaultPresets.warehouse!, 'road')).toEqual({ restricted: true });
        expect(categoryFlags(defaultPresets.warehouse!, 'bay')).toEqual({ walkAround: true });
        expect(categoryFlags(defaultPresets.warehouse!, 'office')).toEqual({});
        expect(categoryFlags(defaultPresets.warehouse!, null)).toEqual({});
    });
});

describe('setTools', () => {
    it('turns off the shortcuts of hidden tools', () => {
        const h = harness();
        h.controller.setTools(['select', 'zone']);

        expect(h.controller.keyDown({ key: 'w', shift: false, meta: false })).toBe(false);
        expect(h.controller.getState().tool).toBe('select');
        expect(h.controller.keyDown({ key: 'z', shift: false, meta: false })).toBe(true);
        expect(h.controller.getState().tool).toBe('zone');
    });

    it('leaves a tool that gets hidden for the first one shown', () => {
        const h = harness();
        h.controller.setTool('wall');

        h.controller.setTools(['zone', 'select']);

        expect(h.controller.getState().tool).toBe('zone');
    });

    it('shows every tool again when cleared', () => {
        const h = harness();
        h.controller.setTools(['select']);
        h.controller.setTools(undefined);

        expect(h.controller.keyDown({ key: 'w', shift: false, meta: false })).toBe(true);
    });
});
