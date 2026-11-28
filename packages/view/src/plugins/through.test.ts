import { createSpace, placeDocument, type AreaformDocument } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    onShopFloor,
    routePlan,
    sceneLevel,
    shownOn,
    shownPoints,
    throughOf,
    throughPlace,
} from './through.ts';

/** A centre with one unit, 6 × 10 m, at [10, 10]. */
function centre(): AreaformDocument {
    const doc = createSpace({ name: 'Linden Square', kind: 'mall', size: [30, 20] });
    doc.levels[0]!.id = 'ground';
    doc.levels[0]!.zones = [
        {
            id: 'unit',
            walkAround: true,
            shape: {
                outer: [
                    [10, 10],
                    [16, 10],
                    [16, 20],
                    [10, 20],
                ],
            },
        },
    ];
    return doc;
}

function shop(): AreaformDocument {
    const doc = createSpace({ name: 'Volt', kind: 'store', size: [6, 10] });
    doc.levels[0]!.id = 'shop-floor';
    return placeDocument(doc, { x: 10, y: 10, rotation: 0 });
}

const UNIT = { zoneId: 'unit', levelId: 'ground', fitted: true };
const HERE = { levelId: 'ground', point: [2, 2] as [number, number] };

describe('a Through route into a shop laid into its unit', () => {
    it('is made only for a fitted shop in a unit the centre has', () => {
        const home = centre();
        const through = throughOf(home, UNIT, shop(), 'shop-floor', HERE, undefined);
        expect(through).toMatchObject({ name: 'Volt', shopLevelId: 'shop-floor', from: HERE });
        expect(through!.doc.levels[0]!.zones.map((z) => z.id)).toContain('unit');
        expect(
            throughOf(home, { ...UNIT, fitted: false }, shop(), 'shop-floor', HERE, undefined),
        ).toBeNull();
        expect(
            throughOf(home, { ...UNIT, zoneId: 'gone' }, shop(), 'shop-floor', HERE, undefined),
        ).toBeNull();
    });

    it('routes to a place on the shop’s floor as a place on the unit’s Level', () => {
        const through = throughOf(centre(), UNIT, shop(), 'shop-floor', HERE, undefined)!;
        expect(onShopFloor(through, 'shop-floor')).toBe(true);
        expect(onShopFloor(through, 'shop-upstairs')).toBe(false);
        expect(
            throughPlace(through, { levelId: 'shop-floor', point: [12, 14], title: 'Watches' }),
        ).toEqual({
            levelId: 'ground',
            point: [12, 14],
            title: 'Watches',
            through: 'unit',
        });
    });

    it('makes the merged plan again once the host’s plan changes', () => {
        const home = centre();
        const through = throughOf(home, UNIT, shop(), 'shop-floor', HERE, undefined)!;
        const first = routePlan(through, home);
        expect(routePlan(through, home)).toBe(first);
        const renamed = { ...home, name: 'Linden Square, new wing' };
        expect(routePlan(through, renamed).name).toBe('Linden Square, new wing');
    });

    it('inside the shop, draws the route on the unit’s Level from where it comes in', () => {
        const through = throughOf(centre(), UNIT, shop(), 'shop-floor', HERE, undefined)!;
        expect(shownOn(through, 'ground', 'shop-floor')).toBe(true);
        expect(shownOn(through, 'first', 'shop-floor')).toBe(false);
        expect(shownOn(null, 'ground', 'shop-floor')).toBe(false);
        const leg = {
            levelId: 'ground',
            points: [
                [2, 2],
                [13, 8],
                [13, 12],
                [12, 15],
            ] as [number, number][],
        };
        // From the last point outside, so the line visibly comes in through the front.
        expect(shownPoints(through, leg)).toEqual([
            [13, 8],
            [13, 12],
            [12, 15],
        ]);
        expect(shownPoints(null, leg)).toBe(leg.points);
        expect(sceneLevel(through, 'ground')).toBe('shop-floor');
        expect(sceneLevel(null, 'ground')).toBe('ground');
    });
});
