import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, resolveOpening, type Level } from '../index.ts';

function officeEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const level = () => editor.getDocument().levels[0]!;
    const nodeAt = (x: number, y: number) =>
        level().wallNodes.find((n) => n.position[0] === x && n.position[1] === y)!.id;
    return { editor, levelId, level, nodeAt };
}

/** Walls as "x,y → x,y" by their Wall Nodes' positions. */
function segments(level: Level): string[] {
    const pos = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    return level.walls.map((w) => `${pos.get(w.a)!.join(',')} → ${pos.get(w.b)!.join(',')}`);
}

describe('wallNode.merge', () => {
    it('joins two Walls at one Wall Node, keeping the node merged into', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [5, 0], thickness: 0.1 });
        editor.exec({ type: 'wall.add', levelId, a: [5, 1], b: [5, 6], thickness: 0.1 });
        const into = nodeAt(5, 0);

        const result = editor.exec({
            type: 'wallNode.merge',
            levelId,
            nodeId: nodeAt(5, 1),
            into,
        });

        expect(result.ok).toBe(true);
        expect(segments(level())).toEqual(['0,0 → 5,0', '5,0 → 5,6']);
        expect(level().wallNodes.map((n) => n.id)).toContain(into);
        expect(level().wallNodes).toHaveLength(3);
    });

    it('removes the Wall between two joined nodes, with its doors', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [5, 0], thickness: 0.1 });
        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'short',
            a: [5, 0],
            b: [6, 0],
            thickness: 0.1,
        });
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { kind: 'door', width: 0.8, host: 'wall', wallId: 'short', offset: 0.5 },
        });

        editor.exec({ type: 'wallNode.merge', levelId, nodeId: nodeAt(6, 0), into: nodeAt(5, 0) });

        expect(segments(level())).toEqual(['0,0 → 5,0']);
        expect(level().openings).toEqual([]);
    });

    it('folds a Wall that now doubles another into it, moving its doors across', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        // Two Walls from (0,0): one to (5,0), one to (5,0.5) running back the other way.
        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'kept',
            a: [0, 0],
            b: [5, 0],
            thickness: 0.1,
        });
        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'twin',
            a: [5, 0.5],
            b: [0, 0],
            thickness: 0.1,
        });
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { id: 'D', kind: 'door', width: 0.8, host: 'wall', wallId: 'twin', offset: 1 },
        });

        editor.exec({
            type: 'wallNode.merge',
            levelId,
            nodeId: nodeAt(5, 0.5),
            into: nodeAt(5, 0),
        });

        expect(level().walls.map((w) => w.id)).toEqual(['kept']);
        const door = level().openings[0]!;
        expect(door).toMatchObject({ wallId: 'kept' });
        // It was 1 m from the far end of the twin, so it stays 1 m from (5, 0).
        expect(resolveOpening(level(), door)!.position).toEqual([4, 0]);
    });

    it('is one undo step', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [5, 0], thickness: 0.1 });
        editor.exec({ type: 'wall.add', levelId, a: [5, 1], b: [5, 6], thickness: 0.1 });
        const before = level();

        editor.exec({ type: 'wallNode.merge', levelId, nodeId: nodeAt(5, 1), into: nodeAt(5, 0) });
        editor.undo();

        expect(level()).toBe(before);
    });

    it('rejects unknown Wall Nodes', () => {
        const { editor, levelId, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [5, 0], thickness: 0.1 });

        const result = editor.exec({
            type: 'wallNode.merge',
            levelId,
            nodeId: nodeAt(0, 0),
            into: 'nowhere',
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'unknown-element', id: 'nowhere' }] });
    });
});

describe('wall.split', () => {
    it('puts a Wall Node partway along a Wall, keeping doors on the piece that holds them', () => {
        const { editor, levelId, level } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W', a: [0, 0], b: [10, 0], thickness: 0.1 });
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { id: 'D', kind: 'door', width: 0.8, host: 'wall', wallId: 'W', offset: 7 },
        });

        const result = editor.exec({
            type: 'wall.split',
            levelId,
            wallId: 'W',
            offset: 4,
            nodeId: 'N',
        });

        expect(result.ok).toBe(true);
        expect(segments(level())).toEqual(['0,0 → 4,0', '4,0 → 10,0']);
        expect(level().wallNodes.find((n) => n.id === 'N')!.position).toEqual([4, 0]);
        expect(level().walls[0]!.id).toBe('W');
        const door = level().openings[0]!;
        expect(door).toMatchObject({ wallId: level().walls[1]!.id });
        expect(resolveOpening(level(), door)!.position).toEqual([7, 0]);
    });

    it('rejects a split at or beyond either end', () => {
        const { editor, levelId } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W', a: [0, 0], b: [10, 0], thickness: 0.1 });

        for (const offset of [0, 10, 12, -1]) {
            expect(editor.exec({ type: 'wall.split', levelId, wallId: 'W', offset }).ok).toBe(
                false,
            );
        }
    });
});
