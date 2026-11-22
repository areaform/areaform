import { createEditor, createSpace, type Command } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createTranslator, english } from '../i18n/translator.ts';
import { tooltipText } from './tooltip.ts';

const square = (x: number): [number, number][] => [
    [x, 1],
    [x + 2, 1],
    [x + 2, 3],
    [x, 3],
];

/** A hall in English with Polish offered, with a few Elements to hover. */
function hall() {
    const doc = createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10], language: 'en' });
    const editor = createEditor(doc);
    const L = doc.levels[0]!.id;
    const commands: Command[] = [
        { type: 'space.update', changes: { languages: { default: 'en', others: ['pl'] } } },
        { type: 'level.add', id: 'L2', name: 'Level 2' },
        {
            type: 'zone.add',
            levelId: L,
            zone: { id: 'A1', shape: { outer: square(1) }, label: 'A-1', category: 'booth' },
        },
        { type: 'zone.add', levelId: L, zone: { id: 'aisle', shape: { outer: square(4) } } },
        {
            type: 'zone.add',
            levelId: L,
            zone: { id: 'wc', shape: { outer: square(7) }, category: 'wc' },
        },
        {
            type: 'obstacle.add',
            levelId: L,
            obstacle: { id: 'C', kind: 'column', shape: { outer: square(10) } },
        },
        {
            type: 'connection.add',
            connection: {
                id: 'lift',
                kind: 'elevator',
                name: 'Lift',
                bidirectional: true,
                stops: [
                    { levelId: L, shape: { outer: square(13) } },
                    { levelId: 'L2', shape: { outer: square(13) } },
                ],
            },
        },
        {
            type: 'text.set',
            target: { kind: 'zone', levelId: L, zoneId: 'A1' },
            language: 'pl',
            text: 'Stoisko A-1',
        },
    ];
    for (const command of commands) {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return { doc: editor.getDocument(), L };
}

describe('tooltipText', () => {
    it('gives a Zone’s name and category, in the visitor’s language', () => {
        const { doc, L } = hall();
        const ref = { kind: 'zone', id: 'A1', levelId: L } as const;

        expect(tooltipText(doc, ref, english)).toEqual({ title: 'A-1', detail: 'Booth' });
        expect(tooltipText(doc, ref, createTranslator('pl'), 'pl')).toEqual({
            title: 'Stoisko A-1',
            detail: 'Stoisko',
        });
    });

    it('names an unnamed Zone by its category, and says nothing for one with neither', () => {
        const { doc, L } = hall();

        expect(tooltipText(doc, { kind: 'zone', id: 'wc', levelId: L }, english)).toEqual({
            title: 'WC',
        });
        expect(tooltipText(doc, { kind: 'zone', id: 'aisle', levelId: L }, english)).toBeNull();
    });

    it('gives a Connection’s name and kind, and an Obstacle’s kind', () => {
        const { doc, L } = hall();

        expect(tooltipText(doc, { kind: 'stop', id: 'lift', levelId: L }, english)).toEqual({
            title: 'Lift',
            detail: 'Elevator',
        });
        expect(tooltipText(doc, { kind: 'obstacle', id: 'C', levelId: L }, english)).toEqual({
            title: 'Column',
        });
    });

    it('leaves out a category that only repeats the name', () => {
        const { doc, L } = hall();
        const ref = { kind: 'zone', id: 'wc', levelId: L } as const;
        const named = {
            ...doc,
            levels: doc.levels.map((l) => ({
                ...l,
                zones: l.zones.map((z) => (z.id === 'wc' ? { ...z, label: 'wc' } : z)),
            })),
        };

        expect(tooltipText(named, ref, english)).toEqual({ title: 'wc' });
    });

    it('says nothing for Walls, Levels or Elements that are gone', () => {
        const { doc, L } = hall();

        expect(tooltipText(doc, { kind: 'wall', id: 'W', levelId: L }, english)).toBeNull();
        expect(tooltipText(doc, { kind: 'level', id: L }, english)).toBeNull();
        expect(tooltipText(doc, { kind: 'zone', id: 'gone', levelId: L }, english)).toBeNull();
    });
});
