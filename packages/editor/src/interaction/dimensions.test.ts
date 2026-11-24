import type { OverlayItem } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { rotateCommand } from './elements.ts';
import { harness } from '../testing.ts';

const labels = (overlay: OverlayItem[]) =>
    overlay
        .filter((i): i is Extract<OverlayItem, { type: 'label' }> => i.type === 'label')
        .map((i) => i.text);

describe('dimensions', () => {
    it('labels the Wall being drawn with its length', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);

        h.move([5, 4]);

        expect(labels(h.controller.getState().overlay)).toEqual(['5.00 m']);
    });

    it('labels a selected free-standing Wall with its length', () => {
        const h = harness();
        h.editor.exec({
            type: 'wall.add',
            levelId: h.levelId,
            id: 'W',
            a: [0, 5],
            b: [10, 5],
            thickness: 0.2,
        });

        h.controller.select([{ kind: 'wall', id: 'W', levelId: h.levelId }]);

        expect(labels(h.controller.getState().overlay)).toEqual(['10.00 m']);
    });

    it('adds the clear length when other Walls meet its ends', () => {
        const h = harness();
        const { levelId } = h;
        h.editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W',
            a: [0, 5],
            b: [10, 5],
            thickness: 0.2,
        });
        h.editor.exec({ type: 'wall.add', levelId, a: [0, 5], b: [0, 9], thickness: 0.2 });
        h.editor.exec({ type: 'wall.add', levelId, a: [10, 5], b: [10, 9], thickness: 0.3 });

        h.controller.select([{ kind: 'wall', id: 'W', levelId }]);

        // 10 m between centre-lines, less half of each end wall: 10 − 0.1 − 0.15.
        expect(labels(h.controller.getState().overlay)).toEqual(['10.00 m · clear 9.75 m']);
    });

    it('labels a selected rectangular Zone with its size and area', () => {
        const h = harness();
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: {
                id: 'Z',
                shape: {
                    outer: [
                        [2, 2],
                        [5, 2],
                        [5, 4],
                        [2, 4],
                    ],
                },
            },
        });

        h.controller.select([{ kind: 'zone', id: 'Z', levelId: h.levelId }]);

        expect(labels(h.controller.getState().overlay)).toEqual(['3.00 × 2.00 m · 6.00 m²']);
    });

    describe('rotated rectangles', () => {
        /** A 4 × 2 m rectangle centred on (10, 5), turned `degrees` counter-clockwise. */
        function turnedZone(degrees: number) {
            const h = harness();
            const angle = (degrees * Math.PI) / 180;
            const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
            const corners: [number, number][] = [
                [-2, -1],
                [2, -1],
                [2, 1],
                [-2, 1],
            ];
            h.editor.exec({
                type: 'zone.add',
                levelId: h.levelId,
                zone: {
                    id: 'R',
                    shape: {
                        outer: corners.map(([x, y]) => [
                            10 + x * cos - y * sin,
                            5 + x * sin + y * cos,
                        ]),
                    },
                },
            });
            h.controller.select([{ kind: 'zone', id: 'R', levelId: h.levelId }]);
            return labels(h.controller.getState().overlay);
        }

        it('gives the side lengths of a turned rectangle, not just its area', () => {
            expect(turnedZone(30)).toEqual(['4.00 × 2.00 m · 8.00 m²']);
        });

        it('lists the side nearer horizontal first, as for an upright one', () => {
            expect(turnedZone(60)).toEqual(['2.00 × 4.00 m · 8.00 m²']);
        });

        it('still finds the rectangle after the editor turns a booth by 15°', () => {
            const h = harness();
            h.controller.setTool('zone');
            h.drag([2, 2], [6, 4]);
            h.controller.setTool('select');
            const ref = { kind: 'zone' as const, id: h.level().zones[0]!.id, levelId: h.levelId };

            const turn = rotateCommand(
                h.editor.getDocument(),
                h.levelId,
                [ref],
                [4, 3],
                Math.PI / 12,
            );
            h.editor.exec(turn!);
            h.controller.select([ref]);

            expect(labels(h.controller.getState().overlay)).toEqual(['4.00 × 2.00 m · 8.00 m²']);
        });

        it('keeps area only for a parallelogram', () => {
            const h = harness();
            h.editor.exec({
                type: 'zone.add',
                levelId: h.levelId,
                zone: {
                    id: 'P',
                    shape: {
                        outer: [
                            [2, 2],
                            [6, 2],
                            [7, 4],
                            [3, 4],
                        ],
                    },
                },
            });
            h.controller.select([{ kind: 'zone', id: 'P', levelId: h.levelId }]);

            expect(labels(h.controller.getState().overlay)).toEqual(['8.00 m²']);
        });
    });

    it('labels any other shape with its area only, holes subtracted', () => {
        const h = harness();
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: {
                id: 'L',
                shape: {
                    outer: [
                        [0, 0],
                        [4, 0],
                        [4, 1],
                        [1, 1],
                        [1, 4],
                        [0, 4],
                    ],
                },
            },
        });
        h.editor.exec({
            type: 'obstacle.add',
            levelId: h.levelId,
            obstacle: {
                id: 'O',
                kind: 'void',
                shape: {
                    outer: [
                        [10, 2],
                        [14, 2],
                        [14, 6],
                        [10, 6],
                    ],
                    holes: [
                        [
                            [11, 3],
                            [11, 4],
                            [12, 4],
                            [12, 3],
                        ],
                    ],
                },
            },
        });

        h.controller.select([{ kind: 'zone', id: 'L', levelId: h.levelId }]);
        expect(labels(h.controller.getState().overlay)).toEqual(['7.00 m²']);

        h.controller.select([{ kind: 'obstacle', id: 'O', levelId: h.levelId }]);
        expect(labels(h.controller.getState().overlay)).toEqual(['4.00 × 4.00 m · 15.00 m²']);
    });

    it('shows no dimensions for a multi-selection', () => {
        const h = harness();
        const { levelId } = h;
        h.editor.exec({
            type: 'zone.add',
            levelId,
            zone: {
                id: 'A',
                shape: {
                    outer: [
                        [1, 1],
                        [2, 1],
                        [2, 2],
                        [1, 2],
                    ],
                },
            },
        });
        h.editor.exec({
            type: 'zone.add',
            levelId,
            zone: {
                id: 'B',
                shape: {
                    outer: [
                        [3, 1],
                        [4, 1],
                        [4, 2],
                        [3, 2],
                    ],
                },
            },
        });

        h.controller.select([
            { kind: 'zone', id: 'A', levelId },
            { kind: 'zone', id: 'B', levelId },
        ]);

        expect(labels(h.controller.getState().overlay)).toEqual([]);
    });
});

describe('Ruler tool', () => {
    it('measures a snapped distance by dragging, and keeps it on screen', () => {
        const h = harness();
        h.controller.setTool('ruler');

        h.drag([1.1, 0.9], [3.9, 5.1]);

        const { overlay } = h.controller.getState();
        expect(labels(overlay)).toEqual(['5.00 m']);
        expect(overlay).toContainEqual(
            expect.objectContaining({
                type: 'line',
                points: [
                    [1, 1],
                    [4, 5],
                ],
            }),
        );
    });

    it('never changes the Document', () => {
        const h = harness();
        h.controller.setTool('ruler');

        h.drag([1, 1], [4, 5]);

        expect(h.editor.canUndo()).toBe(false);
    });

    it('Escape clears the measurement; a new drag replaces it', () => {
        const h = harness();
        h.controller.setTool('ruler');
        h.drag([1, 1], [4, 5]);

        h.drag([0, 0], [6, 0]);
        expect(labels(h.controller.getState().overlay)).toEqual(['6.00 m']);

        expect(h.key('Escape')).toBe(true);
        expect(h.controller.getState().overlay).toEqual([]);
    });

    it('is the M shortcut', () => {
        const h = harness();

        h.key('m');

        expect(h.controller.getState().tool).toBe('ruler');
    });
});

describe('always-on dimensions', () => {
    /** A 10 m Wall along y = 8, a 1 m Wall at x = 1, and a 4 × 2 m Zone; nothing selected. */
    function plan() {
        const h = harness();
        const { levelId } = h;
        h.editor.exec({
            type: 'wall.add',
            levelId,
            id: 'LONG',
            a: [8, 8],
            b: [18, 8],
            thickness: 0.2,
        });
        h.editor.exec({
            type: 'wall.add',
            levelId,
            id: 'SHORT',
            a: [1, 1],
            b: [1, 2],
            thickness: 0.2,
        });
        h.editor.exec({
            type: 'zone.add',
            levelId,
            zone: {
                id: 'Z',
                shape: {
                    outer: [
                        [2, 4],
                        [6, 4],
                        [6, 6],
                        [2, 6],
                    ],
                },
            },
        });
        const shown = () => labels(h.controller.getState().overlay).sort();
        return { ...h, shown };
    }

    it('is off by default; when on, labels every Wall and Zone big enough to read', () => {
        const h = plan();
        expect(h.shown()).toEqual([]);

        h.controller.setDimensions(true);

        expect(h.controller.getState().dimensions).toBe(true);
        // The 1 m Wall is 50 px on screen at 50 px/m: too short for a label.
        expect(h.shown()).toEqual(['10.00 m', '4.00 × 2.00 m · 8.00 m²']);
        h.controller.setDimensions(false);
        expect(h.shown()).toEqual([]);
    });

    it('labels short Walls once zoomed in far enough', () => {
        const h = plan();
        h.controller.setDimensions(true);

        h.controller.setZoom(100);

        expect(h.shown()).toContain('1.00 m');
    });

    it('skips what is out of view', () => {
        const h = plan();
        h.controller.setDimensions(true);

        h.controller.setVisibleArea({ minX: 0, minY: 0, maxX: 7, maxY: 10 });

        expect(h.shown()).toEqual(['4.00 × 2.00 m · 8.00 m²']);
    });

    it('follows edits and undo, and stays on across tools', () => {
        const h = plan();
        h.controller.setDimensions(true);
        h.controller.setTool('wall');

        h.click([2, 9]);
        h.click([6, 9]);
        h.key('Escape');

        expect(h.shown()).toContain('4.00 m');
        h.key('z', { meta: true });
        expect(h.shown()).not.toContain('4.00 m');
    });

    it('skips a Zone too flat to hold its label inside', () => {
        const h = plan();
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: {
                id: 'STRIP',
                shape: {
                    outer: [
                        [8, 1],
                        [14, 1],
                        [14, 1.4],
                        [8, 1.4],
                    ],
                },
            },
        });

        h.controller.setDimensions(true);

        // 0.4 m is 20 px at 50 px/m.
        expect(h.shown()).not.toContain('6.00 × 0.40 m · 2.40 m²');
    });

    describe('kept inside the view', () => {
        const placed = (h: ReturnType<typeof plan>, text: string) => {
            const item = h.controller
                .getState()
                .overlay.find((i) => i.type === 'label' && i.text === text);
            return item && item.type === 'label' ? item.position : undefined;
        };

        it("puts a long Wall's label in the middle of the part in view", () => {
            const h = plan();
            h.editor.exec({
                type: 'wall.add',
                levelId: h.levelId,
                a: [-80, 9.5],
                b: [40, 9.5],
                thickness: 0.2,
            });
            h.controller.setDimensions(true);

            h.controller.setVisibleArea({ minX: 0, minY: 0, maxX: 20, maxY: 10 });

            // Its own middle, x = −20, is off-screen.
            const [x] = placed(h, '120.00 m')!;
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(20);
        });

        it('nudges a label inwards when its Wall runs along the edge of the view', () => {
            const h = plan();
            // At 50 px/m, a label straddling x = 0 would be cut in half.
            h.editor.exec({
                type: 'wall.add',
                levelId: h.levelId,
                a: [0, 1],
                b: [0, 9],
                thickness: 0.2,
            });
            h.controller.setDimensions(true);

            h.controller.setVisibleArea({ minX: 0, minY: 0, maxX: 20, maxY: 10 });

            const [x, y] = placed(h, '8.00 m')!;
            // Moved off the edge by at least half the label's width (6 characters, ~20 px = 0.4 m).
            expect(x).toBeGreaterThan(0.4);
            expect(y).toBeCloseTo(5);
        });

        it("keeps a large Zone's label within the part in view", () => {
            const h = plan();
            h.editor.exec({
                type: 'zone.add',
                levelId: h.levelId,
                zone: {
                    id: 'HALL',
                    shape: {
                        outer: [
                            [-30, -30],
                            [50, -30],
                            [50, 40],
                            [-30, 40],
                        ],
                    },
                },
            });
            h.controller.setDimensions(true);

            h.controller.setVisibleArea({ minX: 0, minY: 0, maxX: 20, maxY: 10 });

            const [x, y] = placed(h, '80.00 × 70.00 m · 5600.00 m²')!;
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(20);
            expect(y).toBeGreaterThan(0);
            expect(y).toBeLessThan(10);
        });
    });

    it('does not label a selected Wall twice', () => {
        const h = plan();
        h.controller.setDimensions(true);

        h.controller.select([{ kind: 'wall', id: 'LONG', levelId: h.levelId }]);

        expect(h.shown().filter((t) => t === '10.00 m')).toHaveLength(1);
    });
});
