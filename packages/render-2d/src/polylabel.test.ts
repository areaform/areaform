import type { Shape, Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { centrePrecision, visualCenter } from './polylabel.ts';

/** Distance from `p` to the nearest edge of a shape without holes. */
function edgeDistance(p: Vec2, shape: Shape): number {
    const ring = shape.outer;
    let min = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[j]!;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(
            0,
            Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)),
        );
        min = Math.min(min, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
    }
    return min;
}

function timed<T>(fn: () => T): { value: T; ms: number } {
    const start = performance.now();
    const value = fn();
    return { value, ms: performance.now() - start };
}

// The slowest Zones of the demo office (apps/server/demo/office.json): long and thin.
const serviceCorridor: Shape = {
    outer: [
        [36.6, 0.02],
        [43.64, 0.02],
        [43.64, 63],
        [36.6, 63],
    ],
};
const slopedCorridor: Shape = {
    outer: [
        [67.856, 4],
        [70.856, 4],
        [56.89, 38.61],
        [53.89, 38.61],
    ],
};

describe('centrePrecision', () => {
    it('is 1% of the shorter side, from 1 cm to 10 cm', () => {
        expect(centrePrecision(0.5)).toBe(0.01);
        expect(centrePrecision(5)).toBeCloseTo(0.05);
        expect(centrePrecision(40)).toBe(0.1);
    });
});

describe('visualCenter', () => {
    it('finds a long rectangle’s centre line, fast', () => {
        const { value, ms } = timed(() => visualCenter(serviceCorridor));
        // Half of the 7.04 m width is as far from the walls as a point can be.
        expect(edgeDistance(value, serviceCorridor)).toBeGreaterThan(3.52 - 0.1);
        expect(ms).toBeLessThan(20);
    });

    it('finds a sloped corridor’s middle, fast', () => {
        const { value, ms } = timed(() => visualCenter(slopedCorridor));
        // The corridor is 3 m across horizontally; its true width is 3 m × sin of its slope.
        const slope = Math.atan2(38.61 - 4, 70.856 - 56.89);
        const half = (3 * Math.sin(slope)) / 2;
        expect(edgeDistance(value, slopedCorridor)).toBeGreaterThan(half - 0.03);
        expect(ms).toBeLessThan(20);
    });

    it('keeps an L-shaped room’s centre inside the wider arm', () => {
        const shape: Shape = {
            outer: [
                [0, 0],
                [10, 0],
                [10, 2],
                [2, 2],
                [2, 10],
                [0, 10],
            ],
        };
        const centre = visualCenter(shape);
        expect(edgeDistance(centre, shape)).toBeGreaterThan(1 - 0.02);
    });

    it('still takes an exact precision when asked', () => {
        const centre = visualCenter(serviceCorridor, 0.001);
        expect(edgeDistance(centre, serviceCorridor)).toBeGreaterThan(3.52 - 0.001);
    });
});
