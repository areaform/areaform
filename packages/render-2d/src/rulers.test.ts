import { describe, expect, it } from 'vitest';
import { createCamera } from './camera.ts';
import { roundStep, rulerStep, rulerTicks } from './rulers.ts';

const FOOT = 0.3048;

describe('roundStep', () => {
    it('picks the smallest of 1, 2, 5 × 10ⁿ that keeps numbers apart', () => {
        expect(roundStep(100)).toBe(0.5);
        expect(roundStep(48)).toBe(1);
        expect(roundStep(30)).toBe(2);
        expect(roundStep(10)).toBe(5);
        expect(roundStep(5)).toBe(10);
        expect(roundStep(0.5)).toBe(100);
    });
});

describe('rulerStep', () => {
    it('numbers the strong grid lines in metres', () => {
        // A 1 m grid at 20 px/m: strong lines every 5 m, 100 px apart.
        expect(rulerStep(1, 20)).toBe(5);
        // Zoomed out, the grid thins to every 5 m, so strong lines every 25 m.
        expect(rulerStep(1, 4)).toBe(25);
        expect(rulerStep(0.25, 40)).toBe(1.25);
    });

    it('numbers every grid line when strong lines are far apart', () => {
        expect(rulerStep(1, 50)).toBe(1);
    });

    it('counts feet in round steps, whatever the metric grid', () => {
        // 20 px/m is about 6 px/ft: 10 ft (61 px) is the smallest round step.
        expect(rulerStep(1, 20, FOOT)).toBe(10);
        expect(rulerStep(1, 100, FOOT)).toBe(2);
    });
});

describe('rulerTicks', () => {
    // 400 × 200 px around (5, 2) at 20 px/m: x from -5 to 15 m, y from -3 to 7 m.
    const camera = createCamera({
        viewport: { width: 400, height: 200 },
        center: [5, 2],
        zoom: 20,
    });

    it('places a tick at every step on screen', () => {
        const ticks = rulerTicks(camera, 5);

        expect(ticks.xs).toEqual([
            { value: -5, at: 0 },
            { value: 0, at: 100 },
            { value: 5, at: 200 },
            { value: 10, at: 300 },
            { value: 15, at: 400 },
        ]);
        // Top to bottom: Y grows upwards.
        expect(ticks.ys).toEqual([
            { value: 5, at: 40 },
            { value: 0, at: 140 },
        ]);
    });

    it('counts in feet', () => {
        const ticks = rulerTicks(camera, 10, FOOT);

        expect(ticks.xs.map((t) => t.value)).toEqual([-10, 0, 10, 20, 30, 40]);
        expect(ticks.xs[1]!.at).toBe(100);
        expect(ticks.xs[2]!.at).toBeCloseTo(100 + 10 * FOOT * 20);
    });

    it('never writes -0 at the origin', () => {
        // The view starts at x = -0.5, where the first tick is k = ceil(-0.5) = -0.
        const left = createCamera({
            viewport: { width: 100, height: 100 },
            center: [2, 1],
            zoom: 20,
        });
        expect(Object.is(rulerTicks(left, 1).xs[0]!.value, 0)).toBe(true);
    });

    it('keeps fractional steps exact', () => {
        const near = createCamera({
            viewport: { width: 100, height: 100 },
            center: [0.5, 0],
            zoom: 100,
        });
        expect(rulerTicks(near, 0.1).xs.map((t) => t.value)).toEqual([
            0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
        ]);
    });
});
