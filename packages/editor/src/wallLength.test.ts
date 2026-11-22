import type { OverlayItem } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { wallLengthCommand } from './elements.ts';
import { harness, wallSegments } from './testing.ts';

const labels = (overlay: OverlayItem[]) =>
    overlay
        .filter((i): i is Extract<OverlayItem, { type: 'label' }> => i.type === 'label')
        .map((i) => i.text);

/** Wall tool active, chain started at (2, 2), pointer at `toward`. */
function drawingFrom(toward: [number, number]) {
    const h = harness();
    h.controller.setTool('wall');
    h.click([2, 2]);
    h.move(toward);
    const type = (text: string) => [...text].forEach((key) => h.key(key));
    return { ...h, type };
}

describe('Wall tool — typed lengths', () => {
    it('places the next corner the typed distance towards the pointer on Enter', () => {
        const h = drawingFrom([8, 2]);

        h.type('4.5');
        h.key('Enter');

        expect(wallSegments(h.level())).toEqual(['2,2 → 6.5,2']);
    });

    it('keeps the chain going from the typed corner', () => {
        const h = drawingFrom([8, 2]);
        h.type('4.5');
        h.key('Enter');

        h.move([6.5, 8]);
        h.type('3');
        h.key('Enter');
        h.key('Escape');

        expect(wallSegments(h.level())).toEqual(['2,2 → 6.5,2', '6.5,2 → 6.5,5']);
        h.key('z', { meta: true });
        expect(h.level().walls).toEqual([]); // still one undo step
    });

    it('follows a diagonal pointer direction', () => {
        const h = drawingFrom([6, 6]);

        h.type('2');
        h.key('Enter');

        const end = h.level().wallNodes.find((n) => n.position[0] !== 2)!.position;
        expect(end[0]).toBeCloseTo(2 + Math.SQRT2);
        expect(end[1]).toBeCloseTo(2 + Math.SQRT2);
    });

    it('shows the typed value and previews the Wall at that length', () => {
        const h = drawingFrom([8, 2]);

        h.type('3,5'); // a decimal comma works too

        const overlay = h.controller.getState().overlay;
        expect(labels(overlay)).toEqual(['3.5 m']);
        const line = overlay.find((i) => i.type === 'line');
        expect(line).toMatchObject({
            points: [
                [2, 2],
                [5.5, 2],
            ],
        });
    });

    it('Backspace edits the value; Esc clears it first, then ends the chain', () => {
        const h = drawingFrom([8, 2]);
        h.type('45');
        h.key('Backspace');
        expect(labels(h.controller.getState().overlay)).toEqual(['4 m']);

        h.key('Escape');
        expect(labels(h.controller.getState().overlay)).toEqual(['6.00 m']); // measured again
        h.type('1');
        h.key('Enter');

        expect(wallSegments(h.level())).toEqual(['2,2 → 3,2']);
    });

    it('ignores digits before the first click, so shortcuts and other keys still work', () => {
        const h = harness();
        h.controller.setTool('wall');

        expect(h.key('4')).toBe(false);
        expect(h.key('z')).toBe(true);
        expect(h.controller.getState().tool).toBe('zone');
    });
});

describe('wallLengthCommand', () => {
    function withWalls(walls: [string, [number, number], [number, number]][]) {
        const h = harness();
        for (const [id, a, b] of walls)
            h.editor.exec({ type: 'wall.add', levelId: h.levelId, id, a, b, thickness: 0.2 });
        const setLength = (id: string, length: number) => {
            const command = wallLengthCommand(h.level(), id, length);
            if (command) h.editor.exec(command);
            return command;
        };
        return { ...h, setLength };
    }

    it('moves the far end of a free-standing Wall along it', () => {
        const h = withWalls([['W', [0, 5], [10, 5]]]);

        h.setLength('W', 6);

        expect(wallSegments(h.level())).toEqual(['0,5 → 6,5']);
    });

    it('moves the free end when only the other end is joined, leaving the joined Wall alone', () => {
        const h = withWalls([
            ['W', [0, 5], [10, 5]],
            ['SIDE', [10, 5], [10, 9]],
        ]);

        h.setLength('W', 4);

        expect(wallSegments(h.level())).toEqual(['6,5 → 10,5', '10,5 → 10,9']);
    });

    it('moves the far end when both ends are joined; the Walls there follow', () => {
        const h = withWalls([
            ['LEFT', [0, 9], [0, 5]],
            ['W', [0, 5], [10, 5]],
            ['RIGHT', [10, 5], [10, 9]],
        ]);

        h.setLength('W', 8);

        expect(wallSegments(h.level())).toEqual(['0,9 → 0,5', '0,5 → 8,5', '8,5 → 10,9']);
    });

    it('gives nothing for a length that is not positive', () => {
        const h = withWalls([['W', [0, 5], [10, 5]]]);

        expect(h.setLength('W', 0)).toBeUndefined();
        expect(h.setLength('W', -2)).toBeUndefined();
    });
});
