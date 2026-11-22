import { describe, expect, it } from 'vitest';
import { createSpace } from './index.ts';

describe('createSpace', () => {
    it('creates a Space with one ground Level whose Outline is the starting rectangle', () => {
        const doc = createSpace({ name: 'Expo Hall', kind: 'exhibition', size: [40, 25] });

        expect(doc.schemaVersion).toBe(1);
        expect(doc.name).toBe('Expo Hall');
        expect(doc.kind).toBe('exhibition');
        expect(doc.units).toBe('m');
        expect(doc.connections).toEqual([]);
        expect(doc.levels).toHaveLength(1);

        const [level] = doc.levels;
        expect(level?.ordinal).toBe(0);
        expect(level?.elevation).toBe(0);
        expect(level?.outline).toEqual({
            outer: [
                [0, 0],
                [40, 0],
                [40, 25],
                [0, 25],
            ],
        });
        expect(level?.walls).toEqual([]);
        expect(level?.zones).toEqual([]);
    });

    it('takes the Grid Step and Level height from the Space Kind Preset', () => {
        const expo = createSpace({ name: 'Expo', kind: 'exhibition', size: [10, 10] });
        const office = createSpace({ name: 'Office', kind: 'office', size: [10, 10] });

        expect(expo.grid).toEqual({ step: 1, snap: true });
        expect(expo.levels[0]?.height).toBe(6);
        expect(office.grid).toEqual({ step: 0.5, snap: true });
        expect(office.levels[0]?.height).toBe(3);
    });

    it('lets an explicit Grid Step override the Preset', () => {
        const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [10, 10], gridStep: 3 });

        expect(doc.grid.step).toBe(3);
    });

    it('accepts a client-defined Space Kind with generic defaults', () => {
        const doc = createSpace({ name: 'Garage', kind: 'parking', size: [10, 10] });

        expect(doc.kind).toBe('parking');
        expect(doc.grid).toEqual({ step: 1, snap: true });
        expect(doc.levels[0]?.height).toBe(3);
    });

    it('gives the Space and its Level unique ids', () => {
        const a = createSpace({ name: 'A', kind: 'office', size: [10, 10] });
        const b = createSpace({ name: 'B', kind: 'office', size: [10, 10] });

        expect(a.id).not.toBe(b.id);
        expect(a.levels[0]?.id).not.toBe(b.levels[0]?.id);
        expect(a.id).not.toBe(a.levels[0]?.id);
    });

    it('names the first Level "Level 1", or as asked', () => {
        expect(createSpace({ name: 'A', kind: 'office', size: [10, 10] }).levels[0]?.name).toBe(
            'Level 1',
        );
        const named = createSpace({
            name: 'A',
            kind: 'office',
            size: [10, 10],
            levelName: 'Poziom 1',
        });
        expect(named.levels[0]?.name).toBe('Poziom 1');
    });

    it('sets the default Content Language when given one, and leaves it unknown otherwise', () => {
        const polish = createSpace({
            name: 'Hala',
            kind: 'office',
            size: [10, 10],
            language: 'pl',
        });
        const unknown = createSpace({ name: 'Hall', kind: 'office', size: [10, 10] });

        expect(polish.languages).toEqual({ default: 'pl' });
        expect(unknown).not.toHaveProperty('languages');
    });
});
