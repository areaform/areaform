import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, type Ring, type Stop } from '../index.ts';

const shaft: Ring = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
];
const stopOn = (levelId: string): Stop => ({ levelId, shape: { outer: shaft } });

/** Four Levels L0–L3, an elevator serving all of them, and stairs between L0 and L1. */
function towerEditor() {
    const doc = createSpace({ name: 'Tower', kind: 'office', size: [20, 20] });
    const editor = createEditor(doc);
    const L0 = doc.levels[0]!.id;
    for (const id of ['L1', 'L2', 'L3']) editor.exec({ type: 'level.add', id, name: id });
    editor.exec({
        type: 'connection.add',
        connection: {
            id: 'LIFT',
            kind: 'elevator',
            stops: [L0, 'L1', 'L2', 'L3'].map(stopOn),
            bidirectional: true,
        },
    });
    editor.exec({
        type: 'connection.add',
        connection: {
            id: 'STAIRS',
            kind: 'stairs',
            stops: [L0, 'L1'].map(stopOn),
            bidirectional: true,
        },
    });
    const connection = (id: string) => editor.getDocument().connections.find((c) => c.id === id);
    return { editor, L0, connection };
}

describe('connection.add', () => {
    it('adds a Connection that stops on several Levels', () => {
        const { connection } = towerEditor();

        expect(connection('LIFT')?.stops.map((s) => s.levelId)).toHaveLength(4);
        expect(connection('STAIRS')?.kind).toBe('stairs');
    });

    it('rejects a Connection with fewer than two Stops', () => {
        const { editor, L0 } = towerEditor();

        const result = editor.exec({
            type: 'connection.add',
            connection: { id: 'C', kind: 'ramp', stops: [stopOn(L0)], bidirectional: true },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'too-few-stops', id: 'C' }] });
    });

    it('rejects two Stops on the same Level', () => {
        const { editor, L0 } = towerEditor();

        const result = editor.exec({
            type: 'connection.add',
            connection: {
                id: 'C',
                kind: 'ramp',
                stops: [stopOn(L0), stopOn('L1'), stopOn(L0)],
                bidirectional: true,
            },
        });

        expect(result).toEqual({
            ok: false,
            errors: [{ code: 'duplicate-stop', id: 'C', levelId: L0 }],
        });
    });

    it('rejects a Stop on an unknown Level', () => {
        const { editor, L0 } = towerEditor();

        const result = editor.exec({
            type: 'connection.add',
            connection: {
                id: 'C',
                kind: 'ramp',
                stops: [stopOn(L0), stopOn('ghost')],
                bidirectional: true,
            },
        });

        expect(result).toEqual({
            ok: false,
            errors: [{ code: 'dangling-reference', id: 'C', ref: 'ghost' }],
        });
    });

    it('deletes a Connection', () => {
        const { editor, connection } = towerEditor();

        editor.exec({ type: 'connection.delete', connectionId: 'STAIRS' });

        expect(connection('STAIRS')).toBeUndefined();
    });
});

describe('level.delete', () => {
    it('removes its Stops and any Connection left with fewer than two', () => {
        const { editor, connection } = towerEditor();

        const result = editor.exec({ type: 'level.delete', levelId: 'L1' });

        expect(result.ok).toBe(true);
        expect(editor.getDocument().levels.map((l) => l.id)).not.toContain('L1');
        expect(connection('LIFT')?.stops.map((s) => s.levelId)).not.toContain('L1');
        expect(connection('LIFT')?.stops).toHaveLength(3);
        expect(connection('STAIRS')).toBeUndefined();
    });

    it('is undone in one step', () => {
        const { editor, connection } = towerEditor();
        const before = editor.getDocument();

        editor.exec({ type: 'level.delete', levelId: 'L1' });
        editor.undo();

        expect(editor.getDocument()).toBe(before);
        expect(connection('STAIRS')).toBeDefined();
    });

    it('refuses to delete the last Level', () => {
        const doc = createSpace({ name: 'Flat', kind: 'flat', size: [10, 8] });
        const editor = createEditor(doc);
        const only = doc.levels[0]!.id;

        expect(editor.exec({ type: 'level.delete', levelId: only })).toEqual({
            ok: false,
            errors: [{ code: 'no-levels' }],
        });
    });
});

describe('preview', () => {
    it('lists everything a Command would remove, without changing the Document', () => {
        const { editor } = towerEditor();
        editor.exec({
            type: 'zone.add',
            levelId: 'L1',
            zone: { id: 'Z1', shape: { outer: shaft } },
        });
        const before = editor.getDocument();
        let changes = 0;
        editor.on('change', () => changes++);

        const preview = editor.preview({ type: 'level.delete', levelId: 'L1' });

        expect(preview).toEqual({
            ok: true,
            removed: expect.arrayContaining([
                { kind: 'level', id: 'L1' },
                { kind: 'zone', id: 'Z1', levelId: 'L1' },
                { kind: 'connection', id: 'STAIRS' },
                { kind: 'stop', id: 'LIFT', levelId: 'L1' },
            ]),
        });
        expect(preview.ok && preview.removed).toHaveLength(4);
        expect(editor.getDocument()).toBe(before);
        expect(changes).toBe(0);
    });

    it('lists a Wall with its hosted Openings and orphaned Wall Nodes', () => {
        const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
        const editor = createEditor(doc);
        const levelId = doc.levels[0]!.id;
        editor.exec({ type: 'wall.add', levelId, id: 'W1', a: [0, 0], b: [10, 0], thickness: 0.2 });
        editor.exec({
            type: 'opening.add',
            levelId,
            opening: { id: 'D1', kind: 'door', width: 0.9, host: 'wall', wallId: 'W1', offset: 2 },
        });

        const preview = editor.preview({ type: 'wall.delete', levelId, wallId: 'W1' });

        const kinds = preview.ok ? preview.removed.map((r) => r.kind).sort() : [];
        expect(kinds).toEqual(['opening', 'wall', 'wallNode', 'wallNode']);
    });

    it('reports the errors of a Command that would be rejected', () => {
        const { editor } = towerEditor();

        expect(editor.preview({ type: 'connection.delete', connectionId: 'ghost' })).toEqual({
            ok: false,
            errors: [{ code: 'unknown-element', id: 'ghost' }],
        });
    });
});

describe('obstacles', () => {
    it('adds and deletes an Obstacle', () => {
        const { editor, L0 } = towerEditor();
        const obstacles = () => editor.getDocument().levels[0]!.obstacles;

        editor.exec({
            type: 'obstacle.add',
            levelId: L0,
            obstacle: { id: 'COL', kind: 'column', shape: { outer: shaft } },
        });
        expect(obstacles().map((o) => o.id)).toEqual(['COL']);

        editor.exec({ type: 'obstacle.delete', levelId: L0, obstacleId: 'COL' });
        expect(obstacles()).toEqual([]);
    });

    it('rejects an Obstacle with an invalid shape', () => {
        const { editor, L0 } = towerEditor();

        const result = editor.exec({
            type: 'obstacle.add',
            levelId: L0,
            obstacle: { id: 'COL', kind: 'column', shape: { outer: shaft.slice(0, 2) } },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'invalid-shape', id: 'COL' }] });
    });
});

describe('connection.update', () => {
    it('extends a Connection to another Level by replacing its Stops', () => {
        const { editor, L0, connection } = towerEditor();

        editor.exec({
            type: 'connection.update',
            connectionId: 'STAIRS',
            changes: { stops: [L0, 'L1', 'L2'].map(stopOn), name: 'Main stairs' },
        });

        expect(connection('STAIRS')?.stops.map((s) => s.levelId)).toEqual([L0, 'L1', 'L2']);
        expect(connection('STAIRS')?.name).toBe('Main stairs');
    });

    it('validates the updated Connection', () => {
        const { editor, L0 } = towerEditor();

        const result = editor.exec({
            type: 'connection.update',
            connectionId: 'STAIRS',
            changes: { stops: [stopOn(L0)] },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'too-few-stops', id: 'STAIRS' }] });
    });

    it('can clear an optional property', () => {
        const { editor, connection } = towerEditor();
        editor.exec({
            type: 'connection.update',
            connectionId: 'LIFT',
            changes: { accessible: true },
        });

        editor.exec({
            type: 'connection.update',
            connectionId: 'LIFT',
            changes: { accessible: undefined },
        });

        expect(connection('LIFT')).not.toHaveProperty('accessible');
    });
});

describe('obstacle.update', () => {
    it('changes an Obstacle kind and shape', () => {
        const { editor, L0 } = towerEditor();
        const obstacle = () => editor.getDocument().levels[0]!.obstacles[0];
        editor.exec({
            type: 'obstacle.add',
            levelId: L0,
            obstacle: { id: 'X', kind: 'other', shape: { outer: shaft } },
        });
        const bigger: Ring = [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
        ];

        editor.exec({
            type: 'obstacle.update',
            levelId: L0,
            obstacleId: 'X',
            changes: { kind: 'void', shape: { outer: bigger } },
        });

        expect(obstacle()).toEqual({ id: 'X', kind: 'void', shape: { outer: bigger } });
    });
});
