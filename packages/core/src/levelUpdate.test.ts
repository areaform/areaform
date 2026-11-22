import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    underlayToWorld,
    worldToUnderlay,
    type Underlay,
} from './index.ts';

describe('level.update', () => {
    it('changes a Level’s name, elevation, ceiling height and group', () => {
        const doc = createSpace({ name: 'Tower', kind: 'office', size: [20, 10] });
        const editor = createEditor(doc);
        const levelId = doc.levels[0]!.id;

        const result = editor.exec({
            type: 'level.update',
            levelId,
            changes: { name: 'Ground', elevation: -0.5, height: 4.2, group: 'Tower A' },
        });

        expect(result.ok).toBe(true);
        expect(editor.getDocument().levels[0]).toMatchObject({
            name: 'Ground',
            elevation: -0.5,
            height: 4.2,
            group: 'Tower A',
        });
    });

    it('rejects a non-positive ceiling height', () => {
        const doc = createSpace({ name: 'Tower', kind: 'office', size: [20, 10] });
        const editor = createEditor(doc);
        const levelId = doc.levels[0]!.id;

        expect(editor.exec({ type: 'level.update', levelId, changes: { height: 0 } })).toEqual({
            ok: false,
            errors: [{ code: 'invalid-level', id: levelId }],
        });
    });
});

describe('worldToUnderlay', () => {
    it('is the inverse of underlayToWorld', () => {
        const underlay: Underlay = {
            id: 'U',
            src: 'a.png',
            position: [5, 30],
            scale: 0.02,
            rotation: 0.3,
            opacity: 1,
            locked: false,
        };

        const pixel = worldToUnderlay(underlay, underlayToWorld(underlay, [120, 340]));

        expect(pixel[0]).toBeCloseTo(120);
        expect(pixel[1]).toBeCloseTo(340);
    });
});
