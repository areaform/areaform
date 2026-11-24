import { createEditor, createSpace, type AreaformDocument } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { levelDropMove, levelsTopDown } from './levelOrder.ts';

/** Basement (-1), Ground (0), First (1), Roof (2), and a Pavilion level on its own. */
function stack(): AreaformDocument {
    const editor = createEditor(createSpace({ name: 'T', kind: 'office', size: [10, 10] }));
    const ground = editor.getDocument().levels[0]!.id;
    editor.exec({ type: 'level.update', levelId: ground, changes: { name: 'Ground' } });
    editor.exec({ type: 'level.add', id: 'first', name: 'First' });
    editor.exec({ type: 'level.add', id: 'roof', name: 'Roof' });
    editor.exec({ type: 'level.add', id: 'base', name: 'Basement', at: 'bottom' });
    editor.exec({ type: 'level.add', id: 'pav', name: 'Pavilion', group: 'Pavilion' });
    return editor.getDocument();
}

const groundId = (doc: AreaformDocument) => doc.levels.find((l) => l.name === 'Ground')!.id;

describe('levelsTopDown', () => {
    it('lists a group from its highest Level down', () => {
        const doc = stack();

        expect(levelsTopDown(doc.levels.filter((l) => !l.group)).map((l) => l.name)).toEqual([
            'Roof',
            'First',
            'Ground',
            'Basement',
        ]);
    });
});

describe('levelDropMove', () => {
    it('moves a Level up past every Level it is dropped above', () => {
        const doc = stack();

        expect(levelDropMove(doc, 'base', 'first', 'above')).toEqual({ direction: 'up', steps: 2 });
        expect(levelDropMove(doc, 'base', 'first', 'below')).toEqual({ direction: 'up', steps: 1 });
    });

    it('moves a Level down past every Level it is dropped below', () => {
        const doc = stack();

        expect(levelDropMove(doc, 'roof', 'base', 'below')).toEqual({
            direction: 'down',
            steps: 3,
        });
        expect(levelDropMove(doc, 'roof', groundId(doc), 'above')).toEqual({
            direction: 'down',
            steps: 1,
        });
    });

    it('does nothing for a drop that leaves the Level where it is', () => {
        const doc = stack();

        expect(levelDropMove(doc, 'first', 'first', 'above')).toBeNull();
        expect(levelDropMove(doc, 'first', 'roof', 'below')).toBeNull();
        expect(levelDropMove(doc, 'first', groundId(doc), 'above')).toBeNull();
    });

    it('refuses a drop onto a Level of another group', () => {
        const doc = stack();

        expect(levelDropMove(doc, 'first', 'pav', 'above')).toBeNull();
    });
});
