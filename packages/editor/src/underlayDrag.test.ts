import { underlayCorners, type Underlay, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness } from './testing.ts';

/** A 10 × 5 m scan covering x 0–10, y 5–10 of the 20 × 10 m test Space. */
function withScan(overrides: Partial<Underlay> = {}) {
    const h = harness();
    h.editor.exec({
        type: 'underlay.add',
        levelId: h.levelId,
        underlay: {
            id: 'SCAN',
            src: 'scan.png',
            position: [0, 10],
            scale: 0.01,
            rotation: 0,
            opacity: 0.5,
            locked: false,
            size: [1000, 500],
            ...overrides,
        },
    });
    const scan = () => h.level().underlays[0]!;
    return { ...h, scan };
}

const centre = (corners: Vec2[]): Vec2 => [
    corners.reduce((sum, p) => sum + p[0], 0) / corners.length,
    corners.reduce((sum, p) => sum + p[1], 0) / corners.length,
];

describe('Dragging an Underlay', () => {
    it('selects an unlocked Underlay and moves it by whole grid steps, as one undo step', () => {
        const h = withScan();

        h.drag([5, 8], [7.3, 6.8]);

        expect(h.controller.getState().selection).toEqual([
            { kind: 'underlay', id: 'SCAN', levelId: h.levelId },
        ]);
        expect(h.scan().position).toEqual([2, 9]);
        h.key('z', { meta: true });
        expect(h.scan().position).toEqual([0, 10]);
    });

    it('leaves a locked Underlay where it is; the drag box-selects instead', () => {
        const h = withScan({ locked: true });

        h.drag([5, 8], [7.3, 6.8]);

        expect(h.scan().position).toEqual([0, 10]);
        expect(h.controller.getState().selection).toEqual([]);
    });

    it('turns a selected Underlay a quarter with R, its corners staying on the grid', () => {
        const h = withScan();
        h.click([5, 8]);

        h.key('r');

        expect(Math.abs(h.scan().rotation)).toBeCloseTo(Math.PI / 2);
        const corners = underlayCorners(h.scan())!;
        for (const [x, y] of corners) {
            expect(x).toBeCloseTo(Math.round(x));
            expect(y).toBeCloseTo(Math.round(y));
        }
        // About the middle of the image; the pivot shifts half a step to keep corners on the grid,
        // which moves the centre by less than one grid step.
        const [x, y] = centre(corners);
        expect(Math.hypot(x - 5, y - 7.5)).toBeLessThan(1);
    });
});
