import { createSpace, type Level } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { levelLines } from './levelLines.ts';

const doc = createSpace({ name: 'Hall', kind: 'retail', size: [20, 10] });
const ground = doc.levels[0]!;

describe('levelLines', () => {
    it('frames the outline, y up like the plan', () => {
        const lines = levelLines(doc, ground)!;
        const ys = ground.outline.outer.map((p) => p[1]);
        expect(lines.viewBox).toEqual([0, -Math.max(...ys), 20, 10]);
        expect(lines.outline).toMatch(/^M.*Z$/);
        expect(lines.zones).toBe('');
    });

    it('draws a Zone, and a Level without an outline is framed by what it has', () => {
        const zoneOnly: Level = {
            ...ground,
            outline: { outer: [], holes: [] },
            zones: [
                {
                    id: 'z1',
                    category: 'booth',
                    shape: {
                        outer: [
                            [2, 2],
                            [6, 2],
                            [6, 5],
                            [2, 5],
                        ],
                        holes: [],
                    },
                },
            ] as Level['zones'],
        };
        const lines = levelLines(doc, zoneOnly)!;
        expect(lines.viewBox).toEqual([2, -5, 4, 3]);
        expect(lines.zones).toBe('M2 -2L6 -2L6 -5L2 -5Z');
    });

    it('has nothing to draw for an empty Level', () => {
        const empty: Level = { ...ground, outline: { outer: [], holes: [] }, zones: [] };
        expect(levelLines(doc, empty)).toBeNull();
    });
});
