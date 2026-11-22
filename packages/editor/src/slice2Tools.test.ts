import { underlayToWorld, worldToUnderlay, type Ring, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness } from './testing.ts';

const outline = (h: ReturnType<typeof harness>) => h.level().outline.outer;

describe('Obstacle tool', () => {
    it('drags out a column-kind Obstacle and selects it', () => {
        const h = harness();
        h.controller.setTool('obstacle');

        h.drag([3, 3], [4, 4]);

        const [obstacle] = h.level().obstacles;
        expect(obstacle).toMatchObject({
            kind: 'column',
            shape: {
                outer: [
                    [3, 3],
                    [4, 3],
                    [4, 4],
                    [3, 4],
                ],
            },
        });
        expect(h.controller.getState().selection).toEqual([
            { kind: 'obstacle', id: obstacle!.id, levelId: h.levelId },
        ]);
    });
});

describe('Outline tool', () => {
    it('shows a handle on every corner and every edge midpoint', () => {
        const h = harness();

        h.controller.setTool('outline');

        const markers = h.controller.getState().overlay.filter((i) => i.type === 'marker');
        expect(markers.filter((m) => m.type === 'marker' && m.kind === 'vertex')).toHaveLength(4);
        expect(markers.filter((m) => m.type === 'marker' && m.kind === 'edge')).toHaveLength(4);
    });

    it('drags a corner, snapped, as one undo step', () => {
        const h = harness();
        h.controller.setTool('outline');

        h.drag([20, 10], [24.2, 12.1]);

        expect(outline(h)).toEqual([
            [0, 0],
            [20, 0],
            [24, 12],
            [0, 10],
        ]);
        h.key('z', { meta: true });
        expect(outline(h)).toContainEqual([20, 10]);
    });

    it('adds a corner by dragging an edge midpoint', () => {
        const h = harness();
        h.controller.setTool('outline');

        h.drag([10, 10], [10, 14]);

        expect(outline(h)).toEqual([
            [0, 0],
            [20, 0],
            [20, 10],
            [10, 14],
            [0, 10],
        ]);
    });

    it('removes the active corner with Delete, keeping at least three', () => {
        const h = harness();
        h.controller.setTool('outline');
        h.drag([10, 10], [10, 14]);

        h.click([10, 14]);
        expect(h.key('Delete')).toBe(true);
        expect(outline(h)).toHaveLength(4);

        h.click([0, 10]);
        h.key('Delete');
        h.click([0, 0]);
        expect(h.key('Delete')).toBe(false);
        expect(outline(h)).toHaveLength(3);
    });

    it('keeps the last valid shape when a drag would make the Outline cross itself', () => {
        const h = harness();
        h.controller.setTool('outline');

        h.drag([20, 10], [10, -5]);

        expect(outline(h)).not.toContainEqual([10, -5]);
        expect(outline(h)).toHaveLength(4);
    });
});

describe('Connection tool', () => {
    const footprint: Ring = [
        [2, 2],
        [4, 2],
        [4, 5],
        [2, 5],
    ];

    it('needs a second Level, and says so', () => {
        const h = harness();
        h.controller.setTool('connection');

        h.drag([2, 2], [4, 5]);

        expect(h.editor.getDocument().connections).toEqual([]);
        expect(h.controller.getState().message).toMatch(/level/i);
    });

    it('creates the chosen kind with Stops on this Level and the one above', () => {
        const h = harness();
        h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
        h.controller.setTool('connection');
        h.controller.setConnectionKind('elevator');

        h.drag([2, 2], [4, 5]);

        const [connection] = h.editor.getDocument().connections;
        expect(connection).toMatchObject({
            kind: 'elevator',
            bidirectional: true,
            accessible: true,
        });
        expect(connection?.stops).toEqual([
            { levelId: h.levelId, shape: { outer: footprint } },
            { levelId: 'L2', shape: { outer: footprint } },
        ]);
        expect(h.controller.getState().selection).toEqual([
            { kind: 'stop', id: connection!.id, levelId: h.levelId },
        ]);
    });

    it('marks lifts and ramps accessible for step-free routes, not stairs or escalators', () => {
        const kinds = ['elevator', 'ramp', 'stairs', 'escalator'] as const;
        const accessible = kinds.map((kind) => {
            const h = harness();
            h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
            h.controller.setTool('connection');
            h.controller.setConnectionKind(kind);
            h.drag([2, 2], [4, 5]);
            return h.editor.getDocument().connections[0]!.accessible;
        });
        expect(accessible).toEqual([true, true, undefined, undefined]);
    });

    it('uses the Level below when drawing on the top Level', () => {
        const h = harness();
        h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
        h.controller.setLevel('L2');
        h.controller.setTool('connection');

        h.drag([2, 2], [4, 5]);

        const stops = h.editor.getDocument().connections[0]?.stops.map((s) => s.levelId);
        expect(stops).toEqual(['L2', h.levelId]);
    });
});

describe('Underlay calibration', () => {
    function withUnderlay() {
        const h = harness();
        h.editor.exec({
            type: 'underlay.add',
            levelId: h.levelId,
            underlay: {
                id: 'U',
                src: 'plan.png',
                position: [0, 10],
                scale: 0.01,
                rotation: 0,
                opacity: 0.5,
                locked: false,
            },
        });
        return h;
    }

    it('takes two clicked points, then the real distance, and rescales the Underlay', () => {
        const h = withUnderlay();
        h.controller.startCalibration('U');
        expect(h.controller.getState().tool).toBe('calibrate');

        h.click([1, 9]);
        h.click([4, 9]);
        expect(h.controller.getState().calibration).toMatchObject({
            underlayId: 'U',
            points: [
                [1, 9],
                [4, 9],
            ],
        });

        h.controller.finishCalibration(6);

        const underlay = h.level().underlays[0]!;
        // 3 m on the plan was 300 px at 0.01 m/px; it is really 6 m, so 0.02 m/px.
        expect(underlay.scale).toBeCloseTo(0.02);
        expect(h.controller.getState().tool).toBe('select');
        expect(h.controller.getState().calibration).toBeNull();
    });

    it('does not snap calibration points to the plan', () => {
        const h = withUnderlay();
        h.controller.startCalibration('U');

        h.click([1.13, 8.94]);

        expect(h.controller.getState().calibration?.points).toEqual([[1.13, 8.94]]);
    });

    describe('straighten', () => {
        /** Marks two plan points on U and calibrates; returns where those image pixels end up. */
        function calibrate(a: Vec2, b: Vec2, straighten: boolean) {
            const h = withUnderlay();
            const before = h.level().underlays[0]!;
            const pixels = [a, b].map((p) => worldToUnderlay(before, p));
            h.controller.startCalibration('U');
            h.click(a);
            h.click(b);
            h.controller.finishCalibration(5, { straighten });
            const after = h.level().underlays[0]!;
            const [first, second] = pixels.map((p) => underlayToWorld(after, p)) as [Vec2, Vec2];
            return { a: first, b: second, rotation: after.rotation };
        }

        it('turns a nearly horizontal line on a crooked scan exactly horizontal', () => {
            const { a, b } = calibrate([1, 9], [4, 9.2], true);

            expect(a[0]).toBeCloseTo(1);
            expect(a[1]).toBeCloseTo(9); // the first point stays put
            expect(b[1]).toBeCloseTo(9);
            expect(b[0] - a[0]).toBeCloseTo(5);
        });

        it('turns a nearly vertical line exactly vertical', () => {
            const { a, b } = calibrate([2, 2], [2.3, 8], true);

            expect(b[0]).toBeCloseTo(a[0]);
            expect(b[1] - a[1]).toBeCloseTo(5);
        });

        it('leaves the rotation alone without it', () => {
            expect(calibrate([1, 9], [4, 9.2], false).rotation).toBe(0);
        });
    });

    it('Escape abandons calibration', () => {
        const h = withUnderlay();
        h.controller.startCalibration('U');
        h.click([1, 9]);

        h.key('Escape');

        expect(h.controller.getState().tool).toBe('select');
        expect(h.level().underlays[0]?.scale).toBe(0.01);
    });
});

describe('Deleting a Level', () => {
    it('asks for confirmation listing what else goes, then deletes', () => {
        const h = harness();
        h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
        h.editor.exec({
            type: 'zone.add',
            levelId: 'L2',
            zone: {
                id: 'Z',
                shape: {
                    outer: [
                        [1, 1],
                        [2, 1],
                        [2, 2],
                    ],
                },
            },
        });

        h.controller.requestLevelDelete('L2');

        expect(h.controller.getState().pendingDelete?.extra).toEqual([
            { kind: 'zone', id: 'Z', levelId: 'L2' },
        ]);
        h.controller.confirmDelete();
        expect(h.editor.getDocument().levels.map((l) => l.id)).toEqual([h.levelId]);
    });

    it('deletes an empty Level without asking', () => {
        const h = harness();
        h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });

        h.controller.requestLevelDelete('L2');

        expect(h.controller.getState().pendingDelete).toBeNull();
        expect(h.editor.getDocument().levels).toHaveLength(1);
    });
});
