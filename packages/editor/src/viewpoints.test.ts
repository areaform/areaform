import { createSpace, type Level, type Viewpoint } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { nextViewpointName, viewpointMarks } from './viewpoints.ts';

const at = (bearing: number, tilt: number): Viewpoint => ({
    id: 'V',
    target: [10, 10],
    bearing,
    tilt,
    distance: 20,
});

describe('viewpointMarks', () => {
    const level: Level = {
        ...createSpace({ name: 'Office', kind: 'office', size: [20, 20] }).levels[0]!,
        viewpoints: [at(0, 30), { ...at(90, 60), id: 'W' }],
    };

    it('draws a line to the target, a wedge and the number in the tour, for each', () => {
        const marks = viewpointMarks(level, 2);

        expect(marks.map((m) => m.type)).toEqual([
            'line',
            'polygon',
            'label',
            'line',
            'polygon',
            'label',
        ]);
        expect(marks.filter((m) => m.type === 'label').map((m) => m.text)).toEqual(['1', '2']);
    });

    it('opens the wedge from the camera towards where it looks', () => {
        const wedge = viewpointMarks(level, 2)[1]!;
        if (wedge.type !== 'polygon') throw new Error('not a wedge');

        // Looking north from (10, 0): the wedge's far corners are 2 m ahead, either side.
        const far = wedge.shape.outer.filter(([, y]) => y > 1);
        expect(far).toHaveLength(2);
        far.forEach(([, y]) => expect(y).toBeCloseTo(2 * Math.cos((25 * Math.PI) / 180)));
    });

    it('draws nothing for a Level without Viewpoints', () => {
        const bare = createSpace({ name: 'Office', kind: 'office', size: [20, 20] }).levels[0]!;

        expect(viewpointMarks(bare, 2)).toEqual([]);
    });
});

describe('nextViewpointName', () => {
    it('numbers the next one after those there are', () => {
        const level = createSpace({ name: 'Office', kind: 'office', size: [20, 20] }).levels[0]!;

        expect(nextViewpointName(level, (n) => `Viewpoint ${n}`)).toBe('Viewpoint 1');
    });
});
