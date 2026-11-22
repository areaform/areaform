import { createEditor, createSpace, type Command } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createTranslator, english } from './i18n/index.ts';
import { elementName, problemLevel, problemText } from './problems.ts';

const square = (x: number): [number, number][] => [
    [x, 1],
    [x + 2, 1],
    [x + 2, 3],
    [x, 3],
];

function hall() {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] }));
    const L = editor.getDocument().levels[0]!.id;
    const commands: Command[] = [
        {
            type: 'zone.add',
            levelId: L,
            zone: { id: 'A1', shape: { outer: square(1) }, label: 'A-1' },
        },
        {
            type: 'zone.add',
            levelId: L,
            zone: { id: 'wc', shape: { outer: square(4) }, category: 'wc' },
        },
        { type: 'zone.add', levelId: L, zone: { id: 'z', shape: { outer: square(7) } } },
        {
            type: 'obstacle.add',
            levelId: L,
            obstacle: { id: 'col', kind: 'column', shape: { outer: square(10) } },
        },
        { type: 'wall.add', levelId: L, id: 'W', a: [0, 5], b: [10, 5], thickness: 0.1 },
        {
            type: 'opening.add',
            levelId: L,
            opening: { id: 'D', kind: 'door', width: 0.9, host: 'wall', wallId: 'W', offset: 2 },
        },
    ];
    for (const command of commands) editor.exec(command);
    return { doc: editor.getDocument(), L };
}

describe('elementName', () => {
    it('names a Zone by its label, else its category, else as a Zone; other Elements by kind', () => {
        const { doc, L } = hall();
        const name = (kind: 'zone' | 'obstacle' | 'opening' | 'wall', id: string) =>
            elementName(doc, { kind, id, levelId: L }, english);
        expect(name('zone', 'A1')).toBe('A-1');
        expect(name('zone', 'wc')).toBe('WC');
        expect(name('zone', 'z')).toBe('A Zone');
        expect(name('obstacle', 'col')).toBe('Column');
        expect(name('opening', 'D')).toBe('Door');
        expect(name('wall', 'W')).toBe('A Wall');
        expect(elementName(doc, { kind: 'level', id: L }, english)).toMatch(/^The Outline of /);
        expect(name('zone', 'gone')).toBe('A Zone');
    });
});

describe('problemText', () => {
    it('says each kind of Problem in words', () => {
        const { doc, L } = hall();
        const zone = (id: string) => ({ kind: 'zone' as const, id, levelId: L });
        expect(problemText(doc, { code: 'zone-unreachable', ref: zone('A1') }, english)).toBe(
            "Visitors can't reach A-1: no door or passage leads to it",
        );
        expect(
            problemText(
                doc,
                { code: 'zones-overlap', ref: zone('A1'), other: zone('wc') },
                english,
            ),
        ).toBe('A-1 overlaps WC');
        expect(problemText(doc, { code: 'outside-outline', ref: zone('wc') }, english)).toBe(
            'WC is outside the Outline',
        );
        expect(
            problemText(
                doc,
                { code: 'opening-off-wall', ref: { kind: 'opening', id: 'D', levelId: L } },
                english,
            ),
        ).toBe('Door no longer fits on its Wall');
    });

    it('is in the interface language', () => {
        const { doc, L } = hall();
        expect(
            problemText(
                doc,
                { code: 'zone-unreachable', ref: { kind: 'zone', id: 'A1', levelId: L } },
                createTranslator('pl'),
            ),
        ).toBe('A-1: odwiedzający tu nie dotrą, nie prowadzą tu żadne drzwi ani przejście');
    });
});

describe('problemLevel', () => {
    it('is the Level of the Element, or the Level of an Outline', () => {
        expect(
            problemLevel({ code: 'outside-outline', ref: { kind: 'zone', id: 'z', levelId: 'L' } }),
        ).toBe('L');
        expect(problemLevel({ code: 'holes-overlap', ref: { kind: 'level', id: 'L' } })).toBe('L');
    });
});
