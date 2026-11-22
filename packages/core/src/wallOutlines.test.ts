import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, wallOutlines, type Vec2 } from './index.ts';

/** Walls as [id, a, b, thickness]; returns each Wall's outline by id. */
function outlines(...walls: [string, Vec2, Vec2, number?][]) {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    for (const [id, a, b, thickness = 0.2] of walls) {
        const result = editor.exec({ type: 'wall.add', levelId, id, a, b, thickness });
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    const shapes = wallOutlines(editor.getDocument().levels[0]!);
    return (id: string) => shapes.get(id)?.outer;
}

describe('wallOutlines', () => {
    const rounded = (ring: Vec2[] | undefined) =>
        ring?.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);

    it('mitres an L-corner: both edges stop on the diagonal through the corner', () => {
        const outline = outlines(['W1', [0, 5], [10, 5]], ['W2', [10, 5], [10, 15]]);

        expect(rounded(outline('W1'))).toEqual([
            [0, 4.9],
            [10.1, 4.9], // outer corner
            [9.9, 5.1], // inner corner
            [0, 5.1],
        ]);
        expect(rounded(outline('W2'))).toEqual([
            [10.1, 4.9],
            [10.1, 15],
            [9.9, 15],
            [9.9, 5.1],
        ]);
    });

    it('fills a T-junction: the straight Walls meet flush, the stem comes to a point at the node', () => {
        const outline = outlines(
            ['LEFT', [0, 5], [10, 5]],
            ['RIGHT', [10, 5], [20, 5]],
            ['STEM', [10, 5], [10, 15]],
        );

        expect(rounded(outline('LEFT'))).toEqual([
            [0, 4.9],
            [10, 4.9], // flush with RIGHT along the far side
            [10, 5],
            [9.9, 5.1], // against the stem
            [0, 5.1],
        ]);
        expect(rounded(outline('STEM'))).toEqual([
            [10.1, 5.1],
            [10.1, 15],
            [9.9, 15],
            [9.9, 5.1],
            [10, 5],
        ]);
    });

    it('mitres Walls of different thickness on their own edges', () => {
        const outline = outlines(['THIN', [0, 5], [10, 5], 0.1], ['THICK', [10, 5], [10, 15], 0.4]);

        expect(rounded(outline('THIN'))).toEqual([
            [0, 4.95],
            [10.2, 4.95],
            [9.8, 5.05],
            [0, 5.05],
        ]);
    });

    it('keeps a very sharp corner from turning into a spike', () => {
        // About 3° apart: a true mitre would reach several metres past the corner.
        const outline = outlines(['A', [0, 5], [10, 5]], ['B', [10, 5], [0, 5.5]]);

        const nearCorner = outline('A')!.filter(([x]) => x > 5);
        expect(nearCorner.length).toBeGreaterThan(0);
        for (const [x, y] of nearCorner) expect(Math.hypot(x - 10, y - 5)).toBeLessThan(1);
    });
});
