import { describe, expect, it } from 'vitest';
import { hereValue } from './here.ts';
import { harness } from '../testing.ts';

describe('hereValue', () => {
    it('is the Level id and the point, metres to a tenth', () => {
        expect(hereValue('L1', [12.34, 5])).toBe('L1:12.3,5');
        expect(hereValue('L1', [-0.04, 7.06])).toBe('L1:0,7.1');
    });
});

describe('picking Here', () => {
    it('gives the point clicked, snapped and rounded, and moves it on the next click', () => {
        const h = harness();
        h.controller.startHerePick();
        expect(h.controller.getState()).toMatchObject({ tool: 'here', herePick: { point: null } });

        h.click([3.02, 4.01]); // the grid snaps it to [3, 4]
        expect(h.controller.getState().herePick).toEqual({ point: [3, 4] });
        h.click([6, 2]);
        expect(h.controller.getState().herePick).toEqual({ point: [6, 2] });
        // It changes nothing in the plan.
        expect(h.controller.getState().selection).toEqual([]);
    });

    it('marks nothing outside the building, and says so', () => {
        const h = harness();
        h.controller.startHerePick();
        h.click([3, 4]);
        h.click([-5, 4]);
        expect(h.controller.getState().herePick).toEqual({ point: [3, 4] });
        expect(h.controller.getState().message).toBe(
            'Pick a point inside the building: visitors stand there.',
        );
        h.click([6, 2]);
        expect(h.controller.getState()).toMatchObject({
            herePick: { point: [6, 2] },
            message: null,
        });
    });

    it('ends with Esc, another tool, or another Level', () => {
        const h = harness();
        h.controller.startHerePick();
        h.key('Escape');
        expect(h.controller.getState()).toMatchObject({ tool: 'select', herePick: null });

        h.controller.startHerePick();
        h.controller.setTool('wall');
        expect(h.controller.getState().herePick).toBeNull();

        h.controller.startHerePick();
        h.controller.setLevel('elsewhere');
        expect(h.controller.getState()).toMatchObject({ tool: 'select', herePick: null });
    });
});
