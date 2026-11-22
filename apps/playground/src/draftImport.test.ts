import { createEditor, createSpace, type AreaformDocument } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    flagTargetExists,
    importFlags,
    relativeSources,
    resolveFlag,
    sortDraftFiles,
    type ImportFlag,
} from './draftImport.ts';

const file = (name: string) => new File(['x'], name);

/** A file picked with its folder, as `webkitdirectory` gives it. */
function inFolder(path: string): File {
    const picked = file(path.split('/').at(-1)!);
    Object.defineProperty(picked, 'webkitRelativePath', { value: path });
    return picked;
}

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

describe('sortDraftFiles', () => {
    it('takes the only plan and the images by name', () => {
        const plan = file('hall.json');
        const shot = file('source.png');
        expect(sortDraftFiles([shot, plan, file('notes.txt')])).toEqual({
            plan,
            images: new Map([['source.png', shot]]),
        });
    });

    it('prefers plan.json when a folder holds several plans', () => {
        const plan = file('plan.json');
        const result = sortDraftFiles([file('old.json'), plan]);
        expect(result).toMatchObject({ plan });
    });

    it('explains when there is no plan to take', () => {
        expect(sortDraftFiles([file('source.png')])).toEqual({
            error: 'no plan (.json) among the files',
        });
        expect(sortDraftFiles([file('a.json'), file('b.json')])).toMatchObject({
            error: expect.stringContaining('several plans'),
        });
    });

    it('takes only the images next to the plan from a picked folder', () => {
        const plan = inFolder('drafts/hall-a/plan.json');
        const shot = inFolder('drafts/hall-a/source.png');
        const other = inFolder('drafts/hall-a/old/source.png');
        expect(sortDraftFiles([other, plan, shot])).toEqual({
            plan,
            images: new Map([['source.png', shot]]),
        });
    });

    it('refuses a folder holding several Drafts', () => {
        expect(
            sortDraftFiles([
                inFolder('drafts/hall-a/plan.json'),
                inFolder('drafts/hall-b/plan.json'),
            ]),
        ).toEqual({
            error: 'several Drafts in the folder (drafts/hall-a/plan.json, drafts/hall-b/plan.json); pick one',
        });
    });
});

describe('relativeSources', () => {
    it('lists Underlay files named next to the plan, not URLs', () => {
        const doc = draft();
        const level = doc.levels[0]!;
        const other = { ...level.underlays[0]!, id: 'web', src: 'https://example.com/a.png' };
        const data = { ...level.underlays[0]!, id: 'data', src: 'data:image/png;base64,AA' };
        const rooted = { ...level.underlays[0]!, id: 'rooted', src: '/scans/a.png' };
        const withUrls = {
            ...doc,
            levels: [{ ...level, underlays: [...level.underlays, other, data, rooted] }],
        };
        expect(relativeSources(withUrls)).toEqual(['source.png']);
    });
});

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
