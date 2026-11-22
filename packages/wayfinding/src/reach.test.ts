import { createEditor, createSpace, type Command, type Ring, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { unreachableZones } from './index.ts';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/** A 20 × 10 m hall built from `commands`; returns the ids of the Zones nobody can reach. */
function unreachable(...commands: ((levelId: string) => Command)[]) {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] }));
    const levelId = editor.getDocument().levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(levelId));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return unreachableZones(editor.getDocument()).map((d) => d.ref.id);
}

const wall =
    (id: string, a: Vec2, b: Vec2) =>
    (levelId: string): Command => ({
        type: 'wall.add',
        levelId,
        id,
        a,
        b,
        thickness: 0.15,
    });
const opening =
    (wallId: string, offset: number, kind: 'door' | 'entrance' | 'emergency-exit' = 'door') =>
    (levelId: string): Command => ({
        type: 'opening.add',
        levelId,
        opening: { id: `${wallId}-${kind}`, kind, width: 1, host: 'wall', wallId, offset },
    });
const zone =
    (id: string, ring: Ring, walkAround = false) =>
    (levelId: string): Command => ({
        type: 'zone.add',
        levelId,
        zone: { id, shape: { outer: ring }, ...(walkAround && { walkAround }) },
    });

/** Outer Walls round the hall, with an entrance in the south one. */
const building = [
    wall('S', [0, 0], [20, 0]),
    wall('E', [20, 0], [20, 10]),
    wall('N', [20, 10], [0, 10]),
    wall('W', [0, 10], [0, 0]),
    opening('S', 10, 'entrance'),
];
/** A room in the north-west corner: Walls at x = 6 and y = 6. */
const room = [
    wall('RS', [0, 6], [6, 6]),
    wall('RE', [6, 6], [6, 10]),
    zone('room', rect(0, 6, 6, 4)),
];

describe('unreachableZones', () => {
    it('finds nothing on an open floor', () => {
        expect(
            unreachable(zone('a', rect(2, 2, 3, 3)), zone('b', rect(10, 2, 3, 3), true)),
        ).toEqual([]);
    });

    it('finds a room with no door, and not one with a door', () => {
        expect(unreachable(...building, ...room)).toEqual(['room']);
        expect(unreachable(...building, ...room, opening('RS', 3))).toEqual([]);
    });

    it('counts a door to the outside as a way in, but not an emergency exit', () => {
        // The room's only door leads outside through the north Wall.
        expect(unreachable(...building, ...room, opening('N', 17))).toEqual([]);
        expect(unreachable(...building, ...room, opening('N', 17, 'emergency-exit'))).toEqual([
            'room',
        ]);
    });

    it('finds a booth boxed in by others, not the booths around it', () => {
        const booths = [];
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                booths.push(zone(`b${i}${j}`, rect(8 + 2 * i, 3 + 2 * j, 2, 2), true));
        expect(unreachable(...building, ...booths)).toEqual(['b11']);
    });

    it('takes the largest piece of floor when a Level has no way in', () => {
        // Walls all round with no entrance; the room is sealed off from the rest.
        expect(unreachable(...building.slice(0, 4), ...room)).toEqual(['room']);
    });

    it('counts stairs as a way in on a Level above', () => {
        expect(
            unreachable(
                () => ({ type: 'level.add', id: 'L2', name: 'Level 2' }),
                (levelId) => ({
                    type: 'connection.add',
                    connection: {
                        id: 'stairs',
                        kind: 'stairs',
                        bidirectional: true,
                        stops: [
                            { levelId, shape: { outer: rect(1, 7, 2, 2) } },
                            { levelId: 'L2', shape: { outer: rect(1, 7, 2, 2) } },
                        ],
                    },
                }),
                // On Level 2, a wall cuts off the stairs' corner with a room; the bigger rest is sealed.
                wall('X', [6, 0], [6, 10]),
                () => ({
                    type: 'wall.add',
                    levelId: 'L2',
                    id: 'X2',
                    a: [6, 0],
                    b: [6, 10],
                    thickness: 0.15,
                }),
                () => ({
                    type: 'zone.add',
                    levelId: 'L2',
                    zone: { id: 'far', shape: { outer: rect(10, 2, 4, 4) } },
                }),
                () => ({
                    type: 'zone.add',
                    levelId: 'L2',
                    zone: { id: 'near', shape: { outer: rect(1, 1, 3, 3) } },
                }),
            ),
        ).toEqual(['far']);
    });
});
