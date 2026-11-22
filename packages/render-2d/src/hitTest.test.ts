import { createEditor, createSpace, type Command, type Ring, type Underlay } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { hitTest } from './index.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

/**
 * Ground Level `G` of an expo: a hall Zone with a booth on top, a Wall along y = 10 with a door
 * at x = 5, a column at (20, 5), and an elevator Stop at (30, 5).
 */
function expo() {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const G = doc.levels[0]!.id;
    const commands: Command[] = [
        { type: 'zone.add', levelId: G, zone: { id: 'HALL', shape: { outer: square(0, 0, 40) } } },
        { type: 'zone.add', levelId: G, zone: { id: 'BOOTH', shape: { outer: square(1, 1, 3) } } },
        { type: 'wall.add', levelId: G, id: 'W', a: [0, 10], b: [12, 10], thickness: 0.2 },
        {
            type: 'opening.add',
            levelId: G,
            opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 5 },
        },
        {
            type: 'obstacle.add',
            levelId: G,
            obstacle: { id: 'COL', kind: 'column', shape: { outer: square(20, 5, 1) } },
        },
        { type: 'level.add', id: 'L2', name: 'Gallery' },
        {
            type: 'connection.add',
            connection: {
                id: 'LIFT',
                kind: 'elevator',
                stops: [G, 'L2'].map((levelId) => ({
                    levelId,
                    shape: { outer: square(30, 5, 2) },
                })),
                bidirectional: true,
            },
        },
    ];
    for (const command of commands) {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    const nodeAt = (x: number, y: number) =>
        editor
            .getDocument()
            .levels[0]!.wallNodes.find((n) => n.position[0] === x && n.position[1] === y)!.id;
    return { doc: editor.getDocument(), G, nodeAt };
}

const tolerance = 0.25;

describe('hitTest', () => {
    it('picks an Opening over the Wall that hosts it', () => {
        const { doc, G } = expo();

        expect(hitTest(doc, G, [5.2, 10.05], tolerance)).toEqual({
            kind: 'opening',
            id: 'D',
            levelId: G,
        });
    });

    it('picks a Wall Node over the Walls that meet there', () => {
        const { doc, G, nodeAt } = expo();

        expect(hitTest(doc, G, [12.1, 10.1], tolerance)).toEqual({
            kind: 'wallNode',
            id: nodeAt(12, 10),
            levelId: G,
        });
    });

    it('picks a Wall within half its thickness plus the tolerance', () => {
        const { doc, G } = expo();

        expect(hitTest(doc, G, [8, 10.3], tolerance)).toEqual({
            kind: 'wall',
            id: 'W',
            levelId: G,
        });
        expect(hitTest(doc, G, [8, 10.4], tolerance)).toEqual({
            kind: 'zone',
            id: 'HALL',
            levelId: G,
        });
    });

    it('picks a Stop or an Obstacle over the Zone beneath', () => {
        const { doc, G } = expo();

        expect(hitTest(doc, G, [31, 6], tolerance)).toEqual({
            kind: 'stop',
            id: 'LIFT',
            levelId: G,
        });
        expect(hitTest(doc, G, [20.5, 5.5], tolerance)).toEqual({
            kind: 'obstacle',
            id: 'COL',
            levelId: G,
        });
    });

    it('picks the topmost Zone', () => {
        const { doc, G } = expo();

        expect(hitTest(doc, G, [2, 2], tolerance)).toEqual({
            kind: 'zone',
            id: 'BOOTH',
            levelId: G,
        });
    });

    it('returns null where there is nothing but background', () => {
        const { doc, G } = expo();

        expect(hitTest(doc, G, [100, 100], tolerance)).toBeNull();
        expect(hitTest(doc, 'L2', [10, 10], tolerance)).toBeNull();
    });

    describe('Underlays', () => {
        /** A 10 × 10 m scan on the Gallery, covering x 0–10, y 10–20, with a Zone on part of it. */
        function scanned(overrides: Partial<Underlay> = {}) {
            const editor = createEditor(expo().doc);
            editor.exec({
                type: 'underlay.add',
                levelId: 'L2',
                underlay: {
                    id: 'SCAN',
                    src: 'scan.png',
                    position: [0, 20],
                    scale: 0.01,
                    rotation: 0,
                    opacity: 0.5,
                    locked: false,
                    size: [1000, 1000],
                    ...overrides,
                },
            });
            editor.exec({
                type: 'zone.add',
                levelId: 'L2',
                zone: { id: 'ROOM', shape: { outer: square(1, 11, 2) } },
            });
            return editor.getDocument();
        }

        it('picks an unlocked Underlay where nothing else is, and nothing outside the image', () => {
            const doc = scanned();

            expect(hitTest(doc, 'L2', [8, 18], tolerance)).toEqual({
                kind: 'underlay',
                id: 'SCAN',
                levelId: 'L2',
            });
            expect(hitTest(doc, 'L2', [2, 12], tolerance)?.kind).toBe('zone');
            expect(hitTest(doc, 'L2', [12, 18], tolerance)).toBeNull();
        });

        it('follows the rotation of the image', () => {
            // Turned a quarter clockwise about its top-left corner (0, 20): now x −10–0, y 10–20.
            const doc = scanned({ rotation: -Math.PI / 2 });

            expect(hitTest(doc, 'L2', [-5, 15], tolerance)?.kind).toBe('underlay');
            expect(hitTest(doc, 'L2', [5, 15], tolerance)).toBeNull();
        });

        it('never picks a locked Underlay, or one whose image size is unknown', () => {
            expect(hitTest(scanned({ locked: true }), 'L2', [8, 18], tolerance)).toBeNull();
            const editor = createEditor(scanned());
            editor.exec({
                type: 'underlay.update',
                levelId: 'L2',
                underlayId: 'SCAN',
                changes: { size: undefined },
            });
            const doc = editor.getDocument();
            expect(hitTest(doc, 'L2', [8, 18], tolerance)).toBeNull();
        });
    });
});
