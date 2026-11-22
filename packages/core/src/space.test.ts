import { describe, expect, it } from 'vitest';
import { createEditor, createSpace } from './index.ts';

const hall = () =>
    createEditor(createSpace({ name: 'Hall A', kind: 'exhibition', size: [20, 10] }));

describe('space.update', () => {
    it('renames the Space and sets host meta, as one undoable step', () => {
        const editor = hall();
        const before = editor.getDocument();

        const result = editor.exec({
            type: 'space.update',
            changes: { name: 'Hall B', meta: { booking: { pricePerSqm: 300 } } },
        });

        expect(result.ok).toBe(true);
        const doc = editor.getDocument();
        expect(doc.name).toBe('Hall B');
        expect(doc.meta).toEqual({ booking: { pricePerSqm: 300 } });
        expect(doc.levels).toBe(before.levels);
        editor.undo();
        expect(editor.getDocument()).toBe(before);
    });

    it('clears an optional property set to undefined', () => {
        const editor = hall();
        editor.exec({ type: 'space.update', changes: { meta: { a: 1 } } });

        editor.exec({ type: 'space.update', changes: { meta: undefined } });

        expect(editor.getDocument()).not.toHaveProperty('meta');
    });

    it('rejects a Grid Step that is not positive', () => {
        const editor = hall();

        const result = editor.exec({
            type: 'space.update',
            changes: { grid: { step: 0, snap: true } },
        });

        expect(result).toMatchObject({ ok: false, errors: [{ code: 'invalid-grid' }] });
    });
});
