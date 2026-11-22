import type { Ring, Vec2 } from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { harness, wallSegments } from './testing.ts';

const booth: Ring = [
    [2, 2],
    [4, 2],
    [4, 5],
    [2, 5],
];

function withBooth() {
    const h = harness('exhibition');
    h.editor.exec({
        type: 'zone.add',
        levelId: h.levelId,
        zone: { id: 'B', shape: { outer: booth } },
    });
    h.controller.select([{ kind: 'zone', id: 'B', levelId: h.levelId }]);
    const shape = () => h.level().zones[0]!.shape.outer;
    return { ...h, shape };
}

const handleOf = (overlay: OverlayItem[]) =>
    overlay.find(
        (i): i is Extract<OverlayItem, { type: 'marker' }> =>
            i.type === 'marker' && i.kind === 'node',
    );

describe('rotating the selection with R', () => {
    it('turns it 90° counter-clockwise about its centre, snapped to the grid', () => {
        const h = withBooth();

        expect(h.key('r')).toBe(true);

        // Centre (3, 3.5) snaps to (3, 4); (x, y) → (7 − y, x + 1).
        expect(h.shape()).toEqual([
            [5, 3],
            [5, 5],
            [2, 5],
            [2, 3],
        ]);
    });

    it('turns clockwise with Shift, and four turns come back to the start', () => {
        const h = withBooth();

        h.key('R', { shift: true });
        h.key('r');
        for (let i = 0; i < 4; i++) h.key('r');

        expect(h.shape()).toEqual(booth);
    });

    it('is one undo step per turn', () => {
        const h = withBooth();
        h.key('r');
        h.key('r');

        h.key('z', { meta: true });
        h.key('z', { meta: true });

        expect(h.shape()).toEqual(booth);
    });

    it('turns a Wall about its middle, and its door goes with it', () => {
        const h = harness();
        h.editor.exec({
            type: 'wall.add',
            levelId: h.levelId,
            id: 'W',
            a: [0, 5],
            b: [10, 5],
            thickness: 0.2,
        });
        h.editor.exec({
            type: 'opening.add',
            levelId: h.levelId,
            opening: { id: 'D', kind: 'door', width: 0.9, host: 'wall', wallId: 'W', offset: 3 },
        });
        h.controller.select([{ kind: 'wall', id: 'W', levelId: h.levelId }]);

        h.key('r');

        expect(wallSegments(h.level())).toEqual(['5,0 → 5,10']);
        expect(h.level().openings[0]).toMatchObject({ wallId: 'W', offset: 3 });
    });

    it('turns a free Opening’s position and direction', () => {
        const h = harness();
        h.editor.exec({
            type: 'opening.add',
            levelId: h.levelId,
            opening: {
                id: 'E',
                kind: 'entrance',
                width: 2,
                host: 'free',
                position: [6, 0],
                angle: 0,
            },
        });
        h.controller.select([{ kind: 'opening', id: 'E', levelId: h.levelId }]);

        h.key('r');

        const entrance = h.level().openings[0];
        expect(entrance?.host === 'free' && entrance.position).toEqual([6, 0]);
        expect(entrance?.host === 'free' && entrance.angle).toBeCloseTo(Math.PI / 2);
    });

    it('turns a square booth in place', () => {
        const h = harness('exhibition');
        const square: Ring = [
            [6, 6],
            [9, 6],
            [9, 9],
            [6, 9],
        ];
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: { id: 'S', shape: { outer: square } },
        });
        h.controller.select([{ kind: 'zone', id: 'S', levelId: h.levelId }]);

        h.key('r');

        expect([...h.level().zones[0]!.shape.outer].sort()).toEqual([...square].sort());
    });

    it('does nothing without a selection', () => {
        const h = harness();

        expect(h.key('r')).toBe(false);
    });
});

describe('rotation handle', () => {
    it('frames the selection and shows a handle above it', () => {
        const h = withBooth();

        const { overlay } = h.controller.getState();

        expect(overlay).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'line', closed: true })]),
        );
        const handle = handleOf(overlay)!;
        expect(handle.position[0]).toBeCloseTo(3);
        expect(handle.position[1]).toBeGreaterThan(5);
    });

    it('drags to rotate in 15° steps about the exact centre, as one undo step', () => {
        const h = withBooth();
        const handle = handleOf(h.controller.getState().overlay)!.position;
        const center: Vec2 = [3, 3.5];
        const radius = handle[1] - center[1];
        // The handle starts straight above the centre (90°); drag it 97° further round.
        const target = Math.PI / 2 + (97 * Math.PI) / 180;
        const to: Vec2 = [
            center[0] + radius * Math.cos(target),
            center[1] + radius * Math.sin(target),
        ];

        h.drag(handle, to);

        // 97° snaps to 90°: the booth is turned a quarter about (3, 3.5), not the grid-snapped pivot.
        const shape = h.shape();
        const expected: Vec2[] = [
            [4.5, 2.5],
            [4.5, 4.5],
            [1.5, 4.5],
            [1.5, 2.5],
        ];
        shape.forEach((p, i) => {
            expect(p[0]).toBeCloseTo(expected[i]![0]);
            expect(p[1]).toBeCloseTo(expected[i]![1]);
        });
        h.key('z', { meta: true });
        expect(h.shape()).toEqual(booth);
    });
});
