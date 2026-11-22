import {
    createEditor,
    createSpace,
    type Command,
    type Connection,
    type Ring,
} from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    buildNavMesh,
    findRoute,
    findSpaceRoute,
    RIDE_SECONDS,
    WALKING_SPEED,
    type LevelPoint,
    type NavMesh,
} from './index.ts';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

/**
 * A 30 × 20 m building: Ground and Gallery above it, with stairs in the south-west corner, a lift
 * in the north-east one and, by the south wall, an escalator that only goes up.
 */
function building(...more: ((ids: { G: string }) => Command)[]) {
    const editor = createEditor(createSpace({ name: 'Mall', kind: 'mall', size: [30, 20] }));
    const G = editor.getDocument().levels[0]!.id;
    const connection = (id: string, kind: Connection['kind'], ring: Ring, bidirectional = true) =>
        ({
            type: 'connection.add',
            connection: {
                id,
                kind,
                ...(kind === 'elevator' && { accessible: true }),
                stops: [G, 'gallery'].map((levelId) => ({ levelId, shape: { outer: ring } })),
                bidirectional,
            },
        }) satisfies Command;
    const commands: Command[] = [
        { type: 'level.add', id: 'gallery', name: 'Gallery' },
        connection('stairs', 'stairs', rect(2, 2, 2, 2)),
        connection('lift', 'elevator', rect(26, 16, 2, 2)),
        connection('up', 'escalator', rect(14, 2, 2, 2), false),
        ...more.map((m) => m({ G })),
    ];
    for (const command of commands) {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    const doc = editor.getDocument();
    const meshes = new Map<string, NavMesh>();
    const meshOf = (levelId: string) => {
        if (!meshes.has(levelId)) meshes.set(levelId, buildNavMesh(doc, levelId));
        return meshes.get(levelId)!;
    };
    const go = (from: LevelPoint, to: LevelPoint, stepFree = false) =>
        findSpaceRoute(doc, from, to, meshOf, { stepFree });
    const height = Math.abs(
        doc.levels.find((l) => l.id === 'gallery')!.elevation -
            doc.levels.find((l) => l.id === G)!.elevation,
    );
    return { doc, G, go, meshOf, height };
}

const rides = (route: ReturnType<ReturnType<typeof building>['go']>) =>
    route?.legs.flatMap((leg) => (leg.ride ? [leg.ride.connectionId] : [])) ?? null;

describe('findSpaceRoute', () => {
    it('on one Level is the walk there, taking no Connection', () => {
        const { G, go, meshOf } = building();
        const route = go({ levelId: G, point: [6, 10] }, { levelId: G, point: [24, 10] })!;
        const walk = findRoute(meshOf(G), [6, 10], [24, 10])!;
        expect(route.legs).toEqual([{ levelId: G, points: walk.points, length: walk.length }]);
        expect(route.length).toBeCloseTo(walk.length);
        expect(route.seconds).toBeCloseTo(walk.length / WALKING_SPEED);
        expect(route.to).toEqual({ levelId: G, point: [24, 10] });
    });

    it('takes the stairs nearby to the floor above: a leg on each Level', () => {
        const { G, go, height } = building();
        const route = go({ levelId: G, point: [6, 3] }, { levelId: 'gallery', point: [6, 6] })!;
        expect(route.legs.map((l) => l.levelId)).toEqual([G, 'gallery']);
        expect(route.legs[0]!.ride).toEqual({
            connectionId: 'stairs',
            kind: 'stairs',
            toLevelId: 'gallery',
            up: true,
            seconds: RIDE_SECONDS.stairs(height),
        });
        expect(route.legs[1]!.ride).toBeUndefined();
        // Each leg walks from the floor beside the stairs, which stand at 2–4 m.
        const end = route.legs[0]!.points.at(-1)!;
        const start = route.legs[1]!.points[0]!;
        for (const p of [end, start]) expect(Math.hypot(p[0] - 3, p[1] - 3)).toBeLessThan(1.6);
        const walked = route.legs[0]!.length + route.legs[1]!.length;
        expect(route.length).toBeCloseTo(walked);
        expect(route.seconds).toBeCloseTo(walked / WALKING_SPEED + RIDE_SECONDS.stairs(height));
    });

    it('takes the lift beside Here rather than walking across to the escalator', () => {
        const { G, go } = building();
        const route = go({ levelId: G, point: [25, 17] }, { levelId: 'gallery', point: [25, 17] });
        expect(rides(route)).toEqual(['lift']);
    });

    it('goes up a one-way escalator, but not down it', () => {
        const { G, go } = building();
        const up = go({ levelId: G, point: [15, 6] }, { levelId: 'gallery', point: [15, 6] })!;
        expect(rides(up)).toEqual(['up']);
        expect(up.legs[0]!.ride!.up).toBe(true);
        const down = go({ levelId: 'gallery', point: [15, 6] }, { levelId: G, point: [15, 6] })!;
        expect(rides(down)).not.toContain('up');
        expect(down.legs[0]!.ride!.up).toBe(false);
    });

    it('ends a route to a booth upstairs at its edge', () => {
        const { G, go } = building(() => ({
            type: 'zone.add',
            levelId: 'gallery',
            zone: { id: 'b', shape: { outer: rect(18, 4, 3, 3) }, walkAround: true },
        }));
        const route = go(
            { levelId: G, point: [6, 3] },
            { levelId: 'gallery', point: [19.5, 5.5] },
        )!;
        expect(route.to.levelId).toBe('gallery');
        const [x, y] = route.to.point;
        expect(x < 18 || x > 21 || y < 4 || y > 7).toBe(true);
    });

    it('is null when no Connection reaches the place, or the Level does not exist', () => {
        const { G, go } = building(() => ({ type: 'level.add', id: 'roof', name: 'Roof' }));
        expect(go({ levelId: G, point: [6, 3] }, { levelId: 'roof', point: [6, 3] })).toBeNull();
        expect(go({ levelId: G, point: [6, 3] }, { levelId: 'nowhere', point: [6, 3] })).toBeNull();
    });

    it('asks only for the meshes of Levels it needs', () => {
        const { doc, G } = building(() => ({ type: 'level.add', id: 'roof', name: 'Roof' }));
        const asked = new Set<string>();
        findSpaceRoute(doc, { levelId: G, point: [6, 3] }, { levelId: G, point: [20, 3] }, (id) => {
            asked.add(id);
            return buildNavMesh(doc, id);
        });
        expect(asked.has('roof')).toBe(false);
    });

    it('step-free, takes the accessible lift instead of the stairs beside Here', () => {
        const { G, go } = building();
        const from = { levelId: G, point: [6, 3] as [number, number] };
        const to = { levelId: 'gallery', point: [6, 6] as [number, number] };
        expect(rides(go(from, to))).toEqual(['stairs']);
        const stepFree = go(from, to, true)!;
        expect(rides(stepFree)).toEqual(['lift']);
        expect(stepFree.to).toEqual(to);
    });

    it('step-free, is null when no accessible Connection reaches the place; one Level needs none', () => {
        const { G, go } = building(() => ({
            type: 'connection.update',
            connectionId: 'lift',
            changes: { accessible: undefined },
        }));
        const from = { levelId: G, point: [6, 3] as [number, number] };
        expect(go(from, { levelId: 'gallery', point: [6, 6] }, true)).toBeNull();
        expect(go(from, { levelId: G, point: [20, 6] }, true)).not.toBeNull();
    });

    describe('to a place outside the building', () => {
        /** Outer Walls along the south and north sides, with an Opening in each where asked. */
        const walled = (south: number | null, north: number | null, kind = 'entrance') =>
            building(
                ...(
                    [
                        ['S', [0, 0], [30, 0], south],
                        ['N', [0, 20], [30, 20], north],
                    ] as const
                ).flatMap(([id, a, b, offset]) => [
                    ({ G }: { G: string }): Command => ({
                        type: 'wall.add',
                        levelId: G,
                        id,
                        a: [...a],
                        b: [...b],
                        thickness: 0.2,
                    }),
                    ...(offset === null
                        ? []
                        : [
                              ({ G }: { G: string }): Command => ({
                                  type: 'opening.add',
                                  levelId: G,
                                  opening: {
                                      id: `${id}-door`,
                                      kind: kind as 'entrance',
                                      width: 1.6,
                                      host: 'wall',
                                      wallId: id,
                                      offset,
                                  },
                              }),
                          ]),
                ]),
            );
        const inDoorway = (p: [number, number], x: number, y: number) =>
            expect(Math.hypot(p[0] - x, p[1] - y)).toBeLessThan(0.5);

        it('ends in the doorway leading out, not at the Wall nearest the place', () => {
            const { G, go } = walled(25, null);
            const route = go({ levelId: G, point: [6, 10] }, { levelId: G, point: [10, -3] })!;
            inDoorway(route.to.point, 25, 0);
            expect(route.legs[0]!.points.at(-1)).toEqual(route.to.point);
            expect(route.outside).toMatchObject({ levelId: G, point: [10, -3] });
            expect(route.outside!.way.at(-1)).toEqual([10, -3]);
            // The way on outside is neither drawn nor counted.
            expect(route.seconds).toBeCloseTo(route.length / WALKING_SPEED);
        });

        it('takes the door with the shortest way on to the place', () => {
            const { G, go } = walled(25, 5);
            const south = go({ levelId: G, point: [6, 18] }, { levelId: G, point: [24, -5] })!;
            inDoorway(south.to.point, 25, 0);
            const north = go({ levelId: G, point: [25, 2] }, { levelId: G, point: [6, 23] })!;
            inDoorway(north.to.point, 5, 20);
        });

        it('chooses the door by the way round the building, not straight through it', () => {
            // North of the hall: the south door is nearer in a straight line, through the building;
            // round it, the north door is nearer.
            const { G, go } = walled(25, 5);
            const route = go({ levelId: G, point: [20, 2] }, { levelId: G, point: [20, 23] })!;
            inDoorway(route.to.point, 5, 20);
            expect(route.outside!.way).toEqual([
                [5, 20],
                [5, 21.1],
                [20, 23],
            ]);
            // With only the south door, the way on goes round the east end, 1 m off the corners.
            const south = walled(25, null);
            const round = south.go(
                { levelId: south.G, point: [20, 2] },
                { levelId: south.G, point: [20, 23] },
            )!;
            inDoorway(round.to.point, 25, 0);
            expect(round.outside!.way).toEqual([
                [25, 0],
                [25, -1.1],
                [30, -1],
                [31, 0],
                [31, 20],
                [30, 21],
                [20, 23],
            ]);
        });

        it('does not send visitors out by an emergency exit: with no other way out, there is no route', () => {
            const { G, go } = walled(25, null, 'emergency-exit');
            expect(go({ levelId: G, point: [6, 10] }, { levelId: G, point: [10, -3] })).toBeNull();
        });

        it('from a place tapped outside an upper Level, goes down and out by the door', () => {
            const { G, go } = walled(25, null);
            const route = go(
                { levelId: 'gallery', point: [6, 10] },
                { levelId: 'gallery', point: [10, -3] },
            )!;
            expect(route.legs.map((l) => l.levelId)).toEqual(['gallery', G]);
            inDoorway(route.to.point, 25, 0);
            expect(route.to.levelId).toBe(G);
            expect(route.outside).toMatchObject({ levelId: G, point: [10, -3] });
        });

        it('beside a smaller gallery, goes to the spot on the floor below instead', () => {
            const { G, go } = building(() => ({
                type: 'level.setOutline',
                levelId: 'gallery',
                outline: { outer: rect(0, 10, 30, 10) },
            }));
            const route = go(
                { levelId: 'gallery', point: [10, 15] },
                { levelId: 'gallery', point: [10, 5] },
            )!;
            expect(route.to).toEqual({ levelId: G, point: [10, 5] });
            expect(route.outside).toBeUndefined();
        });

        it('walks to a place inside the building as before, doors or not', () => {
            const { G, go } = walled(25, 5);
            const route = go({ levelId: G, point: [6, 10] }, { levelId: G, point: [20, 10] })!;
            expect(route.to.point).toEqual([20, 10]);
            expect(route.outside).toBeUndefined();
        });
    });
});
