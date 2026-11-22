import type { OverlayItem } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { harness } from './testing.ts';

const labels = (overlay: OverlayItem[]) =>
    overlay
        .filter((i): i is Extract<OverlayItem, { type: 'label' }> => i.type === 'label')
        .map((i) => i.text);

describe('Imperial display units', () => {
    it('labels a selected Wall in feet and inches, and back in metres when switched back', () => {
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

        h.controller.setUnits('imperial');

        expect(h.controller.getState().units).toBe('imperial');
        expect(labels(h.controller.getState().overlay)).toEqual([`32' 10"`]);
        h.controller.setUnits('metric');
        expect(labels(h.controller.getState().overlay)).toEqual(['10.00 m']);
    });

    it('shows always-on Zone dimensions in feet and square feet', () => {
        const h = harness();
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: {
                id: 'Z',
                shape: {
                    outer: [
                        [2, 2],
                        [6, 2],
                        [6, 4],
                        [2, 4],
                    ],
                },
            },
        });
        h.controller.setUnits('imperial');

        h.controller.setDimensions(true);

        expect(labels(h.controller.getState().overlay)).toEqual([`13' 1" × 6' 7" · 86 ft²`]);
    });

    it('measures with the Ruler in feet and inches', () => {
        const h = harness();
        h.controller.setUnits('imperial');
        h.controller.setTool('ruler');

        h.drag([1, 1], [4, 1]);

        expect(labels(h.controller.getState().overlay)).toEqual([`9' 10"`]);
    });

    it('reads a typed Wall length in feet', () => {
        const h = harness();
        h.controller.setUnits('imperial');
        h.controller.setTool('wall');
        h.click([2, 2]);
        h.move([10, 2]);

        for (const key of '10') h.key(key);
        expect(labels(h.controller.getState().overlay)).toEqual(['10 ft']);
        h.key('Enter');

        const wall = h.level().walls[0]!;
        const [a, b] = [wall.a, wall.b].map(
            (id) => h.level().wallNodes.find((n) => n.id === id)!.position,
        );
        expect(b![0] - a![0]).toBeCloseTo(3.048);
    });

    it('accepts feet and inches typed while drawing', () => {
        const h = harness();
        h.controller.setUnits('imperial');
        h.controller.setTool('wall');
        h.click([2, 2]);
        h.move([10, 2]);

        for (const key of `10'6"`) h.key(key);
        h.key('Enter');

        const wall = h.level().walls[0]!;
        const [a, b] = [wall.a, wall.b].map(
            (id) => h.level().wallNodes.find((n) => n.id === id)!.position,
        );
        expect(b![0] - a![0]).toBeCloseTo(3.2004);
    });

    it('defaults to metric', () => {
        const h = harness();
        expect(h.controller.getState().units).toBe('metric');
    });
});
