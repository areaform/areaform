import type { OverlayItem } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { harness } from '../testing.ts';

const meta = { meta: true };

/** A Wall from (0, 5) to (10, 5): its left side is above (+Y), its right side below. */
function withWall() {
    const h = harness();
    h.editor.exec({
        type: 'wall.add',
        levelId: h.levelId,
        id: 'W',
        a: [0, 5],
        b: [10, 5],
        thickness: 0.2,
    });
    return h;
}

function withDoor() {
    const h = withWall();
    h.editor.exec({
        type: 'opening.add',
        levelId: h.levelId,
        opening: { id: 'D', kind: 'door', width: 0.9, host: 'wall', wallId: 'W', offset: 4 },
    });
    h.controller.select([{ kind: 'opening', id: 'D', levelId: h.levelId }]);
    const door = () => h.level().openings.find((o) => o.id === 'D')!;
    return { ...h, door };
}

const swingLine = (overlay: OverlayItem[]) =>
    overlay.find((i): i is Extract<OverlayItem, { type: 'line' }> => i.type === 'line');

describe('Door swing', () => {
    it('places a door swinging to the side of the Wall that was clicked', () => {
        const h = withWall();
        h.controller.setTool('door');

        h.click([3, 5.05]);
        h.click([7, 4.95]);

        expect(h.level().openings.map((o) => o.swing ?? 'left')).toEqual(['left', 'right']);
    });

    it('previews the leaf and its swing on the side the pointer is on', () => {
        const h = withWall();
        h.controller.setTool('door');

        h.move([4, 5.05]);
        const above = swingLine(h.controller.getState().overlay);
        h.move([4, 4.95]);
        const below = swingLine(h.controller.getState().overlay);

        expect(above!.points.every(([, y]) => y >= 5 - 1e-9)).toBe(true);
        expect(below!.points.every(([, y]) => y <= 5 + 1e-9)).toBe(true);
        // The leaf reaches one door width out from the hinge.
        expect(Math.max(...above!.points.map(([, y]) => y))).toBeCloseTo(5.1 + 0.9);
    });

    it('F flips the selected door to swing the other way, Shift+F moves its hinge', () => {
        const h = withDoor();

        h.key('f');
        expect(h.door()).toMatchObject({ swing: 'right' });
        h.key('F', { shift: true });
        expect(h.door()).toMatchObject({ swing: 'right', hinge: 'end' });
        h.key('f');
        expect(h.door()).toMatchObject({ swing: 'left', hinge: 'end' });
    });

    it('flips every selected door in one undo step, and lets F through with no door selected', () => {
        const h = withDoor();
        h.editor.exec({
            type: 'opening.add',
            levelId: h.levelId,
            opening: { id: 'D2', kind: 'door', width: 0.9, host: 'wall', wallId: 'W', offset: 7 },
        });
        h.controller.select([
            { kind: 'opening', id: 'D', levelId: h.levelId },
            { kind: 'opening', id: 'D2', levelId: h.levelId },
        ]);

        expect(h.key('f')).toBe(true);
        expect(h.level().openings.map((o) => o.swing)).toEqual(['right', 'right']);
        h.editor.undo();
        expect(h.level().openings.map((o) => o.swing)).toEqual([undefined, undefined]);

        h.controller.select([{ kind: 'wall', id: 'W', levelId: h.levelId }]);
        expect(h.key('f')).toBe(false);
    });

    it('copies keep the hinge and swing', () => {
        const h = withDoor();
        h.key('f');
        h.key('F', { shift: true });
        h.controller.select([{ kind: 'wall', id: 'W', levelId: h.levelId }]);

        h.key('c', meta);
        h.key('v', meta);

        const pasted = h.level().openings.find((o) => o.id !== 'D');
        expect(pasted).toMatchObject({ hinge: 'end', swing: 'right' });
    });
});
