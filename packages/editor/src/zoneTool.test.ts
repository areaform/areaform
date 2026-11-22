import { describe, expect, it } from 'vitest';
import { harness } from './testing.ts';

describe('Zone tool — rectangle mode', () => {
    it('drags out a grid-snapped rectangle with the Preset’s default category, and selects it', () => {
        const h = harness('exhibition');
        h.controller.setTool('zone');

        h.drag([2.1, 2.2], [5.9, 4.1]);

        const [zone] = h.level().zones;
        expect(zone?.shape.outer).toEqual([
            [2, 2],
            [6, 2],
            [6, 4],
            [2, 4],
        ]);
        expect(zone?.category).toBe('booth');
        expect(h.controller.getState().selection).toEqual([
            { kind: 'zone', id: zone!.id, levelId: h.levelId },
        ]);
    });

    it('normalises a rectangle dragged in any direction', () => {
        const h = harness();
        h.controller.setTool('zone');

        h.drag([6, 4], [2, 2]);

        expect(h.level().zones[0]?.shape.outer).toEqual([
            [2, 2],
            [6, 2],
            [6, 4],
            [2, 4],
        ]);
        expect(h.level().zones[0]).not.toHaveProperty('category');
    });

    it('previews the rectangle while dragging', () => {
        const h = harness();
        h.controller.setTool('zone');

        h.controller.pointerDown({ point: [2, 2] });
        h.move([5, 3]);

        expect(h.controller.getState().overlay).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'polygon' })]),
        );
        expect(h.level().zones).toEqual([]);
    });

    it('creates nothing for a drag with no area', () => {
        const h = harness();
        h.controller.setTool('zone');

        h.drag([2, 2], [2.1, 2.1]);

        expect(h.level().zones).toEqual([]);
        expect(h.editor.canUndo()).toBe(false);
    });
});

describe('Zone tool — polygon mode', () => {
    const lShape: [number, number][] = [
        [1, 1],
        [6, 1],
        [6, 3],
        [3, 3],
        [3, 6],
        [1, 6],
    ];

    it('adds a vertex per click and closes on a click near the first vertex', () => {
        const h = harness();
        h.controller.setTool('zone');
        h.controller.setShapeMode('polygon');

        for (const point of lShape) h.click(point);
        h.click([1.1, 0.9]);

        expect(h.level().zones[0]?.shape.outer).toEqual(lShape);
    });

    it('closes with Enter once there are three or more vertices', () => {
        const h = harness();
        h.controller.setTool('zone');
        h.controller.setShapeMode('polygon');
        h.click([1, 1]);
        h.click([4, 1]);

        expect(h.key('Enter')).toBe(false);
        h.click([4, 4]);
        expect(h.key('Enter')).toBe(true);

        expect(h.level().zones).toHaveLength(1);
    });

    it('Escape abandons the polygon', () => {
        const h = harness();
        h.controller.setTool('zone');
        h.controller.setShapeMode('polygon');
        h.click([1, 1]);
        h.click([4, 1]);
        h.click([4, 4]);

        h.key('Escape');

        expect(h.level().zones).toEqual([]);
        expect(h.controller.getState().overlay).toEqual([]);
    });
});
