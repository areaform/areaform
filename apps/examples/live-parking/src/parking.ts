// The car park's own logic, apart from the page: which Zones are spots, what state each is in, and
// which free spot gets a driver from the gate to the lift soonest. Plain functions over the Document, so they
// are tested without a browser (parking.test.ts).
import {
    defaultPresets,
    type AreaformDocument,
    type Id,
    type Preset,
    type Vec2,
} from '@areaform/core';
import {
    buildNavMesh,
    findRoute,
    findSpaceRoute,
    WALKING_SPEED,
    type FoundRoute,
    type LevelPoint,
    type NavMesh,
    type SpaceRoute,
} from '@areaform/wayfinding';

/**
 * The Space Kind `parking` is not built in. Its Preset says which categories exist and that spots
 * must not overlap; `diagnose` and the Editor read it. The View needs nothing from it.
 */
export const presets: Record<string, Preset> = {
    ...defaultPresets,
    parking: {
        label: 'Car park',
        gridStep: 2.5,
        levelHeight: 2.6,
        categories: [
            { id: 'spot', label: 'Spot', exclusive: true, walkAround: true },
            { id: 'ev', label: 'EV charging', exclusive: true, walkAround: true },
            { id: 'accessible', label: 'Accessible', exclusive: true, walkAround: true },
            { id: 'lane', label: 'Driving lane', restricted: true },
            { id: 'gate', label: 'Entry gate', restricted: true },
            { id: 'walkway', label: 'Walkway' },
        ],
        zoneCategory: 'spot',
    },
};

/** A spot: a Zone with a sensor, named by `data.sensorId`. */
export interface Spot {
    id: Id;
    levelId: Id;
    label: string;
    category: string;
    sensorId: string;
    /** The middle of the spot, where a walk from it starts. */
    middle: Vec2;
}

export function spotsOf(doc: AreaformDocument): Spot[] {
    return doc.levels.flatMap((level) =>
        level.zones.flatMap((zone) => {
            const sensorId = zone.data?.sensorId;
            if (typeof sensorId !== 'string') return [];
            const middle = middleOf(zone.shape.outer);
            return [
                {
                    id: zone.id,
                    levelId: level.id,
                    label: zone.label ?? zone.id,
                    category: zone.category ?? 'spot',
                    sensorId,
                    middle,
                },
            ];
        }),
    );
}

/** The last report of each sensor. */
export type Readings = ReadonlyMap<string, { occupied: boolean; at: number }>;

export type SpotState = 'free' | 'occupied' | 'reserved' | 'silent';

/** A sensor that has not reported for this long is taken as broken, milliseconds. */
export const SILENT_AFTER = 10 * 60 * 1000;

export function stateOf(
    spot: Spot,
    readings: Readings,
    reserved: ReadonlySet<Id>,
    now: number,
): SpotState {
    if (reserved.has(spot.id)) return 'reserved';
    const reading = readings.get(spot.sensorId);
    if (!reading || now - reading.at > SILENT_AFTER) return 'silent';
    return reading.occupied ? 'occupied' : 'free';
}

/** Free spots per Level, in the Document's order of Levels. */
export function freeByLevel(
    doc: AreaformDocument,
    spots: readonly Spot[],
    state: (spot: Spot) => SpotState,
): { levelId: Id; name: string; free: number; total: number }[] {
    return doc.levels.map((level) => {
        const here = spots.filter((s) => s.levelId === level.id);
        return {
            levelId: level.id,
            name: level.name,
            free: here.filter((s) => state(s) === 'free').length,
            total: here.length,
        };
    });
}

/** Where people get on the lift on a Level: its Stop's entry point, else the Stop's first corner. */
export function liftDoor(doc: AreaformDocument, levelId: Id): Vec2 | null {
    const lift = doc.connections.find((c) => c.kind === 'elevator');
    const stop = lift?.stops.find((s) => s.levelId === levelId);
    return stop ? (stop.entry ?? stop.shape.outer[0]!) : null;
}

/** Where cars come in: the middle of the `gate` Zone. */
export function gateOf(doc: AreaformDocument): LevelPoint | null {
    for (const level of doc.levels) {
        const gate = level.zones.find((z) => z.category === 'gate');
        if (gate) return { levelId: level.id, point: middleOf(gate.shape.outer) };
    }
    return null;
}

/** Categories cars may drive on. */
const DRIVABLE = new Set(['lane', 'gate']);

/**
 * The plan as a driver sees it, for `@areaform/wayfinding`, which finds routes on foot: every Zone
 * but the lanes and the gate is walked around (driven around, here), and the only Connection is the
 * car ramp. The plan itself is not changed.
 */
export function drivingPlan(doc: AreaformDocument): AreaformDocument {
    return {
        ...doc,
        levels: doc.levels.map((level) => ({
            ...level,
            zones: level.zones.map((zone) =>
                DRIVABLE.has(zone.category ?? '') ? zone : { ...zone, walkAround: true },
            ),
        })),
        connections: doc.connections.filter((c) => c.kind === 'ramp'),
    };
}

/** How far a drive keeps from walls, spots and walkways, metres: about half a car's width. */
export const DRIVE_CLEARANCE = 1;
/** How fast cars go round a car park, metres a second (10 km/h). */
export const DRIVE_SPEED = 2.8;

/** Getting to the lift from the gate by way of a spot: the drive to it, then the walk from it. */
export interface Trip {
    /** On each Level it crosses; `ride` is the ramp up to the next. */
    drive: SpaceRoute;
    walk: FoundRoute;
    /** Driving, going up the ramp and walking, seconds. */
    seconds: number;
}

/**
 * The trip through every spot: from the gate, drive to the spot, then walk to the lift on its
 * Level. The plan does not change while the page is open, so this is found once; only which spots
 * are free changes.
 */
export function tripsOf(doc: AreaformDocument, spots: readonly Spot[]): Map<Id, Trip> {
    const trips = new Map<Id, Trip>();
    const gate = gateOf(doc);
    if (!gate) return trips;
    const driving = drivingPlan(doc);
    const meshes = new Map<Id, NavMesh>();
    const drivingMeshes = new Map<Id, NavMesh>();
    const cached = (cache: Map<Id, NavMesh>, make: (id: Id) => NavMesh) => (id: Id) => {
        let mesh = cache.get(id);
        if (!mesh) cache.set(id, (mesh = make(id)));
        return mesh;
    };
    const walkingMesh = cached(meshes, (id) => buildNavMesh(doc, id));
    const drivingMesh = cached(drivingMeshes, (id) =>
        buildNavMesh(driving, id, { clearance: DRIVE_CLEARANCE }),
    );

    for (const spot of spots) {
        const door = liftDoor(doc, spot.levelId);
        if (!door) continue;
        // Spots are walked and driven around, so both routes end on the floor beside the spot.
        const drive = findSpaceRoute(
            driving,
            gate,
            { levelId: spot.levelId, point: spot.middle },
            drivingMesh,
        );
        const walk = findRoute(walkingMesh(spot.levelId), spot.middle, door);
        if (!drive || !walk) continue;
        const ramp = drive.legs.reduce((sum, leg) => sum + (leg.ride?.seconds ?? 0), 0);
        const seconds = drive.length / DRIVE_SPEED + ramp + walk.length / WALKING_SPEED;
        trips.set(spot.id, { drive, walk, seconds });
    }
    return trips;
}

/**
 * What a driver asks for: an ordinary spot, one with a charger, or one for a disabled badge. Each
 * is its own category, so an ordinary car is never sent to a charger.
 */
export type Need = 'spot' | 'ev' | 'accessible';

/**
 * The free spot that fits the need and gets the driver from the gate to the lift soonest, or null
 * when none is free: a short drive and a long walk can beat a long drive and a short one.
 */
export function bestFree(
    spots: readonly Spot[],
    trips: ReadonlyMap<Id, Trip>,
    state: (spot: Spot) => SpotState,
    need: Need,
): Spot | null {
    let best: Spot | null = null;
    let bestSeconds = Infinity;
    for (const spot of spots) {
        if (spot.category !== need || state(spot) !== 'free') continue;
        const seconds = trips.get(spot.id)?.seconds ?? Infinity;
        if (seconds < bestSeconds) [best, bestSeconds] = [spot, seconds];
    }
    return best;
}

/** The middle of a rectangle-like ring's bounding box. */
function middleOf(ring: readonly Vec2[]): Vec2 {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
