import { diagnose, fromJSON, type Vec2 } from '@areaform/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    bestFree,
    drivingPlan,
    freeByLevel,
    gateOf,
    liftDoor,
    presets,
    spotsOf,
    stateOf,
    tripsOf,
    DRIVE_CLEARANCE,
    SILENT_AFTER,
    type Spot,
} from './parking.ts';

const loaded = fromJSON(readFileSync(new URL('../public/plan.json', import.meta.url), 'utf8'));
if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
const doc = loaded.doc;
const spots = spotsOf(doc);
const trips = tripsOf(doc, spots);

describe('the plan', () => {
    it('loads, and has nothing a check would flag', () => {
        expect(diagnose(doc, { presets })).toEqual([]);
    });

    it('has 40 spots on each of its three Levels, each with its own sensor', () => {
        expect(freeByLevel(doc, spots, () => 'free').map((l) => [l.name, l.total])).toEqual([
            ['P0', 40],
            ['P1', 40],
            ['P2', 40],
        ]);
        expect(new Set(spots.map((s) => s.sensorId)).size).toBe(spots.length);
    });

    it('has a gate on P0 and a lift door on every Level', () => {
        expect(gateOf(doc)?.levelId).toBe('p0');
        // The car entrance in the east wall opens onto the gate: `offset` is to its middle.
        const p0 = doc.levels[0]!;
        const entrance = p0.openings.find((o) => o.id === 'car-entrance');
        if (entrance?.host !== 'wall') throw new Error('No car entrance in a wall');
        const gate = p0.zones.find((z) => z.category === 'gate')!.shape.outer.map((p) => p[1]);
        expect(entrance.offset - entrance.width / 2).toBe(Math.min(...gate));
        expect(entrance.offset + entrance.width / 2).toBe(Math.max(...gate));
        for (const level of doc.levels) expect(liftDoor(doc, level.id)).not.toBeNull();
    });
});

describe('the trips', () => {
    it('reach every spot: a drive from the gate, and a walk to the lift', () => {
        expect(trips.size).toBe(spots.length);
    });

    it('start at the gate, and go up only by the car ramp', () => {
        const trip = trips.get('P2-B05')!;
        expect(trip.drive.from.levelId).toBe('p0');
        // One ride up the spiral ramp, past P1, as a lift goes past floors.
        expect(trip.drive.legs.map((l) => l.levelId)).toEqual(['p0', 'p2']);
        expect(trip.drive.legs[0]!.ride).toMatchObject({ kind: 'ramp', toLevelId: 'p2', up: true });
        // A spot on the gate's Level is a drive with no ramp.
        expect(trips.get('P0-D05')!.drive.legs).toHaveLength(1);
    });

    it('drive on lanes only, never over walkways or other spots', () => {
        const driving = drivingPlan(doc);
        expect(driving.connections.map((c) => c.id)).toEqual(['ramp']);
        const keepOff = doc.levels.flatMap((level) =>
            level.zones
                .filter((z) => z.category !== 'lane' && z.category !== 'gate')
                .map((z) => ({ levelId: level.id, ring: z.shape.outer })),
        );
        for (const { drive } of trips.values())
            for (const leg of drive.legs)
                for (const point of leg.points.slice(1, -1))
                    for (const { levelId, ring } of keepOff)
                        if (levelId === leg.levelId)
                            expect(inside(point, ring, DRIVE_CLEARANCE / 2)).toBe(false);
    });
});

describe('stateOf', () => {
    const spot = spots[0]!;
    const now = 1_000_000_000;

    it('follows the last report of its sensor', () => {
        const readings = new Map([[spot.sensorId, { occupied: true, at: now }]]);
        expect(stateOf(spot, readings, new Set(), now)).toBe('occupied');
        readings.set(spot.sensorId, { occupied: false, at: now });
        expect(stateOf(spot, readings, new Set(), now)).toBe('free');
    });

    it('is silent when its sensor never reported, or not for a long time', () => {
        expect(stateOf(spot, new Map(), new Set(), now)).toBe('silent');
        const old = new Map([[spot.sensorId, { occupied: false, at: now - SILENT_AFTER - 1 }]]);
        expect(stateOf(spot, old, new Set(), now)).toBe('silent');
    });

    it('is reserved whatever its sensor says', () => {
        const readings = new Map([[spot.sensorId, { occupied: false, at: now }]]);
        expect(stateOf(spot, readings, new Set([spot.id]), now)).toBe('reserved');
    });
});

describe('bestFree', () => {
    const freeOnly = (ids: string[]) => (s: Spot) => (ids.includes(s.id) ? 'free' : 'occupied');
    const seconds = (id: string) => trips.get(id)!.seconds;

    it('picks the free spot that gets the driver from the gate to the lift soonest', () => {
        // Up the ramp and across the deck takes longer than parking on the ground floor.
        expect(seconds('P2-B10')).toBeGreaterThan(seconds('P0-B02'));
        expect(bestFree(spots, trips, freeOnly(['P2-B10', 'P0-B02']), 'spot')?.id).toBe('P0-B02');
    });

    it('sends each driver only to spots of the kind they need', () => {
        const all = () => 'free' as const;
        expect(bestFree(spots, trips, all, 'ev')?.category).toBe('ev');
        expect(bestFree(spots, trips, all, 'accessible')?.category).toBe('accessible');
        expect(bestFree(spots, trips, all, 'spot')?.category).toBe('spot');
    });

    it('is null when nothing of that kind is free', () => {
        expect(bestFree(spots, trips, () => 'occupied', 'spot')).toBeNull();
    });
});

/** Whether a point is inside an axis-aligned rectangle shrunk by `margin` on every side. */
function inside([x, y]: Vec2, ring: readonly Vec2[], margin: number): boolean {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return (
        x > Math.min(...xs) + margin &&
        x < Math.max(...xs) - margin &&
        y > Math.min(...ys) + margin &&
        y < Math.max(...ys) - margin
    );
}
