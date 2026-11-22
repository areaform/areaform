import { describe, expect, it } from 'vitest';
import { createEditor, createSpace, resolveOpening, type Ring } from './index.ts';

const booth: Ring = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
];

/** Level 1 of an office with a wall, a door on it, a Zone, an Obstacle and an elevator to Level 2. */
function furnishedEditor() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const L1 = doc.levels[0]!.id;
    editor.exec({ type: 'wall.add', levelId: L1, id: 'W1', a: [0, 5], b: [10, 5], thickness: 0.1 });
    editor.exec({
        type: 'opening.add',
        levelId: L1,
        opening: { id: 'D1', kind: 'door', width: 0.9, host: 'wall', wallId: 'W1', offset: 4 },
    });
    editor.exec({
        type: 'zone.add',
        levelId: L1,
        zone: { id: 'A-12', shape: { outer: booth }, label: 'A-12', data: { desk: 7 } },
    });
    editor.exec({
        type: 'obstacle.add',
        levelId: L1,
        obstacle: { id: 'COL', kind: 'column', shape: { outer: booth } },
    });
    editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
    editor.exec({
        type: 'connection.add',
        connection: {
            id: 'LIFT',
            kind: 'elevator',
            stops: [L1, 'L2'].map((levelId) => ({ levelId, shape: { outer: booth } })),
            bidirectional: true,
        },
    });
    return { editor, L1 };
}

describe('level.duplicate', () => {
    it('copies everything on the Level onto a new Level at the top of the stack', () => {
        const { editor, L1 } = furnishedEditor();

        const result = editor.exec({ type: 'level.duplicate', levelId: L1, id: 'L3' });

        expect(result.ok).toBe(true);
        const levels = editor.getDocument().levels;
        const [source, , copy] = levels;
        expect(copy).toMatchObject({ id: 'L3', name: 'Level 1 copy', ordinal: 2, elevation: 6 });
        expect(copy?.outline).toEqual(source?.outline);
        expect(copy?.walls).toHaveLength(1);
        expect(copy?.wallNodes).toHaveLength(2);
        expect(copy?.zones[0]).toMatchObject({ label: 'A-12', data: { desk: 7 } });
        expect(copy?.obstacles[0]?.kind).toBe('column');
    });

    it('gives every copied element a new id and keeps references inside the copy', () => {
        const { editor, L1 } = furnishedEditor();

        editor.exec({ type: 'level.duplicate', levelId: L1, id: 'L3' });

        const copy = editor.getDocument().levels[2]!;
        expect(copy.zones[0]?.id).not.toBe('A-12');
        expect(copy.walls[0]?.id).not.toBe('W1');
        const door = copy.openings[0]!;
        expect(door.host === 'wall' && door.wallId).toBe(copy.walls[0]?.id);
        expect(resolveOpening(copy, door)).toEqual({ position: [4, 5], angle: 0 });
    });

    it('does not extend Connections to the copy', () => {
        const { editor, L1 } = furnishedEditor();

        editor.exec({ type: 'level.duplicate', levelId: L1, id: 'L3' });

        const lift = editor.getDocument().connections[0]!;
        expect(lift.stops.map((s) => s.levelId)).not.toContain('L3');
    });

    it('accepts an explicit name', () => {
        const { editor, L1 } = furnishedEditor();

        editor.exec({ type: 'level.duplicate', levelId: L1, name: 'Level 3' });

        expect(editor.getDocument().levels[2]?.name).toBe('Level 3');
    });
});
