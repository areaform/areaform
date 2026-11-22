import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, type Ring } from './index.ts';

function expoEditor() {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const level = () => editor.getDocument().levels[0]!;
    const zone = (id: string) => level().zones.find((z) => z.id === id);
    return { editor, levelId, level, zone };
}

const square: Ring = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
];
const bowTie: Ring = [
    [0, 0],
    [3, 3],
    [3, 0],
    [0, 3],
];

describe('zone.add', () => {
    it('adds a Zone with its label, category and client data', () => {
        const { editor, levelId, zone } = expoEditor();

        const result = editor.exec({
            type: 'zone.add',
            levelId,
            zone: {
                id: 'A-12',
                shape: { outer: square },
                label: 'A-12',
                category: 'booth',
                data: { exhibitor: 'Acme' },
            },
        });

        expect(result.ok).toBe(true);
        expect(zone('A-12')).toEqual({
            id: 'A-12',
            shape: { outer: square },
            label: 'A-12',
            category: 'booth',
            data: { exhibitor: 'Acme' },
        });
    });

    it('normalises winding: outer ring counter-clockwise, holes clockwise', () => {
        const { editor, levelId, zone } = expoEditor();
        const clockwise: Ring = [
            [0, 0],
            [0, 10],
            [10, 10],
            [10, 0],
        ];
        const counterClockwiseHole: Ring = [
            [4, 4],
            [6, 4],
            [6, 6],
            [4, 6],
        ];

        editor.exec({
            type: 'zone.add',
            levelId,
            zone: { id: 'Z', shape: { outer: clockwise, holes: [counterClockwiseHole] } },
        });

        expect(zone('Z')?.shape).toEqual({
            outer: [
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
            ],
            holes: [
                [
                    [4, 6],
                    [6, 6],
                    [6, 4],
                    [4, 4],
                ],
            ],
        });
    });

    it.each([
        ['self-intersecting', bowTie],
        ['too few points', square.slice(0, 2)],
        [
            'zero area',
            [
                [0, 0],
                [1, 0],
                [2, 0],
            ] as Ring,
        ],
        [
            'non-finite coordinates',
            [
                [0, 0],
                [Number.NaN, 0],
                [1, 1],
            ] as Ring,
        ],
    ])('rejects a Zone whose ring is invalid (%s)', (_, ring) => {
        const { editor, levelId, level } = expoEditor();

        const result = editor.exec({
            type: 'zone.add',
            levelId,
            zone: { id: 'Z', shape: { outer: ring } },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'invalid-shape', id: 'Z' }] });
        expect(level().zones).toEqual([]);
    });
});

describe('zone.update and zone.delete', () => {
    it('changes only the given properties, and can clear optional ones', () => {
        const { editor, levelId, zone } = expoEditor();
        editor.exec({
            type: 'zone.add',
            levelId,
            zone: { id: 'Z', shape: { outer: square }, label: 'Old', category: 'booth' },
        });

        editor.exec({
            type: 'zone.update',
            levelId,
            zoneId: 'Z',
            changes: { label: 'New', restricted: true, walkAround: true, category: undefined },
        });

        expect(zone('Z')).toEqual({
            id: 'Z',
            shape: { outer: square },
            label: 'New',
            restricted: true,
            walkAround: true,
        });
    });

    it('validates a changed shape', () => {
        const { editor, levelId } = expoEditor();
        editor.exec({ type: 'zone.add', levelId, zone: { id: 'Z', shape: { outer: square } } });

        const result = editor.exec({
            type: 'zone.update',
            levelId,
            zoneId: 'Z',
            changes: { shape: { outer: bowTie } },
        });

        expect(result.ok).toBe(false);
    });

    it('deletes a Zone', () => {
        const { editor, levelId, level } = expoEditor();
        editor.exec({ type: 'zone.add', levelId, zone: { id: 'Z', shape: { outer: square } } });

        editor.exec({ type: 'zone.delete', levelId, zoneId: 'Z' });

        expect(level().zones).toEqual([]);
    });

    it('rejects updating or deleting an unknown Zone', () => {
        const { editor, levelId } = expoEditor();

        expect(editor.exec({ type: 'zone.delete', levelId, zoneId: 'ghost' })).toEqual({
            ok: false,
            errors: [{ code: 'unknown-element', id: 'ghost' }],
        });
        expect(
            editor.exec({ type: 'zone.update', levelId, zoneId: 'ghost', changes: { label: 'x' } })
                .ok,
        ).toBe(false);
    });
});

describe('level.setOutline', () => {
    it('replaces the Outline, normalising its winding', () => {
        const { editor, levelId, level } = expoEditor();
        const lShapeClockwise: Ring = [
            [0, 0],
            [0, 20],
            [10, 20],
            [10, 10],
            [30, 10],
            [30, 0],
        ];

        editor.exec({ type: 'level.setOutline', levelId, outline: { outer: lShapeClockwise } });

        expect(level().outline.outer).toEqual([...lShapeClockwise].reverse());
    });

    it('rejects a self-intersecting Outline', () => {
        const { editor, levelId } = expoEditor();

        const result = editor.exec({
            type: 'level.setOutline',
            levelId,
            outline: { outer: bowTie },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'invalid-shape', id: levelId }] });
    });
});
