import type { Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness } from '../testing.ts';

/** An L of two Walls, (4, 4) → (10, 4) → (10, 8), joined at the corner (10, 4). */
function withCorner() {
    const h = harness();
    const levelId = h.levelId;
    h.editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [4, 4], b: [10, 4], thickness: 0.2 });
    const corner = h.level().walls[0]!.b;
    h.editor.exec({
        type: 'wall.add',
        levelId,
        id: 'W2',
        a: { nodeId: corner },
        b: [10, 8],
        thickness: 0.2,
    });
    const position = (id: string) => h.level().wallNodes.find((n) => n.id === id)!.position;
    const ends = (wallId: string): [Vec2, Vec2] => {
        const wall = h.level().walls.find((w) => w.id === wallId)!;
        return [position(wall.a), position(wall.b)];
    };
    /** Where the end handles are drawn, and whether each is highlighted. */
    const handles = () =>
        h.controller
            .getState()
            .overlay.flatMap((item) =>
                item.type === 'marker' && item.kind === 'vertex'
                    ? [{ at: item.position, picked: item.style?.fill === '#ff6a00' }]
                    : [],
            );
    return { ...h, corner, ends, handles };
}

describe('Wall end handles', () => {
    it('a selected Wall shows a handle on each end, and a move cursor over them', () => {
        const h = withCorner();
        h.click([7, 4]);

        expect(h.handles()).toEqual([
            { at: [4, 4], picked: false },
            { at: [10, 4], picked: false },
        ]);
        h.move([4, 4]);
        expect(h.controller.getState().cursor).toBe('move');
        h.move([7, 4]);
        expect(h.controller.getState().cursor).toBeNull();
    });

    it('dragging an end picks it, highlighted, and moves every Wall joined there as one undo step', () => {
        const h = withCorner();
        h.click([7, 4]);

        h.drag([10, 4], [12, 3]);

        expect(h.ends('W1')).toEqual([
            [4, 4],
            [12, 3],
        ]);
        expect(h.ends('W2')).toEqual([
            [12, 3],
            [10, 8],
        ]);
        expect(h.controller.getState().selection).toEqual([
            { kind: 'wallNode', id: h.corner, levelId: h.levelId },
        ]);
        expect(h.handles()).toEqual([{ at: [12, 3], picked: true }]);
        h.key('z', { meta: true });
        expect(h.ends('W1')[1]).toEqual([10, 4]);
    });

    it('shows no end handles with several Walls selected', () => {
        const h = withCorner();
        h.click([7, 4]);
        h.click([10, 6], { shift: true });
        expect(h.controller.getState().selection).toHaveLength(2);
        expect(h.handles()).toEqual([]);
    });
});
