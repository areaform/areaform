import { createSpace, type AreaformDocument, type Level } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { groupsOf, startingLevel } from './levelSwitcher.ts';

const base = createSpace({ name: 'Mall', kind: 'retail', size: [20, 10] });
const ground = base.levels[0]!;
const level = (id: string, ordinal: number, elevation: number, group?: string): Level => ({
    ...ground,
    id,
    name: id,
    ordinal,
    elevation,
    ...(group !== undefined && { group }),
});
const withLevels = (...levels: Level[]): AreaformDocument => ({ ...base, levels });

describe('startingLevel', () => {
    it('is the ground floor, wherever it is in the list', () => {
        const doc = withLevels(level('B1', -1, -4), level('G', 0, 0), level('L1', 1, 4));
        expect(startingLevel(doc).id).toBe('G');
    });

    it('is the lowest Level when none is at elevation 0', () => {
        const doc = withLevels(level('L2', 2, 8), level('L1', 1, 4));
        expect(startingLevel(doc).id).toBe('L1');
    });
});

describe('groupsOf', () => {
    it('lists the top floor first, in one unnamed group without Level Groups', () => {
        const doc = withLevels(level('G', 0, 0), level('L1', 1, 4), level('B1', -1, -4));
        expect(groupsOf(doc, 'Other')).toEqual([
            {
                levels: [
                    expect.objectContaining({ id: 'L1' }),
                    expect.objectContaining({ id: 'G' }),
                    expect.objectContaining({ id: 'B1' }),
                ],
            },
        ]);
    });

    it('gives each Level Group a heading, by name, and Levels without one come last as Other', () => {
        const doc = withLevels(
            level('B-G', 0, 0, 'Building B'),
            level('A-G', 0, 0, 'Building A'),
            level('A-1', 1, 4, 'Building A'),
            level('Kiosk', 0, 0),
        );
        expect(groupsOf(doc, 'Other').map((g) => [g.name, g.levels.map((l) => l.id)])).toEqual([
            ['Building A', ['A-1', 'A-G']],
            ['Building B', ['B-G']],
            ['Other', ['Kiosk']],
        ]);
    });
});
