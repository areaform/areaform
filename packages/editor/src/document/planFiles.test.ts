import { createSpace, fromJSON, type AreaformDocument } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    describeLoadError,
    describeLoadErrors,
    relativeSources,
    sortDraftFiles,
} from './planFiles.ts';

const file = (name: string) => new File(['x'], name);

/** A file picked with its folder, as `webkitdirectory` gives it. */
function inFolder(path: string): File {
    const picked = file(path.split('/').at(-1)!);
    Object.defineProperty(picked, 'webkitRelativePath', { value: path });
    return picked;
}

/** A plan whose Underlay names an image next to it, as a Draft's does. */
function withSource(): AreaformDocument {
    const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [30, 20] });
    const underlay = {
        id: 'import-source',
        src: 'source.png',
        position: [0, 20] as [number, number],
        scale: 0.1,
        rotation: 0,
        opacity: 0.5,
        locked: true,
    };
    return { ...doc, levels: [{ ...doc.levels[0]!, underlays: [underlay] }] };
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
        const doc = withSource();
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

describe('describeLoadError', () => {
    const loadErrors = (json: string) => {
        const loaded = fromJSON(json);
        if (loaded.ok) throw new Error('expected the plan not to load');
        return loaded.errors;
    };

    it('says what is wrong with a file that is not a plan', () => {
        expect(describeLoadErrors(loadErrors('{ "levels": ['))).toBe('The file is not valid JSON.');
        expect(describeLoadErrors(loadErrors('{ "name": "Hall" }'))).toMatch(
            /not an Areaform plan/,
        );
        expect(describeLoadErrors(loadErrors('{ "schemaVersion": 99, "levels": [] }'))).toMatch(
            /newer version of Areaform \(schema 99\)/,
        );
    });

    it('names the place in the file that has the wrong type', () => {
        const doc = JSON.parse(JSON.stringify(withSource())) as { levels: { height: unknown }[] };
        doc.levels[0]!.height = 'tall';
        expect(describeLoadErrors(loadErrors(JSON.stringify(doc)))).toMatch(
            /^`levels\[0\]\.height` should be/,
        );
    });

    it('names the element that breaks a rule, by its id', () => {
        const doc = withSource();
        const wall = { id: 'w-broken', a: 'nowhere', b: 'nowhere-else', thickness: 0.2 };
        const broken = { ...doc, levels: [{ ...doc.levels[0]!, walls: [wall] }] };
        expect(describeLoadErrors(loadErrors(JSON.stringify(broken)))).toMatch(
            /“w-broken” refers to “nowhere”, which the plan does not have/,
        );
    });

    it('shows the first three errors and counts the rest', () => {
        const errors = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
            code: 'degenerate-wall' as const,
            id,
        }));
        const text = describeLoadErrors(errors);
        expect(text).toContain('“c”');
        expect(text).not.toContain('“d”');
        expect(text).toMatch(/And 2 more\.$/);
    });

    it('has a sentence for every error, never the bare code', () => {
        expect(describeLoadError({ code: 'too-few-stops', id: 'lift' })).toBe(
            'The Connection “lift” stops on fewer than two Levels.',
        );
    });
});
