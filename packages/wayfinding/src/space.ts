// The way between Levels (ADR-0017, slice 2): every Level's navmesh joined at the Stops of its
// Connections, searched for the quickest way from Here to a place, which may be on another Level.
import type { AreaformDocument, Connection, Id, Level, Vec2 } from '@areaform/core';
import type { NavMesh } from './mesh.ts';
import { placeOf, type LevelPoint } from './place.ts';
import { snap } from './route.ts';
import { findRoute, type FoundRoute as FoundWalk } from './walk.ts';

export type { LevelPoint } from './place.ts';

/** How fast visitors walk, metres a second: the walking time of a route and the cost of a walk. */
export const WALKING_SPEED = 1.2;

/** A height used for each Level climbed when the Levels' elevations do not tell it, metres. */
const LEVEL_HEIGHT = 4;

/**
 * How long a ride takes, seconds, for a climb of `height` metres. A lift has a wait; stairs cost
 * per metre climbed; an escalator a little less; a ramp, at 1:12, the most.
 */
export const RIDE_SECONDS: Record<Connection['kind'], (height: number) => number> = {
    elevator: (h) => 30 + h / 1.5,
    escalator: (h) => 4 * h,
    stairs: (h) => 5 * h,
    ramp: (h) => 12 * h,
};

/** The Connection a part of the route ends at, and where it takes the visitor. */
export interface Ride {
    connectionId: Id;
    kind: Connection['kind'];
    /** The Level the visitor gets off at; the next leg starts there. */
    toLevelId: Id;
    /** Up or down. */
    up: boolean;
    seconds: number;
}

/** The part of a route walked on one Level, then the Connection taken at its end, if any. */
export interface Leg {
    levelId: Id;
    points: Vec2[];
    /** Metres walked. */
    length: number;
    ride?: Ride;
}

export interface SpaceRoute {
    /** In order: a route on one Level has one leg; each Connection taken starts a new one. */
    legs: Leg[];
    /** Metres walked, rides left out. */
    length: number;
    /** Walking at `WALKING_SPEED`, and riding, seconds. */
    seconds: number;
    /** Where it starts: Here, or the nearest point on the floor. */
    from: LevelPoint;
    /**
     * Where it ends: the place, or the nearest point to it that can be reached; for a place
     * outside the building, the doorway it is left by.
     */
    to: LevelPoint;
    /**
     * A place outside the building, on the Level of the door `to`, and the `way` on to it from
     * the doorway, round the building (`wayOutside`): not walked by the route, nor counted in its
     * length and time, as what lies outside is not drawn.
     */
    outside?: LevelPoint & { way: Vec2[] };
}

/** Where a route may end: a point on the floor, and the way on from it to a place outside. */
interface End {
    point: Vec2;
    beyond: number;
    way?: Vec2[];
}

const lengthOf = (points: Vec2[]) =>
    points.reduce(
        (s, p, i) => (i ? s + Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1]) : 0),
        0,
    );

/** One Stop where the route can get on or off a Connection: on the floor beside it. */
interface Node {
    levelId: Id;
    point: Vec2;
    connection: Connection;
    stop: number;
}

/**
 * The Stops a one-way Connection can be ridden to from `stop`: the later ones, as it runs from its
 * first Stop to its last. A two-way Connection goes to every other Stop.
 */
function rideTo(connection: Connection, stop: number): number[] {
    return connection.stops
        .map((_, i) => i)
        .filter((i) => i !== stop && (connection.bidirectional || i > stop));
}

/** How far apart two Levels are in height: their elevations, else a storey for each ordinal. */
function heightBetween(a: Level, b: Level): number {
    const height = Math.abs(a.elevation - b.elevation);
    return height > 0 ? height : Math.abs(a.ordinal - b.ordinal) * LEVEL_HEIGHT;
}

/** Up when the Level gone to stands higher, by elevation and then ordinal. */
const isUp = (from: Level, to: Level) =>
    to.elevation !== from.elevation ? to.elevation > from.elevation : to.ordinal > from.ordinal;

/** The middle of a Stop's outline: where to get on when it has no entry point. */
const middle = (ring: Vec2[]): Vec2 => [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
];

export interface SpaceRouteOptions {
    /**
     * Only Connections marked `accessible` (ADR-0017, slice 3): for a wheelchair, a pram or a
     * suitcase. Lifts and ramps drawn in the Editor start marked; stairs and escalators do not.
     */
    stepFree?: boolean;
}

/** Whether a step-free route may take a Connection: when its owner marked it accessible. */
export const isStepFree = (connection: Connection) => connection.accessible === true;

/**
 * The quickest route from `from` to `to` in a Space, walking on each Level and taking Connections
 * between them: walks at `WALKING_SPEED`, rides as `RIDE_SECONDS` says, one-way Connections only
 * from their first Stop toward their last. A visitor gets on or off at the floor beside a Stop's
 * entry point (else its middle). `meshOf` gives each Level's navmesh (`buildNavMesh`); only
 * Levels with a Connection, Here or the place are asked for. Null when no route reaches the place.
 * A `stepFree` route takes only accessible Connections (`isStepFree`). The place is found as
 * `placeOf` says: outside its Level's Outline, it may be on a Level below; outside the building,
 * the route ends in the doorway of the way out (`exitsOf`, on any Level) with the shortest way on
 * to the place, counted straight; with no way out, it is null.
 */
export function findSpaceRoute(
    doc: AreaformDocument,
    from: LevelPoint,
    to: LevelPoint,
    meshOf: (levelId: Id) => NavMesh,
    options: SpaceRouteOptions = {},
): SpaceRoute | null {
    const levels = new Map(doc.levels.map((l) => [l.id, l]));
    if (!levels.has(from.levelId) || !levels.has(to.levelId)) return null;

    // Where the route may end, by Level: the place, or each doorway out with the way on from it.
    const place = placeOf(doc, to);
    if (place.kind === 'nowhere') return null;
    const ends = new Map<Id, End[]>();
    const endOn = (levelId: Id, end: End) => ends.set(levelId, [...(ends.get(levelId) ?? []), end]);
    if (place.kind === 'inside')
        endOn(place.place.levelId, { point: place.place.point, beyond: 0 });
    else
        for (const exit of place.exits) {
            const placed = snap(meshOf(exit.levelId), exit.point);
            if (placed)
                endOn(exit.levelId, {
                    point: placed.point,
                    beyond: lengthOf(exit.way),
                    way: exit.way,
                });
        }

    const nodes: Node[] = [];
    for (const connection of doc.connections) {
        if (options.stepFree && !isStepFree(connection)) continue;
        connection.stops.forEach((stop, i) => {
            if (!levels.has(stop.levelId)) return;
            const placed = snap(meshOf(stop.levelId), stop.entry ?? middle(stop.shape.outer));
            if (placed)
                nodes.push({
                    levelId: stop.levelId,
                    point: placed.point,
                    connection,
                    stop: i,
                });
        });
    }
    const nodeAt = (connection: Connection, stop: number) =>
        nodes.findIndex((n) => n.connection === connection && n.stop === stop);

    // Dijkstra over: Here (-1), each Stop (0…), the place (nodes.length). Walks are found as needed.
    const START = -1;
    const END = nodes.length;
    const seconds = new Map<number, number>([[START, 0]]);
    /** How each was reached: by walking a leg from the one before, or by riding to it. */
    const via = new Map<number, { previous: number; walk?: FoundWalk; ride?: Ride; end?: End }>();
    const done = new Set<number>();
    const pointOf = (i: number): LevelPoint => (i === START ? from : nodes[i]!);

    for (;;) {
        let current: number | null = null;
        let best = Infinity;
        for (const [i, s] of seconds)
            if (!done.has(i) && s < best) {
                best = s;
                current = i;
            }
        if (current === null) return null;
        if (current === END) break;
        done.add(current);
        const at = current;
        const here = pointOf(current);
        const mesh = meshOf(here.levelId);
        const reach = (
            next: number,
            cost: number,
            step: { walk?: FoundWalk; ride?: Ride; end?: End },
        ) => {
            if (done.has(next) || best + cost >= (seconds.get(next) ?? Infinity)) return;
            seconds.set(next, best + cost);
            via.set(next, { previous: at, ...step });
        };

        // Walks on this Level: to each Stop on it, and to where the route may end here.
        const walkTo = (next: number, point: Vec2, end?: End) => {
            const walk = findRoute(mesh, here.point, point);
            if (walk)
                reach(next, (walk.length + (end?.beyond ?? 0)) / WALKING_SPEED, {
                    walk,
                    ...(end && { end }),
                });
        };
        nodes.forEach((n, i) => {
            if (i !== at && n.levelId === here.levelId) walkTo(i, n.point);
        });
        for (const end of ends.get(here.levelId) ?? []) walkTo(END, end.point, end);

        // A ride, only from a Stop reached on foot: getting off is where the next walk starts.
        const arrived = via.get(at);
        if (at !== START && !arrived?.ride) {
            const node = nodes[at]!;
            for (const stop of rideTo(node.connection, node.stop)) {
                const next = nodeAt(node.connection, stop);
                if (next === -1) continue;
                const [a, b] = [levels.get(node.levelId)!, levels.get(nodes[next]!.levelId)!];
                const ride: Ride = {
                    connectionId: node.connection.id,
                    kind: node.connection.kind,
                    toLevelId: b.id,
                    up: isUp(a, b),
                    seconds: RIDE_SECONDS[node.connection.kind](heightBetween(a, b)),
                };
                reach(next, ride.seconds, { ride });
            }
        }
    }

    // Back from the place to Here: each walk is a leg, each ride ends the leg before it.
    const steps: { walk?: FoundWalk; ride?: Ride; levelId: Id }[] = [];
    for (let i = END; i !== START;) {
        const step = via.get(i)!;
        steps.unshift({ ...step, levelId: pointOf(step.previous).levelId });
        i = step.previous;
    }
    const legs: Leg[] = [];
    for (const step of steps) {
        let leg = legs.at(-1);
        if (!leg || leg.ride || leg.levelId !== step.levelId) {
            leg = { levelId: step.levelId, points: [], length: 0 };
            legs.push(leg);
        }
        if (step.walk) {
            // Walks joined at a Stop passed on foot share its point.
            const points = leg.points.length ? step.walk.points.slice(1) : step.walk.points;
            leg.points.push(...points);
            leg.length += step.walk.length;
        }
        if (step.ride) leg.ride = step.ride;
    }
    const first = steps[0]!.walk;
    const last = steps.at(-1)!;
    const endsOn = last.levelId;
    // The way on from a door to a place outside is not drawn, nor counted.
    const end = via.get(END)!.end!;
    return {
        legs,
        length: legs.reduce((s, l) => s + l.length, 0),
        seconds: seconds.get(END)! - end.beyond / WALKING_SPEED,
        from: { levelId: from.levelId, point: first ? first.from : from.point },
        to: { levelId: endsOn, point: last.walk!.to },
        ...(end.way && { outside: { levelId: endsOn, point: to.point, way: end.way } }),
    };
}
