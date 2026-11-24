import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, type Ring } from '../index.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

/** A 20 × 10 m Level. */
function space() {
    const doc = createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const level = () => editor.getDocument().levels[0]!;
    /** Walls as sorted "x,y–x,y" strings, independent of ids and direction. */
    const segments = () => {
        const pos = new Map(level().wallNodes.map((n) => [n.id, n.position]));
        return level()
            .walls.map((w) =>
                [pos.get(w.a)!, pos.get(w.b)!]
                    .sort((p, q) => p[0] - q[0] || p[1] - q[1])
                    .map((p) => p.join(','))
                    .join('–'),
            )
            .sort();
    };
    return { editor, levelId, level, segments };
}

describe('walls.fromOutline', () => {
    it('adds a connected Wall along every Outline edge', () => {
        const { editor, levelId, level, segments } = space();

        const result = editor.exec({ type: 'walls.fromOutline', levelId, thickness: 0.3 });

        expect(result.ok).toBe(true);
        expect(segments()).toEqual(['0,0–0,10', '0,0–20,0', '0,10–20,10', '20,0–20,10']);
        expect(level().wallNodes).toHaveLength(4);
        expect(level().walls.every((w) => w.thickness === 0.3)).toBe(true);
    });

    it('is one undo step', () => {
        const { editor, levelId, level } = space();
        editor.exec({ type: 'walls.fromOutline', levelId, thickness: 0.3 });

        editor.undo();

        expect(level().walls).toEqual([]);
        expect(editor.canUndo()).toBe(false);
    });

    it('adds nothing, and no undo step, when run again', () => {
        const { editor, levelId, level } = space();
        editor.exec({ type: 'walls.fromOutline', levelId, thickness: 0.3 });
        const before = editor.getDocument();

        editor.exec({ type: 'walls.fromOutline', levelId, thickness: 0.3 });

        expect(editor.getDocument()).toBe(before);
        expect(level().walls).toHaveLength(4);
        editor.undo();
        expect(level().walls).toEqual([]);
    });

    it('joins existing Walls that meet the Outline, splitting at the junction', () => {
        const { editor, levelId, level, segments } = space();
        editor.exec({ type: 'wall.add', levelId, a: [8, 0], b: [8, 6], thickness: 0.1 });

        editor.exec({ type: 'walls.fromOutline', levelId, thickness: 0.3 });

        expect(segments()).toEqual([
            '0,0–0,10',
            '0,0–8,0',
            '0,10–20,10',
            '20,0–20,10',
            '8,0–20,0',
            '8,0–8,6',
        ]);
        // Four corners, the junction at (8, 0) and the inner wall's far end at (8, 6).
        expect(level().wallNodes).toHaveLength(6);
    });

    it('skips edges that existing Walls already cover', () => {
        const { editor, levelId, level } = space();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [12, 0], thickness: 0.3 });
        editor.exec({ type: 'wall.add', levelId, a: [12, 0], b: [20, 0], thickness: 0.3 });

        editor.exec({ type: 'walls.fromOutline', levelId, thickness: 0.3 });

        expect(level().walls).toHaveLength(5);
    });

    it('includes hole edges unless told not to', () => {
        const withHoles = space();
        const withoutHoles = space();
        for (const s of [withHoles, withoutHoles]) {
            s.editor.exec({
                type: 'level.setOutline',
                levelId: s.levelId,
                outline: { outer: square(0, 0, 20), holes: [square(8, 8, 4)] },
            });
        }

        withHoles.editor.exec({
            type: 'walls.fromOutline',
            levelId: withHoles.levelId,
            thickness: 0.2,
        });
        withoutHoles.editor.exec({
            type: 'walls.fromOutline',
            levelId: withoutHoles.levelId,
            thickness: 0.2,
            holes: false,
        });

        expect(withHoles.level().walls).toHaveLength(8);
        expect(withoutHoles.level().walls).toHaveLength(4);
    });

    it('rejects an unknown Level', () => {
        const { editor } = space();

        expect(
            editor.exec({ type: 'walls.fromOutline', levelId: 'ghost', thickness: 0.3 }),
        ).toEqual({
            ok: false,
            errors: [{ code: 'unknown-level', levelId: 'ghost' }],
        });
    });
});
