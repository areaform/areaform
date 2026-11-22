import { describe, expect, it } from 'vitest';
import { gridLines } from './grid.ts';

const box = { minX: -0.5, minY: 0, maxX: 3.2, maxY: 2 };

describe('gridLines', () => {
    it('draws a line at every multiple of the grid step inside the view', () => {
        const lines = gridLines(box, 1, 50);

        expect(lines.spacing).toBe(1);
        expect(lines.minor.xs).toEqual([1, 2, 3]);
        expect(lines.minor.ys).toEqual([1, 2]);
        // Every fifth line is a major one: here only the origin lines.
        expect(lines.major.xs).toEqual([0]);
        expect(lines.major.ys).toEqual([0]);
    });

    it('spaces lines further apart when they would crowd together on screen', () => {
        // 1 m at 4 px/m would be 4 px apart: every 5 m (20 px) instead, majors every 25 m.
        const lines = gridLines({ minX: 0, minY: 0, maxX: 60, maxY: 30 }, 1, 4);

        expect(lines.spacing).toBe(5);
        expect(lines.minor.xs).toEqual([5, 10, 15, 20, 30, 35, 40, 45, 55, 60]);
        expect(lines.major.xs).toEqual([0, 25, 50]);
    });

    it('keeps to the step for fractional steps', () => {
        const lines = gridLines({ minX: 0, minY: 0, maxX: 1, maxY: 0.4 }, 0.25, 100);

        expect(lines.minor.xs).toEqual([0.25, 0.5, 0.75, 1]);
        expect(lines.minor.ys).toEqual([0.25]);
    });

    it('draws nothing without a positive step', () => {
        expect(gridLines(box, 0, 50)).toEqual({
            spacing: 0,
            minor: { xs: [], ys: [] },
            major: { xs: [], ys: [] },
        });
    });
});
