import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, type AreaformDocument } from './index.ts';

function twoLevelEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
    const ground = doc.levels[0]!.id;
    const changes: [AreaformDocument, AreaformDocument][] = [];
    editor.on('change', (next, previous) => changes.push([next, previous]));
    return { editor, ground, changes };
}

describe('change event', () => {
    it('reports the new and previous Document after exec, undo and redo', () => {
        const { editor, ground, changes } = twoLevelEditor();
        const start = editor.getDocument();

        editor.exec({ type: 'wall.add', levelId: ground, a: [0, 0], b: [5, 0], thickness: 0.1 });
        const afterWall = editor.getDocument();
        editor.undo();
        editor.redo();

        expect(changes).toEqual([
            [afterWall, start],
            [start, afterWall],
            [afterWall, start],
        ]);
    });

    it('is not emitted for a rejected Command', () => {
        const { editor, changes } = twoLevelEditor();

        editor.exec({ type: 'wall.delete', levelId: 'nope', wallId: 'nope' });

        expect(changes).toEqual([]);
    });

    it('stops after unsubscribing', () => {
        const { editor, ground } = twoLevelEditor();
        let calls = 0;
        const off = editor.on('change', () => calls++);

        off();
        editor.exec({ type: 'wall.add', levelId: ground, a: [0, 0], b: [5, 0], thickness: 0.1 });

        expect(calls).toBe(0);
    });
});

describe('structural sharing', () => {
    it('keeps untouched Levels and Elements as the same objects', () => {
        const { editor, ground } = twoLevelEditor();
        editor.exec({
            type: 'wall.add',
            levelId: ground,
            id: 'W1',
            a: [0, 0],
            b: [5, 0],
            thickness: 0.1,
        });
        const before = editor.getDocument();

        editor.exec({
            type: 'wall.add',
            levelId: ground,
            id: 'W2',
            a: [0, 5],
            b: [5, 5],
            thickness: 0.1,
        });

        const after = editor.getDocument();
        expect(after.levels[1]).toBe(before.levels[1]);
        expect(after.levels[0]).not.toBe(before.levels[0]);
        expect(after.levels[0]?.walls[0]).toBe(before.levels[0]?.walls[0]);
        expect(after.levels[0]?.outline).toBe(before.levels[0]?.outline);
    });
});

describe('transactions', () => {
    it('previews each step live and commits them as one undo step', () => {
        const { editor, ground, changes } = twoLevelEditor();
        editor.exec({ type: 'wall.add', levelId: ground, a: [0, 0], b: [5, 0], thickness: 0.1 });
        const beforeDrag = editor.getDocument();
        const node = beforeDrag.levels[0]!.wallNodes[1]!.id;
        changes.length = 0;

        const tx = editor.begin();
        tx.exec({ type: 'wallNode.move', levelId: ground, nodeId: node, to: [6, 0] });
        tx.exec({ type: 'wallNode.move', levelId: ground, nodeId: node, to: [7, 1] });
        tx.commit();

        expect(changes).toHaveLength(2);
        expect(editor.getDocument().levels[0]?.wallNodes[1]?.position).toEqual([7, 1]);
        editor.undo();
        expect(editor.getDocument()).toBe(beforeDrag);
    });

    it('cancel restores the Document from before the transaction', () => {
        const { editor, ground } = twoLevelEditor();
        const before = editor.getDocument();

        const tx = editor.begin();
        tx.exec({ type: 'wall.add', levelId: ground, a: [0, 0], b: [5, 0], thickness: 0.1 });
        tx.cancel();

        expect(editor.getDocument()).toBe(before);
        editor.undo();
        expect(editor.getDocument().levels.map((l) => l.id)).not.toContain('L2');
    });

    it('a transaction with no successful steps adds no undo step', () => {
        const { editor } = twoLevelEditor();

        const tx = editor.begin();
        tx.exec({ type: 'wall.delete', levelId: 'nope', wallId: 'nope' });
        tx.commit();
        editor.undo();

        expect(editor.getDocument().levels).toHaveLength(1);
    });

    it('blocks other edits while a transaction is open', () => {
        const { editor, ground } = twoLevelEditor();
        editor.begin();

        expect(() =>
            editor.exec({
                type: 'wall.add',
                levelId: ground,
                a: [0, 0],
                b: [5, 0],
                thickness: 0.1,
            }),
        ).toThrow(/transaction/);
        expect(() => editor.undo()).toThrow(/transaction/);
        expect(() => editor.begin()).toThrow(/transaction/);
    });
});
