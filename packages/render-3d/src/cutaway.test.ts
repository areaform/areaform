import { describe, expect, it } from 'vitest';
import { CUT_SOFTNESS, cutawayOf, TEXT_FULL, TEXT_START, wallCut } from './cutaway.ts';
import { frame, VIEWS, type Vec3 } from './view.ts';

// A 20 × 10 m Level: x 0…20, z −10…0 (plan y is world −z).
const box = { min: [0, -0.15, -10] as Vec3, max: [20, 3, 0] as Vec3 };

describe('cutawayOf', () => {
    it('cuts fully from the ¾ view, looking across the floor towards the target', () => {
        const { position, target } = frame(box, VIEWS.perspective, 45, 1.5);
        const { direction, amount } = cutawayOf(position, target);

        expect(amount).toBe(1);
        expect(Math.hypot(...direction)).toBeCloseTo(1);
        // The ¾ view looks north (−z), from a little east (−x).
        expect(direction[1]).toBeLessThan(-0.9);
        expect(direction[0]).toBeLessThan(0);
    });

    it('cuts nothing from straight above, where Walls hide nothing', () => {
        const { position, target } = frame(box, VIEWS.top, 45, 1.5);

        expect(cutawayOf(position, target).amount).toBe(0);
        expect(cutawayOf([10, 30, -5], [10, 0, -5])).toEqual({ direction: [0, -1], amount: 0 });
    });

    it('goes down gradually as the camera tilts', () => {
        const at = (degrees: number) => {
            const polar = (degrees * Math.PI) / 180;
            return cutawayOf([0, Math.cos(polar), Math.sin(polar)], [0, 0, 0]).amount;
        };

        expect(at(5)).toBe(0);
        expect(at(14)).toBeGreaterThan(0);
        expect(at(14)).toBeLessThan(1);
        expect(at(30)).toBe(1);
    });
});

describe('cutawayOf as names become readable', () => {
    /** The amount at 45° tilt with a name of the Theme's size `scale` times the smallest drawn. */
    const at = (scale: number) => cutawayOf([0, 10, 10], [0, 0, 0], scale).amount;

    it('stands while there is nothing to read, and is down by the time names show', () => {
        expect(at(0.5)).toBe(0);
        expect(at(TEXT_START)).toBe(0);
        const between = at((TEXT_START + TEXT_FULL) / 2);
        expect(between).toBeGreaterThan(0);
        expect(between).toBeLessThan(1);
        expect(at(TEXT_FULL)).toBe(1);
        expect(at(3)).toBe(1);
    });

    it('still keeps Walls standing from straight above, however readable', () => {
        expect(cutawayOf([0, 1, 0], [0, 0, 0], 3).amount).toBe(0);
    });
});

describe('wallCut', () => {
    // Looking north from the south.
    const target: Vec3 = [10, 0, -5];
    const cutaway = cutawayOf([10, 10, 10], target);

    it('lowers Walls nearer the camera than the target and keeps those beyond it', () => {
        expect(wallCut([10, 0], target, cutaway)).toBe(1); // the south Wall
        expect(wallCut([10, -10], target, cutaway)).toBe(0); // the north Wall
    });

    it('goes by depth only, so a whole Wall across the near side goes down together', () => {
        expect(wallCut([0, -1], target, cutaway)).toBe(1);
        expect(wallCut([20, -1], target, cutaway)).toBe(1);
    });

    it('eases Walls near the target down, so orbiting past one never pops', () => {
        expect(wallCut([10, -5], target, cutaway)).toBeCloseTo(0.5);
        expect(wallCut([10, -5 + CUT_SOFTNESS / 2], target, cutaway)).toBeGreaterThan(0.5);
        expect(wallCut([10, -5 - CUT_SOFTNESS / 2], target, cutaway)).toBeLessThan(0.5);
    });

    it('scales with the tilt', () => {
        // About 14° from straight down.
        const steep = cutawayOf([10, 10, -2.5], target);

        expect(steep.amount).toBeGreaterThan(0);
        expect(steep.amount).toBeLessThan(1);
        expect(wallCut([10, 0], target, steep)).toBeCloseTo(steep.amount);
    });
});
