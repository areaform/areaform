import { describe, expect, it } from 'vitest';
import { createEditor, createSpace } from '../index.ts';

function officeEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const level = () => editor.getDocument().levels[0]!;
    const nodeAt = (x: number, y: number) =>
        level().wallNodes.find((n) => n.position[0] === x && n.position[1] === y);
    return { editor, levelId, level, nodeAt };
}

describe('wall.add', () => {
    it('creates a Wall between two new Wall Nodes', () => {
        const { editor, levelId, level } = officeEditor();

        const result = editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W1',
            a: [0, 0],
            b: [10, 0],
            thickness: 0.15,
        });

        expect(result.ok).toBe(true);
        const [nodeA, nodeB] = level().wallNodes;
        expect(nodeA?.position).toEqual([0, 0]);
        expect(nodeB?.position).toEqual([10, 0]);
        expect(level().walls).toEqual([{ id: 'W1', a: nodeA?.id, b: nodeB?.id, thickness: 0.15 }]);
    });

    it('connects to an existing Wall Node given by id', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [10, 0], thickness: 0.15 });
        const corner = nodeAt(10, 0)!;

        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W2',
            a: { nodeId: corner.id },
            b: [10, 8],
            thickness: 0.15,
        });

        expect(level().wallNodes).toHaveLength(3);
        expect(level().walls.find((w) => w.id === 'W2')?.a).toBe(corner.id);
    });

    it('reuses a Wall Node that already sits exactly at a given point', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [10, 0], thickness: 0.15 });

        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W2',
            a: [10, 0],
            b: [10, 8],
            thickness: 0.15,
        });

        expect(level().wallNodes).toHaveLength(3);
        expect(level().walls.find((w) => w.id === 'W2')?.a).toBe(nodeAt(10, 0)?.id);
    });
});

describe('wall.add rejections', () => {
    it('rejects an unknown Level', () => {
        const { editor } = officeEditor();
        const before = editor.getDocument();

        const result = editor.exec({
            type: 'wall.add',
            levelId: 'nope',
            a: [0, 0],
            b: [1, 0],
            thickness: 0.1,
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'unknown-level', levelId: 'nope' }] });
        expect(editor.getDocument()).toBe(before);
    });

    it('rejects a Wall Node id that does not exist on the Level', () => {
        const { editor, levelId } = officeEditor();

        const result = editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W1',
            a: { nodeId: 'ghost' },
            b: [1, 0],
            thickness: 0.1,
        });

        expect(result).toEqual({
            ok: false,
            errors: [{ code: 'dangling-reference', id: 'W1', ref: 'ghost' }],
        });
    });

    it('rejects a zero-length Wall', () => {
        const { editor, levelId, level } = officeEditor();

        const result = editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W1',
            a: [3, 3],
            b: [3, 3],
            thickness: 0.1,
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'degenerate-wall', id: 'W1' }] });
        expect(level().wallNodes).toEqual([]);
    });
});

describe('automatic wall splitting', () => {
    /** Walls as sorted coordinate pairs, so the assertions don't depend on node ids. */
    function segments(level: ReturnType<ReturnType<typeof officeEditor>['level']>) {
        const pos = new Map(level.wallNodes.map((n) => [n.id, n.position]));
        const byXY = (p: [number, number], q: [number, number]) => p[0] - q[0] || p[1] - q[1];
        return level.walls.map((w) => [pos.get(w.a)!, pos.get(w.b)!].sort(byXY).join(' → ')).sort();
    }

    it('splits an existing Wall where a new Wall ends on it (T-junction)', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });

        editor.exec({ type: 'wall.add', levelId, id: 'W2', a: [4, 6], b: [4, 0], thickness: 0.1 });

        expect(segments(level())).toEqual(['0,0 → 4,0', '4,0 → 10,0', '4,0 → 4,6']);
        const junction = nodeAt(4, 0)!;
        expect(
            level().walls.filter((w) => w.a === junction.id || w.b === junction.id),
        ).toHaveLength(3);
        expect(level().walls.filter((w) => w.thickness === 0.2)).toHaveLength(2);
        expect(level().walls.map((w) => w.id)).toContain('W1');
    });

    it('splits both Walls where they cross (X-junction)', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [10, 0], thickness: 0.2 });

        editor.exec({ type: 'wall.add', levelId, a: [4, -3], b: [4, 3], thickness: 0.2 });

        expect(segments(level())).toEqual(['0,0 → 4,0', '4,-3 → 4,0', '4,0 → 10,0', '4,0 → 4,3']);
        expect(nodeAt(4, 0)).toBeDefined();
    });

    it('undoes a wall and its split in one step', () => {
        const { editor, levelId, level } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [10, 0], thickness: 0.2 });
        editor.exec({ type: 'wall.add', levelId, a: [4, -3], b: [4, 3], thickness: 0.2 });

        editor.undo();

        expect(segments(level())).toEqual(['0,0 → 10,0']);
        expect(level().wallNodes).toHaveLength(2);
    });

    it('does not split Walls that only touch at an existing Wall Node', () => {
        const { editor, levelId, level } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, a: [0, 0], b: [10, 0], thickness: 0.2 });

        editor.exec({ type: 'wall.add', levelId, a: [10, 0], b: [10, 5], thickness: 0.2 });

        expect(level().walls).toHaveLength(2);
        expect(level().wallNodes).toHaveLength(3);
    });
});

describe('wallNode.move', () => {
    it('moves every Wall attached to the Wall Node', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });
        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W2',
            a: [10, 0],
            b: [10, 8],
            thickness: 0.2,
        });
        const corner = nodeAt(10, 0)!;

        const result = editor.exec({
            type: 'wallNode.move',
            levelId,
            nodeId: corner.id,
            to: [12, 1],
        });

        expect(result.ok).toBe(true);
        expect(nodeAt(12, 1)?.id).toBe(corner.id);
        const attached = level().walls.filter((w) => w.a === corner.id || w.b === corner.id);
        expect(attached.map((w) => w.id).sort()).toEqual(['W1', 'W2']);
    });

    it('rejects a move that collapses a Wall to zero length', () => {
        const { editor, levelId, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });

        const result = editor.exec({
            type: 'wallNode.move',
            levelId,
            nodeId: nodeAt(10, 0)!.id,
            to: [0, 0],
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'degenerate-wall', id: 'W1' }] });
    });

    it('rejects an unknown Wall Node', () => {
        const { editor, levelId } = officeEditor();

        const result = editor.exec({ type: 'wallNode.move', levelId, nodeId: 'ghost', to: [1, 1] });

        expect(result).toEqual({ ok: false, errors: [{ code: 'unknown-element', id: 'ghost' }] });
    });
});

describe('wall.delete', () => {
    it('removes the Wall and any Wall Node no longer used by another Wall', () => {
        const { editor, levelId, level, nodeAt } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });
        editor.exec({
            type: 'wall.add',
            levelId,
            id: 'W2',
            a: [10, 0],
            b: [10, 8],
            thickness: 0.2,
        });

        const result = editor.exec({ type: 'wall.delete', levelId, wallId: 'W2' });

        expect(result.ok).toBe(true);
        expect(level().walls.map((w) => w.id)).toEqual(['W1']);
        expect(nodeAt(10, 0)).toBeDefined();
        expect(nodeAt(10, 8)).toBeUndefined();
    });

    it('is undone in one step, restoring its Wall Nodes', () => {
        const { editor, levelId, level } = officeEditor();
        editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });
        editor.exec({ type: 'wall.delete', levelId, wallId: 'W1' });

        editor.undo();

        expect(level().walls.map((w) => w.id)).toEqual(['W1']);
        expect(level().wallNodes).toHaveLength(2);
    });

    it('rejects an unknown Wall', () => {
        const { editor, levelId } = officeEditor();

        const result = editor.exec({ type: 'wall.delete', levelId, wallId: 'ghost' });

        expect(result).toEqual({ ok: false, errors: [{ code: 'unknown-element', id: 'ghost' }] });
    });
});
