import { describe, expect, it } from 'vitest';
import { harness, wallSegments } from '../testing.ts';

describe('Wall tool', () => {
    it('draws a chain of Walls, one per click, snapped to the grid', () => {
        const h = harness();
        h.controller.setTool('wall');

        h.click([1.1, 1.2]);
        h.click([5.1, 0.9]);
        h.click([5.2, 4.1]);
        h.key('Escape');

        expect(wallSegments(h.level())).toEqual(['1,1 → 5,1', '5,1 → 5,4']);
    });

    it('makes the whole chain one undo step', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);
        h.click([5, 1]);
        h.click([5, 4]);
        h.key('Escape');

        h.key('z', { meta: true });

        expect(h.level().walls).toEqual([]);
        expect(h.editor.canUndo()).toBe(false);
    });

    it('previews the next Wall as a line to the snapped pointer, with a snap marker', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);

        h.move([4.2, 1.1]);

        const { overlay } = h.controller.getState();
        expect(overlay).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'line',
                    points: [
                        [1, 1],
                        [4, 1],
                    ],
                }),
                expect.objectContaining({ type: 'marker', position: [4, 1], kind: 'grid' }),
            ]),
        );
    });

    it('closes a room and finishes when clicking back on an earlier Wall Node', () => {
        const h = harness();
        h.controller.setTool('wall');

        for (const point of [
            [1, 1],
            [5, 1],
            [5, 4],
            [1, 4],
            [1.1, 1.1],
        ] as [number, number][]) {
            h.click(point);
        }
        h.click([8, 8]);

        expect(wallSegments(h.level())).toEqual([
            '1,1 → 5,1',
            '5,1 → 5,4',
            '5,4 → 1,4',
            '1,4 → 1,1',
        ]);
        expect(h.level().wallNodes).toHaveLength(4);
        expect(h.controller.getState().overlay.some((i) => i.type === 'line')).toBe(true);
    });

    it('finishes on a second click at the same point (double-click)', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);
        h.click([5, 1]);
        h.click([5, 1]);

        h.click([8, 8]);
        h.click([9, 8]);
        h.key('Escape');

        expect(wallSegments(h.level())).toEqual(['1,1 → 5,1', '8,8 → 9,8']);
    });

    it('Enter finishes the chain as well', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);
        h.click([5, 1]);

        h.key('Enter');

        expect(h.editor.canUndo()).toBe(true);
        expect(h.controller.getState().overlay).toEqual([]);
    });

    it('leaves no undo step when cancelled before the first Wall', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);

        h.key('Escape');

        expect(h.editor.canUndo()).toBe(false);
        expect(h.controller.getState().overlay).toEqual([]);
    });

    it('skips snapping while Alt is held', () => {
        const h = harness();
        h.controller.setTool('wall');

        h.click([1.3, 1.3], { alt: true });
        h.click([4.7, 1.3], { alt: true });
        h.key('Escape');

        expect(wallSegments(h.level())).toEqual(['1.3,1.3 → 4.7,1.3']);
    });
});
