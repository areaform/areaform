import { describe, expect, it } from 'vitest';
import { createEditor, createSpace } from './index.ts';

function expoEditor() {
    return createEditor(createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] }));
}

describe('level.add', () => {
    it('adds a Level above the top one, inheriting its Outline', () => {
        const editor = expoEditor();

        const result = editor.exec({ type: 'level.add', name: 'Mezzanine' });

        expect(result.ok).toBe(true);
        const levels = editor.getDocument().levels;
        expect(levels.map((l) => l.name)).toEqual(['Level 1', 'Mezzanine']);
        const added = levels[1];
        expect(added?.ordinal).toBe(1);
        expect(added?.elevation).toBe(6);
        expect(added?.height).toBe(6);
        expect(added?.outline).toEqual(levels[0]?.outline);
        expect(added?.walls).toEqual([]);
    });

    it('uses explicit elevation, height and caller-supplied id', () => {
        const editor = expoEditor();

        editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2', elevation: 4, height: 3.5 });

        const added = editor.getDocument().levels[1];
        expect(added).toMatchObject({ id: 'L2', elevation: 4, height: 3.5 });
    });

    it('never mutates a Document it has already handed out', () => {
        const editor = expoEditor();
        const before = editor.getDocument();

        editor.exec({ type: 'level.add', name: 'Level 2' });

        expect(before.levels).toHaveLength(1);
        expect(editor.getDocument()).not.toBe(before);
    });
});

describe('undo / redo', () => {
    it('undo reverts the last Command and redo reapplies it', () => {
        const editor = expoEditor();
        editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });

        editor.undo();
        expect(editor.getDocument().levels.map((l) => l.name)).toEqual(['Level 1']);

        editor.redo();
        expect(editor.getDocument().levels.map((l) => l.id)).toContain('L2');
    });

    it('a new Command after undo discards the redo stack', () => {
        const editor = expoEditor();
        editor.exec({ type: 'level.add', name: 'Level 2' });
        editor.undo();

        editor.exec({ type: 'level.add', name: 'Level 2b' });

        expect(editor.canRedo()).toBe(false);
        editor.redo();
        expect(editor.getDocument().levels.map((l) => l.name)).toEqual(['Level 1', 'Level 2b']);
    });

    it('undo and redo with empty history do nothing', () => {
        const editor = expoEditor();
        const before = editor.getDocument();

        expect(editor.canUndo()).toBe(false);
        editor.undo();
        editor.redo();

        expect(editor.getDocument()).toBe(before);
    });
});

describe('replace', () => {
    it('puts another Document in place as one undo step', () => {
        const editor = createEditor(createSpace({ name: 'Now', kind: 'office', size: [20, 10] }));
        const now = editor.getDocument();
        const earlier = createSpace({ name: 'Earlier', kind: 'office', size: [20, 10] });
        const changes: string[] = [];
        editor.on('change', (doc) => changes.push(doc.name));

        expect(editor.replace(earlier)).toEqual({ ok: true });
        expect(editor.getDocument()).toBe(earlier);
        expect(changes).toEqual(['Earlier']);
        editor.undo();
        expect(editor.getDocument()).toBe(now);
        editor.redo();
        expect(editor.getDocument()).toBe(earlier);
    });

    it('rejects a Document that breaks an Invariant, changing nothing', () => {
        const editor = createEditor(createSpace({ name: 'Now', kind: 'office', size: [20, 10] }));
        const now = editor.getDocument();
        const broken = { ...now, levels: [now.levels[0]!, now.levels[0]!] };

        const result = editor.replace(broken);
        expect(result.ok).toBe(false);
        expect(editor.getDocument()).toBe(now);
        expect(editor.canUndo()).toBe(false);
    });
});

describe('Invariants', () => {
    it('rejects a Command that would duplicate an id, leaving the Document and history untouched', () => {
        const editor = expoEditor();
        editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
        const before = editor.getDocument();

        const result = editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2 again' });

        expect(result).toEqual({
            ok: false,
            errors: [{ code: 'duplicate-id', id: 'L2' }],
        });
        expect(editor.getDocument()).toBe(before);
        editor.undo();
        expect(editor.getDocument().levels).toHaveLength(1);
    });
});

describe('unknown Commands', () => {
    it('throws for a type this version does not route, including prototype names', () => {
        const editor = createEditor(createSpace({ name: 'Hall', kind: 'office', size: [10, 10] }));
        const before = editor.getDocument();

        for (const type of ['zone.paint', 'toString', '__proto__'])
            expect(() => editor.exec({ type } as never)).toThrow(/Unknown command type/);
        expect(editor.getDocument()).toBe(before);
    });
});
