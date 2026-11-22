import type { Ring, Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    dragRectangleCorner,
    dragRectangleSide,
    rectangleSides,
    removeCorner,
    resizeRectangle,
    shapeArea,
} from './shapeEdit.ts';
import { harness } from './testing.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];
/** Corners as sorted strings, so ring order and start do not matter. */
const corners = (ring: Ring | undefined) =>
    ring?.map((p) => p.map((v) => +v.toFixed(6)).join(',')).sort();

/** A 4 × 3 m Zone from (2, 2) to (6, 5), selected in the Select tool. */
function withZone(extra: { labelAnchor?: Vec2 } = {}) {
    const h = harness();
    h.editor.exec({
        type: 'zone.add',
        levelId: h.levelId,
        zone: { id: 'Z', shape: { outer: rect(2, 2, 6, 5) }, ...extra },
    });
    const ref = { kind: 'zone' as const, id: 'Z', levelId: h.levelId };
    h.controller.select([ref]);
    const zone = () => h.level().zones.find((z) => z.id === 'Z')!;
    return { ...h, ref, zone };
}

describe('reshaping a selected Zone', () => {
    it('keeps a rectangle square when a corner is dragged, the opposite corner staying', () => {
        const h = withZone();

        h.drag([6, 5], [8, 7]);

        expect(corners(h.zone().shape.outer)).toEqual(corners(rect(2, 2, 8, 7)));
    });

    it('moves just the corner with Shift', () => {
        const h = withZone();

        h.drag([6, 5], [8, 7], { shift: true });

        expect(corners(h.zone().shape.outer)).toEqual(
            corners([
                [2, 2],
                [6, 2],
                [8, 7],
                [2, 5],
            ]),
        );
    });

    it('moves a whole side by its middle handle, and adds a corner there with Shift', () => {
        const h = withZone();

        h.drag([6, 3.5], [9, 3.5]);
        expect(corners(h.zone().shape.outer)).toEqual(corners(rect(2, 2, 9, 5)));

        h.drag([9, 3.5], [11, 4], { shift: true });
        expect(h.zone().shape.outer).toHaveLength(5);
        expect(corners(h.zone().shape.outer)).toContain('11,4');
    });

    it('makes each drag one undo step', () => {
        const h = withZone();

        h.drag([6, 5], [8, 7]);
        h.editor.undo();

        expect(corners(h.zone().shape.outer)).toEqual(corners(rect(2, 2, 6, 5)));
    });

    it('stops at the last valid shape when a corner is dragged past the opposite one', () => {
        const h = withZone();

        // The drag passes (4, 3), then would collapse the Zone at (2, 2) and turn it inside out.
        h.drag([6, 5], [1, 1]);

        expect(corners(h.zone().shape.outer)).toEqual(corners(rect(2, 2, 4, 3)));
    });

    it('deletes a clicked corner, but keeps three; Esc clears the corner before the selection', () => {
        const h = withZone();

        h.click([6, 5]);
        expect(h.key('Delete')).toBe(true);
        expect(h.zone().shape.outer).toHaveLength(3);
        expect(h.level().zones).toHaveLength(1);

        h.click([6, 2]);
        h.key('Delete');
        expect(h.zone().shape.outer).toHaveLength(3);
        expect(h.controller.getState().message).toBe('A shape needs at least three corners.');

        h.click([2, 2]);
        h.key('Escape');
        expect(h.controller.getState().selection).toEqual([h.ref]);
        h.key('Escape');
        expect(h.controller.getState().selection).toEqual([]);
    });

    it('clears a label position the new shape leaves outside, and keeps one still inside', () => {
        const inside = withZone({ labelAnchor: [3, 3] });
        inside.drag([6, 5], [4, 4]);
        expect(inside.zone().labelAnchor).toEqual([3, 3]);

        const outside = withZone({ labelAnchor: [5, 4] });
        outside.drag([6, 5], [4, 4]);
        expect(outside.zone()).not.toHaveProperty('labelAnchor');
    });

    it('moves, not reshapes, when more than one element is selected', () => {
        const h = withZone();
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: { id: 'Y', shape: { outer: rect(10, 2, 12, 4) } },
        });
        h.controller.select([h.ref, { kind: 'zone', id: 'Y', levelId: h.levelId }]);

        h.drag([6, 5], [7, 5]);

        expect(corners(h.zone().shape.outer)).toEqual(corners(rect(3, 2, 7, 5)));
    });
});

describe('reshaping a Stop', () => {
    it('drags its corner, clearing an entry point left outside', () => {
        const h = harness();
        h.editor.exec({ type: 'level.add', name: 'Level 2', at: 'top' });
        const upper = h.editor.getDocument().levels.find((l) => l.id !== h.levelId)!.id;
        h.editor.exec({
            type: 'connection.add',
            connection: {
                id: 'C',
                kind: 'stairs',
                bidirectional: true,
                stops: [
                    { levelId: h.levelId, shape: { outer: rect(2, 2, 6, 5) }, entry: [5.5, 4.5] },
                    { levelId: upper, shape: { outer: rect(2, 2, 6, 5) } },
                ],
            },
        });
        h.controller.select([{ kind: 'stop', id: 'C', levelId: h.levelId }]);

        h.drag([6, 5], [4, 4]);

        const [here, above] = h.editor.getDocument().connections[0]!.stops;
        expect(corners(here!.shape.outer)).toEqual(corners(rect(2, 2, 4, 4)));
        expect(here).not.toHaveProperty('entry');
        expect(corners(above!.shape.outer)).toEqual(corners(rect(2, 2, 6, 5)));
    });
});

describe('shape geometry', () => {
    it('drags a corner of a turned rectangle along its own sides', () => {
        const diamond: Ring = [
            [0, 0],
            [2, 2],
            [0, 4],
            [-2, 2],
        ];

        const next = dragRectangleCorner(diamond, 2, [1, 5]);

        expect(rectangleSides(next!)).toBeDefined();
        expect(next![0]).toEqual([0, 0]);
        expect(corners([next![2]!])).toEqual(['1,5']);
    });

    it('refuses a side moved past the far side', () => {
        expect(dragRectangleSide(rect(0, 0, 4, 3), 1, [-1, 1])).toBeUndefined();
    });

    it('resizes a rectangle from its top-left corner on screen, at any angle', () => {
        expect(corners(resizeRectangle(rect(2, 2, 6, 5), 10, 1))).toEqual(
            corners(rect(2, 4, 12, 5)),
        );

        const turned = dragRectangleCorner(
            [
                [0, 0],
                [3, 3],
                [1, 5],
                [-2, 2],
            ],
            2,
            [1, 5],
        )!;
        const resized = resizeRectangle(turned, 2, 2);
        expect(rectangleSides(resized)?.map((s) => +s.toFixed(6))).toEqual([2, 2]);
    });

    it('removes a hole left with three corners whole', () => {
        const shape = {
            outer: rect(0, 0, 10, 10),
            holes: [
                [
                    [2, 2],
                    [4, 2],
                    [3, 4],
                ] as Ring,
            ],
        };

        expect(removeCorner(shape, { ring: 1, index: 0 })).toEqual({ outer: rect(0, 0, 10, 10) });
        expect(shapeArea(shape)).toBe(98);
    });
});
