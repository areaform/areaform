import { createEditor, createSpace, type AreaformDocument } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { flagTargetExists, importFlags, resolveFlag, type ImportFlag } from './draftImport.ts';

function draft(): AreaformDocument {
    const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [30, 20] });
    const levelId = doc.levels[0]!.id;
    const flags: ImportFlag[] = [
        { ref: { kind: 'zone', id: 'B1', levelId }, reason: 'Category guessed', sourceRef: '1:2' },
        { ref: { kind: 'level', id: levelId }, reason: 'Outline guessed' },
    ];
    return {
        ...doc,
        meta: { host: 'kept', import: { importedAt: '2026-10-22', scale: 0.1, flags } },
        levels: [
            {
                ...doc.levels[0]!,
                zones: [
                    {
                        id: 'B1',
                        shape: {
                            outer: [
                                [1, 1],
                                [4, 1],
                                [4, 4],
                                [1, 4],
                            ],
                        },
                    },
                ],
                underlays: [
                    {
                        id: 'import-source',
                        src: 'source.png',
                        position: [0, 20],
                        scale: 0.1,
                        rotation: 0,
                        opacity: 0.5,
                        locked: true,
                    },
                ],
            },
        ],
    };
}

describe('Import Flags', () => {
    it('reads the flags, skipping malformed ones', () => {
        const doc = draft();
        expect(importFlags(doc).map((f) => f.reason)).toEqual([
            'Category guessed',
            'Outline guessed',
        ]);
        const broken = {
            ...doc,
            meta: { import: { flags: [{ reason: 'no ref' }, 'text', null] } },
        };
        expect(importFlags(broken)).toEqual([]);
        expect(importFlags({ ...doc, meta: { import: 'odd' } })).toEqual([]);
        expect(importFlags({ ...doc, meta: {} })).toEqual([]);
    });

    it('knows whether the flagged Level or Element is still there', () => {
        const doc = draft();
        const [zone, level] = importFlags(doc);
        expect(flagTargetExists(doc, zone!)).toBe(true);
        expect(flagTargetExists(doc, level!)).toBe(true);
        const gone = { ...doc, levels: [{ ...doc.levels[0]!, zones: [] }] };
        expect(flagTargetExists(gone, zone!)).toBe(false);
    });

    it('marks a flag as reviewed with an undoable edit, keeping the rest of meta', () => {
        const editor = createEditor(draft());
        const [zone] = importFlags(editor.getDocument());
        expect(editor.exec(resolveFlag(editor.getDocument(), zone!)!)).toEqual({ ok: true });
        const doc = editor.getDocument();
        expect(importFlags(doc).map((f) => f.reason)).toEqual(['Outline guessed']);
        expect(doc.meta).toMatchObject({ host: 'kept', import: { scale: 0.1 } });
        editor.undo();
        expect(importFlags(editor.getDocument())).toHaveLength(2);
    });

    it('does nothing for a flag already marked, even from an earlier Document', () => {
        const editor = createEditor(draft());
        const [zone] = importFlags(editor.getDocument());
        editor.exec(resolveFlag(editor.getDocument(), zone!)!);
        expect(resolveFlag(editor.getDocument(), zone!)).toBeUndefined();
        const copy = structuredClone(zone!);
        editor.undo();
        expect(resolveFlag(editor.getDocument(), copy)).toBeDefined();
    });
});
