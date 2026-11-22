import type { Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness, wallSegments } from './testing.ts';

function withWalls(...walls: [Vec2, Vec2][]) {
    const h = harness();
    for (const [a, b] of walls) {
        h.editor.exec({ type: 'wall.add', levelId: h.levelId, a, b, thickness: 0.1 });
    }
    return h;
}

describe('Dropping a Wall Node', () => {
    it('onto another Wall Node joins the two', () => {
        const h = withWalls(
            [
                [0, 3],
                [5, 3],
            ],
            [
                [5, 5],
                [5, 8],
            ],
        );

        h.drag([5, 5], [5.05, 3.05]);

        expect(wallSegments(h.level())).toEqual(['0,3 → 5,3', '5,3 → 5,8']);
        expect(h.level().wallNodes).toHaveLength(3);
    });

    it('onto the middle of a Wall splits it there and joins it (a T-junction)', () => {
        const h = withWalls(
            [
                [0, 3],
                [10, 3],
            ],
            [
                [4, 5],
                [4, 8],
            ],
        );

        h.drag([4, 5], [4, 3.05]);

        const level = h.level();
        expect(wallSegments(level)).toEqual(['0,3 → 4,3', '4,3 → 10,3', '4,3 → 4,8']);
        expect(level.wallNodes).toHaveLength(4);
    });

    it('onto its neighbour removes the Wall between them', () => {
        const h = withWalls(
            [
                [2, 3],
                [6, 3],
            ],
            [
                [6, 3],
                [6, 6],
            ],
        );

        h.drag([6, 6], [6, 3.05]);

        expect(wallSegments(h.level())).toEqual(['2,3 → 6,3']);
    });

    it('is undone in one step together with the drag', () => {
        const h = withWalls(
            [
                [0, 3],
                [5, 3],
            ],
            [
                [5, 5],
                [5, 8],
            ],
        );
        const before = h.level();

        h.drag([5, 5], [5.05, 3.05]);
        h.editor.undo();

        expect(h.level()).toBe(before);
    });

    it('does not join anything when dropped with snapping off (Alt)', () => {
        const h = withWalls(
            [
                [0, 3],
                [5, 3],
            ],
            [
                [5, 5],
                [5, 8],
            ],
        );

        h.drag([5, 5], [5.05, 3.05], { alt: true });

        expect(h.level().wallNodes).toHaveLength(4);
    });
});
