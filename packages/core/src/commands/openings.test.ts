import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, resolveOpening } from '../index.ts';

function roomEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const level = () => editor.getDocument().levels[0]!;
    const opening = (id: string) => level().openings.find((o) => o.id === id)!;
    const where = (id: string) => resolveOpening(level(), opening(id));
    editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });
    return { editor, levelId, level, opening, where };
}

const door = { kind: 'door', width: 0.9 } as const;

describe('opening.add', () => {
    it('places a hosted Opening at an offset along its Wall', () => {
        const { editor, levelId, where } = roomEditor();

        const result = editor.exec({
            type: 'opening.add',
            levelId,
            opening: { ...door, id: 'D1', host: 'wall', wallId: 'W1', offset: 3 },
        });

        expect(result.ok).toBe(true);
        expect(where('D1')).toEqual({ position: [3, 0], angle: 0 });
    });

    it('keeps a hosted Opening on its Wall when a Wall Node moves', () => {
        const { editor, levelId, level, where } = roomEditor();
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { ...door, id: 'D1', host: 'wall', wallId: 'W1', offset: 3 },
        });
        const end = level().walls[0]!.b;

        editor.exec({ type: 'wallNode.move', levelId, nodeId: end, to: [0, 10] });

        const placed = where('D1')!;
        expect(placed.position[0]).toBeCloseTo(0);
        expect(placed.position[1]).toBeCloseTo(3);
        expect(placed.angle).toBeCloseTo(Math.PI / 2);
    });

    it('places a free Opening by position and angle', () => {
        const { editor, levelId, where } = roomEditor();

        editor.exec({
            type: 'opening.add',
            levelId,
            opening: {
                kind: 'entrance',
                width: 4,
                id: 'E1',
                host: 'free',
                position: [20, 5],
                angle: 1,
            },
        });

        expect(where('E1')).toEqual({ position: [20, 5], angle: 1 });
    });

    it('rejects a hosted Opening on an unknown Wall', () => {
        const { editor, levelId } = roomEditor();

        const result = editor.exec({
            type: 'opening.add',
            levelId,
            opening: { ...door, id: 'D1', host: 'wall', wallId: 'ghost', offset: 1 },
        });

        expect(result).toEqual({
            ok: false,
            errors: [{ code: 'dangling-reference', id: 'D1', ref: 'ghost' }],
        });
    });
});

describe('Openings follow wall edits', () => {
    it('moves a hosted Opening onto the right piece when its Wall is split', () => {
        const { editor, levelId, opening, where } = roomEditor();
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { ...door, id: 'NEAR', host: 'wall', wallId: 'W1', offset: 2 },
        });
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { ...door, id: 'FAR', host: 'wall', wallId: 'W1', offset: 7 },
        });

        editor.exec({ type: 'wall.add', levelId, a: [4, 0], b: [4, 6], thickness: 0.1 });

        expect(where('NEAR')).toEqual({ position: [2, 0], angle: 0 });
        expect(where('FAR')).toEqual({ position: [7, 0], angle: 0 });
        const far = opening('FAR');
        expect(far.host === 'wall' && far.wallId).not.toBe('W1');
    });

    it('deletes hosted Openings together with their Wall', () => {
        const { editor, levelId, level } = roomEditor();
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { ...door, id: 'D1', host: 'wall', wallId: 'W1', offset: 3 },
        });
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: {
                kind: 'entrance',
                width: 4,
                id: 'E1',
                host: 'free',
                position: [20, 5],
                angle: 0,
            },
        });

        editor.exec({ type: 'wall.delete', levelId, wallId: 'W1' });

        expect(level().openings.map((o) => o.id)).toEqual(['E1']);
        editor.undo();
        expect(level().openings.map((o) => o.id)).toEqual(['D1', 'E1']);
    });
});
