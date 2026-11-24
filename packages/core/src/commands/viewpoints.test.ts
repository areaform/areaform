import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    fromJSON,
    toGeoJSON,
    MAX_VIEWPOINT_TILT,
    toJSON,
    viewpointSpot,
    type Viewpoint,
} from '../index.ts';

function hallEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [40, 25] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const viewpoints = () => editor.getDocument().levels[0]!.viewpoints;
    const ids = () => viewpoints()?.map((v) => v.id);
    const add = (id: string, index?: number) =>
        editor.exec({
            type: 'viewpoint.add',
            levelId,
            viewpoint: { ...entrance, id },
            ...(index !== undefined && { index }),
        });
    return { editor, levelId, viewpoints, ids, add };
}

const entrance: Viewpoint = {
    id: 'V1',
    name: 'Entrance',
    target: [20, 5],
    bearing: 0,
    tilt: 45,
    distance: 30,
};

describe('viewpoint.add', () => {
    it('saves a camera last in the Level’s tour, or at the place asked', () => {
        const { add, ids } = hallEditor();

        add('V1');
        add('V2');
        add('V0', 0);

        expect(ids()).toEqual(['V0', 'V1', 'V2']);
    });

    it('takes a tilt up to the 3D view’s limit, 87°', () => {
        const { editor, levelId } = hallEditor();

        const result = editor.exec({
            type: 'viewpoint.add',
            levelId,
            viewpoint: { ...entrance, tilt: MAX_VIEWPOINT_TILT },
        });

        expect(result.ok).toBe(true);
    });

    it('gives a Viewpoint without an id one of its own', () => {
        const { editor, levelId, viewpoints } = hallEditor();
        const withoutId: Partial<Viewpoint> = { ...entrance };
        delete withoutId.id;

        editor.exec({
            type: 'viewpoint.add',
            levelId,
            viewpoint: withoutId as Omit<Viewpoint, 'id'>,
        });

        expect(viewpoints()![0]!.id).toEqual(expect.any(String));
    });

    it.each([
        ['a tilt past the 3D view’s limit, 87°', { tilt: 87.5 }],
        ['a negative tilt', { tilt: -1 }],
        ['no distance', { distance: 0 }],
        ['a non-finite bearing', { bearing: Number.NaN }],
        ['a negative flight', { flight: -1 }],
        ['a negative pause', { pause: -0.5 }],
    ])('rejects a Viewpoint with %s', (_, override) => {
        const { editor, levelId } = hallEditor();

        const result = editor.exec({
            type: 'viewpoint.add',
            levelId,
            viewpoint: { ...entrance, ...override },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'invalid-viewpoint', id: 'V1' }] });
    });

    it('rejects a place outside the tour, and an id another Element has', () => {
        const { add, editor, levelId } = hallEditor();

        expect(add('V1', 1)).toMatchObject({ ok: false });
        expect(add(levelId)).toEqual({
            ok: false,
            errors: [{ code: 'duplicate-id', id: levelId }],
        });
        expect(editor.getDocument().levels[0]!.viewpoints).toBeUndefined();
    });
});

describe('viewpoint.update', () => {
    it('changes what is given, and clears an optional property set to undefined', () => {
        const { add, editor, levelId, viewpoints } = hallEditor();
        add('V1');

        editor.exec({
            type: 'viewpoint.update',
            levelId,
            viewpointId: 'V1',
            changes: { bearing: 135, name: undefined, pause: 4 },
        });

        expect(viewpoints()).toEqual([
            { id: 'V1', target: [20, 5], bearing: 135, tilt: 45, distance: 30, pause: 4 },
        ]);
    });

    it('rejects a Viewpoint the Level has not', () => {
        const { editor, levelId } = hallEditor();

        const result = editor.exec({
            type: 'viewpoint.update',
            levelId,
            viewpointId: 'nope',
            changes: { tilt: 10 },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'unknown-element', id: 'nope' }] });
    });
});

describe('viewpoint.move', () => {
    it('moves a Viewpoint to another place in the tour, the others keeping their order', () => {
        const { add, editor, levelId, ids } = hallEditor();
        add('A');
        add('B');
        add('C');

        editor.exec({ type: 'viewpoint.move', levelId, viewpointId: 'C', index: 0 });
        expect(ids()).toEqual(['C', 'A', 'B']);
        editor.exec({ type: 'viewpoint.move', levelId, viewpointId: 'C', index: 2 });
        expect(ids()).toEqual(['A', 'B', 'C']);
    });

    it('to where it already is, changes nothing and adds no undo step', () => {
        const { add, editor, levelId } = hallEditor();
        add('A');
        add('B');
        const before = editor.getDocument();

        editor.exec({ type: 'viewpoint.move', levelId, viewpointId: 'B', index: 1 });

        expect(editor.getDocument()).toBe(before);
    });
});

describe('viewpoint.delete', () => {
    it('removes it, and the last one takes the property with it; undo brings it back', () => {
        const { add, editor, levelId, viewpoints } = hallEditor();
        add('V1');

        editor.exec({ type: 'viewpoint.delete', levelId, viewpointId: 'V1' });
        expect('viewpoints' in editor.getDocument().levels[0]!).toBe(false);

        editor.undo();
        expect(viewpoints()?.map((v) => v.id)).toEqual(['V1']);
    });
});

describe('Viewpoints with their Level', () => {
    it('a duplicated Level gets copies with ids of their own', () => {
        const { add, editor, levelId } = hallEditor();
        add('V1');

        editor.exec({ type: 'level.duplicate', levelId });

        const copy = editor.getDocument().levels[1]!.viewpoints!;
        expect(copy).toHaveLength(1);
        expect(copy[0]!.id).not.toBe('V1');
        expect(copy[0]!.name).toBe('Entrance');
    });

    it('are left out of the GeoJSON export, which shows the place, not a camera', () => {
        const { add, editor } = hallEditor();
        const before = toGeoJSON(editor.getDocument());
        add('V1');

        expect(toGeoJSON(editor.getDocument())).toEqual(before);
    });

    it('survive saving and loading', () => {
        const { add, editor } = hallEditor();
        add('V1');

        const loaded = fromJSON(toJSON(editor.getDocument()));

        expect(loaded.ok && loaded.doc.levels[0]!.viewpoints).toEqual([entrance]);
    });

    it('a broken Viewpoint rejects the plan, and loading with repair drops only it', () => {
        const { add, editor } = hallEditor();
        add('V1');
        const json = JSON.parse(toJSON(editor.getDocument()));
        json.levels[0].viewpoints.push({ ...entrance, id: 'V2', tilt: 120 });

        expect(fromJSON(json)).toEqual({
            ok: false,
            errors: [{ code: 'invalid-viewpoint', id: 'V2' }],
        });
        const repaired = fromJSON(json, { repair: true });
        expect(repaired.ok && repaired.doc.levels[0]!.viewpoints!.map((v) => v.id)).toEqual(['V1']);
    });
});

const close = (actual: number[], expected: number[]) =>
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!));
const at = (bearing: number, tilt: number): Viewpoint => ({
    id: 'V',
    target: [10, 10],
    bearing,
    tilt,
    distance: 20,
});

describe('viewpointSpot', () => {
    it('stands south of a target it looks north at, as far as its distance across the floor', () => {
        // 30° from straight down: across the floor is 20 · sin 30° = 10 m.
        close(viewpointSpot(at(0, 30)), [10, 0]);
    });

    it('stands west of a target it looks east at; straight down, above the target', () => {
        close(viewpointSpot(at(90, 90)), [-10, 10]);
        close(viewpointSpot(at(0, 0)), [10, 10]);
    });
});
