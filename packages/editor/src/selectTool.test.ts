import type { Ring } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness, wallSegments } from './testing.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

/** Booths Z1 (2,2)–(4,4) and Z2 (6,2)–(8,4); Wall W from (0,7) to (10,7) with door D at 5 m. */
function scene() {
    const h = harness('exhibition');
    const { levelId } = h;
    const run = (command: Parameters<typeof h.editor.exec>[0]) => {
        const result = h.editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    };
    run({ type: 'zone.add', levelId, zone: { id: 'Z1', shape: { outer: square(2, 2, 2) } } });
    run({ type: 'zone.add', levelId, zone: { id: 'Z2', shape: { outer: square(6, 2, 2) } } });
    run({ type: 'wall.add', levelId, id: 'W', a: [0, 7], b: [10, 7], thickness: 0.2 });
    run({
        type: 'opening.add',
        levelId,
        opening: { id: 'D', kind: 'door', width: 0.9, host: 'wall', wallId: 'W', offset: 5 },
    });
    const ref = (kind: 'zone' | 'wall' | 'opening' | 'wallNode', id: string) => ({
        kind,
        id,
        levelId,
    });
    const zone = (id: string) => h.level().zones.find((z) => z.id === id)!;
    return { ...h, ref, zone, undoDepth: () => countUndo(h) };
}

/** How many undo steps exist, without changing the final state. */
function countUndo(h: ReturnType<typeof harness>): number {
    let n = 0;
    while (h.editor.canUndo()) {
        h.editor.undo();
        n++;
    }
    for (let i = 0; i < n; i++) h.editor.redo();
    return n;
}

describe('Select tool — selection', () => {
    it('selects on click, toggles with Shift, and clears on the background', () => {
        const s = scene();

        s.click([3, 3]);
        expect(s.controller.getState().selection).toEqual([s.ref('zone', 'Z1')]);

        s.click([7, 3], { shift: true });
        expect(s.controller.getState().selection).toEqual([
            s.ref('zone', 'Z1'),
            s.ref('zone', 'Z2'),
        ]);

        s.click([3, 3], { shift: true });
        expect(s.controller.getState().selection).toEqual([s.ref('zone', 'Z2')]);

        s.click([15, 5]);
        expect(s.controller.getState().selection).toEqual([]);
    });

    it('reports the Element under the pointer as hover', () => {
        const s = scene();

        s.move([5, 7.05]);

        expect(s.controller.getState().hover).toEqual(s.ref('opening', 'D'));
    });

    it('box-selects Elements entirely inside a box dragged from empty space', () => {
        const s = scene();

        s.controller.pointerDown({ point: [1, 1] });
        s.move([9, 5]);
        expect(s.controller.getState().overlay).toEqual([
            expect.objectContaining({ type: 'polygon' }),
        ]);
        s.controller.pointerUp({ point: [9, 5] });

        expect(s.controller.getState().selection).toEqual([
            s.ref('zone', 'Z1'),
            s.ref('zone', 'Z2'),
        ]);
        // The box is gone; the new selection is framed instead.
        const overlay = s.controller.getState().overlay;
        expect(overlay.some((i) => i.type === 'polygon')).toBe(false);
        expect(overlay).toContainEqual(expect.objectContaining({ type: 'line', closed: true }));
    });

    it('Escape clears the selection', () => {
        const s = scene();
        s.click([3, 3]);

        expect(s.key('Escape')).toBe(true);

        expect(s.controller.getState().selection).toEqual([]);
    });

    it('drops selected Elements that no longer exist, e.g. after undo', () => {
        const s = scene();
        s.controller.setTool('zone');
        s.drag([12, 2], [14, 4]);
        expect(s.controller.getState().selection).toHaveLength(1);

        s.key('z', { meta: true });

        expect(s.controller.getState().selection).toEqual([]);
    });
});

describe('Select tool — moving', () => {
    it('drags a Zone by whole grid steps, live, as one undo step', () => {
        const s = scene();
        const steps = s.undoDepth();

        s.controller.pointerDown({ point: [3, 3] });
        s.move([4.2, 3.4]);
        expect(s.zone('Z1').shape.outer[0]).toEqual([3, 2]);
        s.move([5.1, 4.1]);
        s.controller.pointerUp({ point: [5.1, 4.1] });

        expect(s.zone('Z1').shape.outer).toEqual(square(4, 3, 2));
        expect(s.undoDepth()).toBe(steps + 1);
    });

    it('moves the whole selection together', () => {
        const s = scene();
        s.click([3, 3]);
        s.click([7, 3], { shift: true });

        s.drag([7, 3], [7, 5]);

        expect(s.zone('Z1').shape.outer).toEqual(square(2, 4, 2));
        expect(s.zone('Z2').shape.outer).toEqual(square(6, 4, 2));
    });

    it('drags a Wall Node, snapping it, with its Walls following', () => {
        const s = scene();

        s.drag([10, 7], [12.1, 8.2]);

        expect(wallSegments(s.level())).toEqual(['0,7 → 12,8']);
    });

    it('drags a Wall by both its nodes; its door follows', () => {
        const s = scene();

        s.drag([3, 7], [3, 8]);

        expect(wallSegments(s.level())).toEqual(['0,8 → 10,8']);
        const door = s.level().openings[0];
        expect(door?.host === 'wall' && door.wallId).toBe('W');
    });
});

describe('Select tool — deleting', () => {
    it('deletes the selection with Delete, as one undo step', () => {
        const s = scene();
        s.click([3, 3]);
        s.click([7, 3], { shift: true });

        expect(s.key('Delete')).toBe(true);

        expect(s.level().zones).toEqual([]);
        expect(s.controller.getState().selection).toEqual([]);
        s.key('z', { meta: true });
        expect(s.level().zones).toHaveLength(2);
    });

    it('asks for confirmation when deleting would also remove other Elements', () => {
        const s = scene();
        s.click([2, 7]);
        expect(s.controller.getState().selection).toEqual([s.ref('wall', 'W')]);

        s.key('Backspace');

        expect(s.level().walls).toHaveLength(1);
        expect(s.controller.getState().pendingDelete?.extra).toEqual([s.ref('opening', 'D')]);

        s.controller.cancelDelete();
        expect(s.controller.getState().pendingDelete).toBeNull();
        expect(s.level().walls).toHaveLength(1);

        s.key('Delete');
        s.controller.confirmDelete();
        expect(s.level().walls).toEqual([]);
        expect(s.level().openings).toEqual([]);
    });

    it('deletes a door together with its selected Wall without failing', () => {
        const s = scene();
        s.controller.select([s.ref('wall', 'W'), s.ref('opening', 'D')]);

        s.key('Delete');

        expect(s.controller.getState().pendingDelete).toBeNull();
        expect(s.level().walls).toEqual([]);
    });
});
