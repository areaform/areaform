import { createEditor, createSpace, type Command, type Level, type Ring } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { score } from './score.ts';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/** A 20 × 10 m hall built through Commands; `levelId` is fixed so Commands can name it. */
function hall(commands: (levelId: string) => Command[]): Level {
    const doc = createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    for (const command of commands(levelId)) {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return editor.getDocument().levels[0]!;
}

const original = hall((levelId) => [
    { type: 'walls.fromOutline', levelId, thickness: 0.3 },
    {
        type: 'zone.add',
        levelId,
        zone: { id: 'A', label: 'A1', category: 'booth', shape: { outer: rect(2, 2, 3, 3) } },
    },
    {
        type: 'zone.add',
        levelId,
        zone: { id: 'B', label: 'A2', category: 'booth', shape: { outer: rect(5, 2, 3, 3) } },
    },
    {
        type: 'zone.add',
        levelId,
        zone: {
            id: 'L',
            label: 'Lane',
            category: 'aisle',
            restricted: true,
            shape: { outer: rect(0.5, 6, 19, 2) },
        },
    },
    {
        type: 'obstacle.add',
        levelId,
        obstacle: { id: 'C', kind: 'column', shape: { outer: rect(10, 3, 0.5, 0.5) } },
    },
]);

function withDoor(
    level: Level,
    kind: 'entrance' | 'emergency-exit',
    offset: number,
    width: number,
): Command {
    // The south wall runs from [0, 0] east; `walls.fromOutline` starts it at the first corner.
    const south = level.walls.find((w) => {
        const a = level.wallNodes.find((n) => n.id === w.a)!.position;
        const b = level.wallNodes.find((n) => n.id === w.b)!.position;
        return a[1] === 0 && b[1] === 0;
    })!;
    return {
        type: 'opening.add',
        levelId: level.id,
        opening: { kind, width, host: 'wall', wallId: south.id, offset },
    };
}

describe('score', () => {
    it('gives a perfect score to the plan itself', () => {
        const s = score(original, original);
        expect(s.zones).toEqual({
            expected: 3,
            found: 3,
            matched: 3,
            missing: [],
            extra: 0,
            meanIoU: 1,
            sameCategory: 3,
            sameLabel: 3,
            sameRestricted: 3,
        });
        expect(s.zoneAreaIoU).toBe(1);
        expect(s.walls.foundLength).toBe(s.walls.expectedLength);
        expect(s.obstacles).toEqual({ expected: 1, found: 1, matched: 1 });
    });

    it('matches Zones by place, whatever their ids, and grades how well they fit', () => {
        const imported = hall((levelId) => [
            // A1 half a metre off; A2 missing; the lane found but not marked restricted; a stray Zone.
            {
                type: 'zone.add',
                levelId,
                zone: {
                    id: 'z1',
                    label: 'A1',
                    category: 'booth',
                    shape: { outer: rect(2.5, 2, 3, 3) },
                },
            },
            {
                type: 'zone.add',
                levelId,
                zone: {
                    id: 'z2',
                    label: 'Lane',
                    category: 'aisle',
                    shape: { outer: rect(0.5, 6, 19, 2) },
                },
            },
            {
                type: 'zone.add',
                levelId,
                zone: {
                    id: 'z3',
                    label: 'Bar',
                    category: 'booth',
                    shape: { outer: rect(14, 1, 2, 2) },
                },
            },
        ]);
        const { zones } = score(original, imported);
        expect(zones).toMatchObject({
            matched: 2,
            missing: ['A2'],
            extra: 1,
            sameLabel: 2,
            sameRestricted: 1,
        });
        // 2.5 × 3 shared over 3.5 × 3 covered.
        expect(zones.meanIoU).toBeCloseTo((2.5 / 3.5 + 1) / 2, 2);
    });

    it('does not count a Zone that overlaps too little', () => {
        const imported = hall((levelId) => [
            { type: 'zone.add', levelId, zone: { id: 'z', shape: { outer: rect(4, 2, 3, 3) } } },
        ]);
        // Overlaps A1 by 1 m and A2 by 2 m: IoU 0.5 with A2 only.
        expect(score(original, imported).zones.matched).toBe(1);
        expect(score(original, imported).zones.missing).toEqual(['A1', 'Lane']);
    });

    it('matches Openings by their centre and compares kind and width', () => {
        const expected = { ...original, openings: [] };
        const level = hall((levelId) => [{ type: 'walls.fromOutline', levelId, thickness: 0.3 }]);
        const doors = (
            specs: [kind: 'entrance' | 'emergency-exit', offset: number, width: number][],
        ) => {
            const editor = createEditor({
                ...createSpace({ name: 'x', kind: 'exhibition', size: [1, 1] }),
                levels: [level],
            });
            for (const [kind, offset, width] of specs)
                editor.exec(withDoor(level, kind, offset, width));
            return editor.getDocument().levels[0]!;
        };
        const want = doors([
            ['entrance', 4, 3],
            ['emergency-exit', 14, 1.2],
        ]);
        const got = doors([
            ['entrance', 4.2, 2.6],
            ['entrance', 14, 1.2],
            ['entrance', 18, 1],
        ]);
        expect(score({ ...expected, ...want }, got).openings).toEqual({
            expected: 2,
            found: 3,
            matched: 2,
            sameKind: 1,
            meanWidthError: expect.closeTo(0.2, 5),
        });
    });

    it('compares the plans with their Outlines lined up, wherever the origin is', () => {
        const moved = hall((levelId) => [
            {
                type: 'level.setOutline',
                levelId,
                outline: { outer: rect(3, 3, 20, 10) },
            },
            {
                type: 'zone.add',
                levelId,
                zone: {
                    id: 'z',
                    label: 'A1',
                    category: 'booth',
                    shape: { outer: rect(5, 5, 3, 3) },
                },
            },
        ]);
        const s = score(original, moved);
        expect(s.offset).toEqual([-3, -3]);
        expect(s.zones).toMatchObject({ matched: 1, meanIoU: 1, sameLabel: 1 });
    });

    it('adds up Wall lengths', () => {
        const bare = hall(() => []);
        const s = score(original, bare);
        expect(s.walls).toEqual({ expectedLength: 60, foundLength: 0 });
    });
});
