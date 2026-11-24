import { underlayCorners, type Underlay, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness } from '../testing.ts';

/**
 * A 10 × 5 m scan (1000 × 500 px at 0.01 m) covering x 0–10, y 5–10 of the 20 × 10 m test Space.
 * Its corners, counter-clockwise from the bottom-left: (0, 5), (10, 5), (10, 10), (0, 10).
 */
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
    const selectScan = () =>
        h.controller.select([{ kind: 'underlay', id: 'SCAN', levelId: h.levelId }]);
    return { ...h, scan, selectScan };
}

const close = (actual: Vec2, expected: Vec2) => {
    expect(actual[0]).toBeCloseTo(expected[0]);
    expect(actual[1]).toBeCloseTo(expected[1]);
};

describe('Resizing an Underlay by a corner', () => {
    it('keeps the opposite corner in place and the proportions, as one undo step', () => {
        const h = withScan();
        h.selectScan();

        // From the bottom-right corner, past the diagonal's end: only the part along it counts.
        h.drag([10, 5], [12, 4]);

        expect(h.scan().scale).toBeCloseTo(0.012);
        close(h.scan().position, [0, 10]);
        close(underlayCorners(h.scan())![1]!, [12, 4]);
        h.key('z', { meta: true });
        expect(h.scan().scale).toBe(0.01);
    });

    it('resizes around the centre with Alt', () => {
        const h = withScan();
        h.selectScan();

        h.drag([10, 5], [11, 4.5], { alt: true });

        expect(h.scan().scale).toBeCloseTo(0.012);
        const corners = underlayCorners(h.scan())!;
        close(
            [(corners[0]![0] + corners[2]![0]) / 2, (corners[0]![1] + corners[2]![1]) / 2],
            [5, 7.5],
        );
    });

    it('works along a turned image, without turning it', () => {
        const h = withScan({ rotation: Math.PI / 6 });
        h.selectScan();
        // The image's bottom-right corner, and its top-left, which stays put.
        const [anchor, corner] = [underlayCorners(h.scan())![3]!, underlayCorners(h.scan())![1]!];

        const to: Vec2 = [
            anchor[0] + (corner[0] - anchor[0]) * 1.5,
            anchor[1] + (corner[1] - anchor[1]) * 1.5,
        ];
        h.drag(corner, to);

        expect(h.scan().scale).toBeCloseTo(0.015);
        expect(h.scan().rotation).toBeCloseTo(Math.PI / 6);
        close(underlayCorners(h.scan())![3]!, anchor);
    });

    it('stops at 1 m on the longer side and never mirrors the image', () => {
        const h = withScan();
        h.selectScan();

        h.drag([10, 5], [-5, 15]);

        expect(h.scan().scale).toBeCloseTo(0.001);
        close(h.scan().position, [0, 10]);
    });

    it('puts the image back when Esc is pressed during the drag', () => {
        const h = withScan();
        h.selectScan();
        h.controller.pointerDown({ point: [10, 5] });
        h.controller.pointerMove({ point: [14, 3] });
        expect(h.scan().scale).not.toBe(0.01);

        expect(h.key('Escape')).toBe(true);
        h.controller.pointerUp({ point: [14, 3] });

        expect(h.scan().scale).toBe(0.01);
        h.key('z', { meta: true });
        // Nothing was recorded, so undo goes back to before the Underlay was added.
        expect(h.level().underlays).toEqual([]);
    });

    it('shows the size while dragging, in the display units', () => {
        const h = withScan();
        h.selectScan();
        h.controller.pointerDown({ point: [10, 5] });
        h.controller.pointerMove({ point: [12, 4] });

        const labels = h.controller
            .getState()
            .overlay.flatMap((item) => (item.type === 'label' ? [item.text] : []));
        expect(labels).toContain('12.00 × 6.00 m');
        h.controller.pointerUp({ point: [12, 4] });
    });

    it('takes the pointer at a corner even under a Zone; elsewhere the Zone is picked', () => {
        const h = withScan();
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: {
                id: 'Z',
                shape: {
                    outer: [
                        [8, 3],
                        [12, 3],
                        [12, 7],
                        [8, 7],
                    ],
                },
            },
        });
        h.selectScan();

        h.drag([10, 5], [12, 4]);

        expect(h.scan().scale).toBeCloseTo(0.012);
        expect(h.level().zones[0]!.shape.outer[0]).toEqual([8, 3]);
        h.click([11, 3.5]);
        expect(h.controller.getState().selection).toEqual([
            { kind: 'zone', id: 'Z', levelId: h.levelId },
        ]);
    });

    it('offers no corners on a locked Underlay, or with more selected', () => {
        const locked = withScan({ locked: true });
        locked.selectScan();
        locked.drag([10, 5], [12, 4]);
        expect(locked.scan().scale).toBe(0.01);

        const two = withScan();
        two.editor.exec({
            type: 'zone.add',
            levelId: two.levelId,
            zone: {
                id: 'Z',
                shape: {
                    outer: [
                        [14, 1],
                        [16, 1],
                        [16, 3],
                        [14, 3],
                    ],
                },
            },
        });
        two.controller.select([
            { kind: 'underlay', id: 'SCAN', levelId: two.levelId },
            { kind: 'zone', id: 'Z', levelId: two.levelId },
        ]);
        two.drag([10, 5], [12, 4]);
        expect(two.scan().scale).toBe(0.01);
    });

    it('shows a diagonal resize cursor over a corner, turning with the image', () => {
        const h = withScan();
        h.selectScan();
        h.move([10, 5]);
        expect(h.controller.getState().cursor).toBe('nwse-resize');
        h.move([10, 10]);
        expect(h.controller.getState().cursor).toBe('nesw-resize');
        h.move([5, 7.5]);
        expect(h.controller.getState().cursor).toBeNull();

        const turned = withScan({ rotation: Math.PI / 2 });
        turned.selectScan();
        turned.move(underlayCorners(turned.scan())![1]!);
        expect(turned.controller.getState().cursor).toBe('nesw-resize');
    });
});
