import { createEditor, createSpace } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createLevelSync } from './sync.ts';

function setup() {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    editor.exec({ type: 'level.add', id: 'UP', name: 'Level 2' });
    const G = doc.levels[0]!.id;
    const built: string[] = [];
    const disposed: string[] = [];
    const sync = createLevelSync(
        (_doc, level) => {
            built.push(level.id);
            return level.id;
        },
        (id) => disposed.push(id),
    );
    return { editor, G, built, disposed, sync };
}

describe('createLevelSync', () => {
    it('rebuilds the shown Level only when it changed', () => {
        const { editor, G, built, sync } = setup();
        sync.show(editor.getDocument(), G);

        // An edit on another Level leaves the shown Level object as it was.
        editor.exec({ type: 'wall.add', levelId: 'UP', a: [0, 0], b: [5, 0], thickness: 0.2 });
        expect(sync.show(editor.getDocument(), G).rebuilt).toBe(false);

        editor.exec({ type: 'wall.add', levelId: G, a: [0, 0], b: [5, 0], thickness: 0.2 });
        expect(sync.show(editor.getDocument(), G).rebuilt).toBe(true);
        expect(built).toEqual([G, G]);
    });

    it('rebuilds when the Connections change, since Stops come from them', () => {
        const { editor, G, sync } = setup();
        sync.show(editor.getDocument(), G);

        editor.exec({
            type: 'connection.add',
            connection: {
                id: 'S',
                kind: 'stairs',
                bidirectional: true,
                stops: [G, 'UP'].map((levelId) => ({
                    levelId,
                    shape: {
                        outer: [
                            [1, 1],
                            [3, 1],
                            [3, 3],
                            [1, 3],
                        ],
                    },
                })),
            },
        });

        expect(sync.show(editor.getDocument(), G).rebuilt).toBe(true);
    });

    it('disposes what it built when another Level is shown or it is cleared', () => {
        const { editor, G, disposed, sync } = setup();
        sync.show(editor.getDocument(), G);
        sync.show(editor.getDocument(), 'UP');
        sync.clear();

        expect(disposed).toEqual([G, 'UP']);
    });

    it('shows nothing for a Level that is not there', () => {
        const { editor, sync } = setup();

        expect(sync.show(editor.getDocument(), 'missing')).toEqual({ built: null, rebuilt: true });
    });
});
