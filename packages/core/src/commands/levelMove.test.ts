import { describe, expect, it } from 'vitest';
import { createEditor, createSpace } from '../index.ts';

/** Ground (elev 0, 4 m), Mezzanine (4, 3 m) and Roof (7, 3 m); levels as `name@ordinal:elevation`. */
function tower() {
    const doc = createSpace({ name: 'Tower', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const ground = doc.levels[0]!.id;
    editor.exec({ type: 'level.update', levelId: ground, changes: { name: 'Ground', height: 4 } });
    editor.exec({ type: 'level.add', id: 'MEZZ', name: 'Mezzanine', height: 3 });
    editor.exec({ type: 'level.add', id: 'ROOF', name: 'Roof', height: 3 });
    const stack = () =>
        [...editor.getDocument().levels]
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((l) => `${l.name}@${l.ordinal}:${l.elevation}`);
    return { editor, ground, stack };
}

describe('level.move', () => {
    it('swaps a Level with the one above, re-stacking their elevations', () => {
        const { editor, ground, stack } = tower();

        const result = editor.exec({ type: 'level.move', levelId: ground, direction: 'up' });

        expect(result.ok).toBe(true);
        expect(stack()).toEqual(['Mezzanine@0:0', 'Ground@1:3', 'Roof@2:7']);
    });

    it('swaps a Level with the one below', () => {
        const { editor, stack } = tower();

        editor.exec({ type: 'level.move', levelId: 'ROOF', direction: 'down' });

        expect(stack()).toEqual(['Ground@0:0', 'Roof@1:4', 'Mezzanine@2:7']);
    });

    it('keeps a gap between the two Levels when there is one', () => {
        const { editor, ground, stack } = tower();
        editor.exec({ type: 'level.update', levelId: 'MEZZ', changes: { elevation: 5 } });

        editor.exec({ type: 'level.move', levelId: ground, direction: 'up' });

        // Mezzanine (3 m) goes to 0; the 1 m gap stays; Ground sits at 3 + 1 = 4.
        expect(stack()).toEqual(['Mezzanine@0:0', 'Ground@1:4', 'Roof@2:7']);
    });

    it('does nothing, with no undo step, at the top or bottom of the stack', () => {
        const { editor, ground } = tower();
        const before = editor.getDocument();

        editor.exec({ type: 'level.move', levelId: 'ROOF', direction: 'up' });
        editor.exec({ type: 'level.move', levelId: ground, direction: 'down' });

        expect(editor.getDocument()).toBe(before);
    });

    it('moves within the Level’s own Level Group', () => {
        const { editor, ground, stack } = tower();
        editor.exec({ type: 'level.update', levelId: 'MEZZ', changes: { group: 'Pavilion B' } });

        editor.exec({ type: 'level.move', levelId: ground, direction: 'up' });

        // Mezzanine is in another group, so Ground swaps with Roof instead; the 3 m gap between
        // them (where Mezzanine is) is kept: Roof at 0, Ground at 3 + 3.
        expect(stack()).toEqual(['Roof@0:0', 'Mezzanine@1:4', 'Ground@2:6']);
    });

    it('rejects an unknown Level', () => {
        const { editor } = tower();

        expect(editor.exec({ type: 'level.move', levelId: 'ghost', direction: 'up' }).ok).toBe(
            false,
        );
    });
});
