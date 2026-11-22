import { describe, expect, it } from 'vitest';
import { createEditor, createSpace } from './index.ts';

/**
 * An expo with two pavilions: A1 (A, ordinal 0, 6 m), A2 (A, ordinal 1) and B1 (B, ordinal 0,
 * 8 m ceiling, its own Outline).
 */
function pavilions() {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const A1 = doc.levels[0]!.id;
    editor.exec({
        type: 'level.update',
        levelId: A1,
        changes: { name: 'A1', group: 'Pavilion A' },
    });
    editor.exec({ type: 'level.add', id: 'A2', name: 'A2', group: 'Pavilion A' });
    editor.exec({ type: 'level.add', id: 'B1', name: 'B1', group: 'Pavilion B', height: 8 });
    editor.exec({
        type: 'level.setOutline',
        levelId: 'B1',
        outline: {
            outer: [
                [50, 0],
                [70, 0],
                [70, 20],
                [50, 20],
            ],
        },
    });
    const level = (id: string) => editor.getDocument().levels.find((l) => l.id === id)!;
    return { editor, A1, level };
}

describe('Level Groups', () => {
    it('level.add stacks a new Level on top of its own group', () => {
        const { level } = pavilions();

        expect(level('A2')).toMatchObject({ group: 'Pavilion A', ordinal: 1, elevation: 6 });
        // Pavilion B had no Levels yet: its first Level starts at the ground.
        expect(level('B1')).toMatchObject({
            group: 'Pavilion B',
            ordinal: 0,
            elevation: 0,
            height: 8,
        });
    });

    it('level.add into a group copies the Outline of that group’s top Level', () => {
        const { editor, level } = pavilions();

        editor.exec({ type: 'level.add', id: 'B2', name: 'B2', group: 'Pavilion B' });

        expect(level('B2')).toMatchObject({ ordinal: 1, elevation: 8 });
        expect(level('B2').outline).toEqual(level('B1').outline);
    });

    it('level.add without a group stacks on the ungrouped Levels', () => {
        const { editor, level } = pavilions();

        editor.exec({ type: 'level.add', id: 'X', name: 'Annex' });

        expect(level('X')).not.toHaveProperty('group');
        expect(level('X')).toMatchObject({ ordinal: 0, elevation: 0 });
    });

    it('level.duplicate puts the copy on top of the source’s group', () => {
        const { editor, level } = pavilions();

        editor.exec({ type: 'level.duplicate', levelId: 'B1', id: 'B1-copy' });

        expect(level('B1-copy')).toMatchObject({ group: 'Pavilion B', ordinal: 1, elevation: 8 });
    });
});

describe('level.add at the bottom', () => {
    it('adds a basement under the lowest Level: ordinal −1, its elevation one height down', () => {
        const doc = createSpace({ name: 'Tower', kind: 'office', size: [20, 10] });
        const editor = createEditor(doc);

        editor.exec({ type: 'level.add', id: 'B1', name: 'Basement 1', at: 'bottom' });
        editor.exec({ type: 'level.add', id: 'B2', name: 'Basement 2', at: 'bottom', height: 4 });

        const level = (id: string) => editor.getDocument().levels.find((l) => l.id === id)!;
        // Office ground floor: ordinal 0, elevation 0, 3 m ceiling.
        expect(level('B1')).toMatchObject({ ordinal: -1, elevation: -3, height: 3 });
        expect(level('B2')).toMatchObject({ ordinal: -2, elevation: -7, height: 4 });
        expect(level('B2').outline).toEqual(doc.levels[0]!.outline);
    });

    it('adds under the lowest Level of its own group', () => {
        const { editor, level } = pavilions();

        editor.exec({
            type: 'level.add',
            id: 'B0',
            name: 'B basement',
            group: 'Pavilion B',
            at: 'bottom',
        });

        expect(level('B0')).toMatchObject({
            group: 'Pavilion B',
            ordinal: -1,
            elevation: -8,
            height: 8,
        });
        expect(level('B0').outline).toEqual(level('B1').outline);
    });
});
