import { containsRing, type Ring } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness } from './testing.ts';

const atrium: Ring = [
    [8, 4],
    [8, 6],
    [12, 6],
    [12, 4],
];

/** The 20 × 10 m harness Level with a 4 × 2 m atrium hole, Outline tool active. */
function withAtrium() {
    const h = harness();
    h.editor.exec({
        type: 'level.setOutline',
        levelId: h.levelId,
        outline: { outer: h.level().outline.outer, holes: [atrium] },
    });
    h.controller.setTool('outline');
    const holes = () => h.level().outline.holes ?? [];
    return { ...h, holes };
}

const markers = (h: ReturnType<typeof harness>, kind: 'vertex' | 'edge') =>
    h.controller.getState().overlay.filter((i) => i.type === 'marker' && i.kind === kind);

describe('Outline tool — holes', () => {
    it('shows corner and midpoint handles for holes as well', () => {
        const h = withAtrium();

        expect(markers(h, 'vertex')).toHaveLength(8);
        expect(markers(h, 'edge')).toHaveLength(8);
    });

    it('drags a hole corner, as one undo step', () => {
        const h = withAtrium();

        h.drag([12, 6], [13, 7]);

        expect(h.holes()[0]).toContainEqual([13, 7]);
        h.key('z', { meta: true });
        expect(h.holes()[0]).toContainEqual([12, 6]);
    });

    it('will not drag a hole corner outside the Outline', () => {
        const h = withAtrium();

        h.drag([12, 6], [12, 14]);

        expect(h.holes()[0]!.every(([, y]) => y <= 10)).toBe(true);
    });

    it('will not drag the outer ring across a hole', () => {
        const h = withAtrium();

        h.drag([20, 10], [10, 5]);

        expect(h.level().outline.outer).not.toContainEqual([10, 5]);
    });

    it('removes a hole corner with Delete, and the whole hole once it has three', () => {
        const h = withAtrium();

        h.click([12, 6]);
        h.key('Delete');
        expect(h.holes()[0]).toHaveLength(3);

        h.click([8, 4]);
        h.key('Delete');
        expect(h.holes()).toEqual([]);
        expect(h.level().outline.outer).toHaveLength(4);
    });

    it('adds a hole drawn in Add hole mode, then returns to editing', () => {
        const h = harness();
        h.controller.setTool('outline');

        h.controller.setOutlineMode('hole');
        expect(h.controller.getState().outlineMode).toBe('hole');
        h.drag([2, 2], [5, 4]);

        const holes = h.level().outline.holes ?? [];
        expect(holes).toHaveLength(1);
        expect([...holes[0]!].sort()).toEqual(
            [
                [2, 2],
                [5, 2],
                [5, 4],
                [2, 4],
            ].sort(),
        );
        expect(h.controller.getState().outlineMode).toBe('edit');
        expect(markers(h, 'vertex')).toHaveLength(8);
    });

    it('refuses a hole that is not inside the Outline', () => {
        const h = harness();
        h.controller.setTool('outline');
        h.controller.setOutlineMode('hole');

        h.drag([18, 8], [24, 12]);

        expect(h.level().outline.holes ?? []).toEqual([]);
        expect(h.controller.getState().message).toMatch(/inside the outline/i);
    });

    describe('holes that overlap', () => {
        it('refuses a new hole that overlaps another', () => {
            const h = withAtrium();
            h.controller.setOutlineMode('hole');

            h.drag([10, 5], [14, 7]);

            expect(h.holes()).toEqual([atrium]);
            expect(h.controller.getState().message).toMatch(/overlap/i);
        });

        it('accepts a new hole that only touches another along an edge', () => {
            const h = withAtrium();
            h.controller.setOutlineMode('hole');

            h.drag([12, 4], [14, 6]);

            expect(h.holes()).toHaveLength(2);
        });

        it('will not drag a hole corner into another hole', () => {
            const h = withAtrium();
            h.editor.exec({
                type: 'level.setOutline',
                levelId: h.levelId,
                outline: {
                    outer: h.level().outline.outer,
                    holes: [
                        atrium,
                        [
                            [14, 4],
                            [14, 6],
                            [16, 6],
                            [16, 4],
                        ],
                    ],
                },
            });

            h.drag([12, 6], [15, 5]);

            expect(h.holes()[0]).not.toContainEqual([15, 5]);
        });
    });

    describe('edges, not just corners', () => {
        /** An L: the 20 × 10 m Level with the top-right 8 × 5 m notched out. */
        const ell: Ring = [
            [0, 0],
            [20, 0],
            [20, 5],
            [12, 5],
            [12, 10],
            [0, 10],
        ];

        function withEll(holes: Ring[] = []) {
            const h = harness();
            h.editor.exec({
                type: 'level.setOutline',
                levelId: h.levelId,
                outline: { outer: ell, ...(holes.length > 0 && { holes }) },
            });
            h.controller.setTool('outline');
            return h;
        }

        it('refuses a new hole whose edge cuts across the notch', () => {
            const h = withEll();
            h.controller.setShapeMode('polygon');
            h.controller.setOutlineMode('hole');

            // Every corner is in the L, but the edge (10, 9) → (19, 4) passes through (14.5, 6.5).
            for (const p of [
                [10, 4],
                [19, 4],
                [10, 9],
            ] as const)
                h.click([p[0], p[1]]);
            h.key('Enter');

            expect(h.level().outline.holes ?? []).toEqual([]);
            expect(h.controller.getState().message).toMatch(/inside the outline/i);
        });

        it('will not drag a hole corner so that an edge crosses the notch', () => {
            const h = withEll([
                [
                    [4, 2],
                    [4, 4],
                    [16, 4],
                    [16, 2],
                ],
            ]);

            // (10, 9) is in the L, but the edge to (16, 4) would cross the notch; the corner stops
            // at the last position along the drag that kept the hole inside.
            h.drag([4, 4], [10, 9]);

            const hole = h.level().outline.holes![0]!;
            expect(hole).not.toContainEqual([10, 9]);
            expect(containsRing({ outer: ell }, hole)).toBe(true);
        });

        it('will not drag the outer ring into the middle of a hole edge', () => {
            const h = harness();
            const strip: Ring = [
                [2, 6],
                [2, 7],
                [18, 7],
                [18, 6],
            ];
            h.editor.exec({
                type: 'level.setOutline',
                levelId: h.levelId,
                outline: { outer: h.level().outline.outer, holes: [strip] },
            });
            h.controller.setTool('outline');

            // Pulling the top edge's midpoint down to (10, 5) keeps the strip's corners inside but
            // cuts through its long edges.
            h.drag([10, 10], [10, 5]);

            expect(h.level().outline.outer).not.toContainEqual([10, 5]);
        });
    });
});
