import { describe, expect, it } from 'vitest';
import { harness } from './testing.ts';

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
    h.controller.setTool('door');
    return h;
}

describe('Door tool', () => {
    it('places a hosted door where the Wall is clicked, and selects it', () => {
        const h = withWall();

        h.click([4.3, 5.05]);

        const [door] = h.level().openings;
        expect(door).toMatchObject({ kind: 'door', host: 'wall', wallId: 'W', width: 0.9 });
        expect(door?.host === 'wall' && door.offset).toBeCloseTo(4.3);
        expect(h.controller.getState().selection).toEqual([
            { kind: 'opening', id: door!.id, levelId: h.levelId },
        ]);
    });

    it('keeps the door clear of the Wall ends', () => {
        const h = withWall();

        h.click([0.3, 5.05]);

        const door = h.level().openings[0];
        expect(door?.host === 'wall' && door.offset).toBeCloseTo(0.45);
    });

    it('previews the door while hovering a Wall, and nothing elsewhere', () => {
        const h = withWall();

        h.move([4, 5.1]);
        expect(h.controller.getState().overlay).toEqual([
            expect.objectContaining({ type: 'polygon' }),
            expect.objectContaining({ type: 'line' }),
        ]);

        h.move([4, 8]);
        expect(h.controller.getState().overlay).toEqual([]);
    });

    it('does nothing when clicking away from Walls', () => {
        const h = withWall();

        h.click([4, 8]);

        expect(h.level().openings).toEqual([]);
        expect(h.editor.canUndo()).toBe(true); // only the wall.add from setup
    });
});
