import { describe, expect, it } from 'vitest';
import { createSpace } from '../createSpace.ts';
import type { AreaformDocument, InnerSpaceFit, Vec2 } from '../model.ts';
import { fitsUnit, fitToUnit, placeDocument, placePoint, withInnerSpace } from './place.ts';

const close = (actual: Vec2, expected: Vec2) => {
    expect(actual[0]).toBeCloseTo(expected[0]);
    expect(actual[1]).toBeCloseTo(expected[1]);
};

/** A quarter turn counter-clockwise, then 10 m east: the shop's [1, 0] lands at [10, 1]. */
const QUARTER: InnerSpaceFit = { x: 10, y: 0, rotation: Math.PI / 2 };

function shop(): AreaformDocument {
    const doc = createSpace({ name: 'Volt', kind: 'store', size: [8, 6] });
    const level = doc.levels[0]!;
    level.wallNodes = [
        { id: 'N1', position: [0, 0] },
        { id: 'N2', position: [8, 0] },
    ];
    level.walls = [{ id: 'W1', a: 'N1', b: 'N2', thickness: 0.2 }];
    level.openings = [
        { id: 'D1', kind: 'entrance', width: 1.2, host: 'wall', wallId: 'W1', offset: 4 },
        { id: 'D2', kind: 'passage', width: 1, host: 'free', position: [2, 3], angle: 0 },
    ];
    level.zones = [
        {
            id: 'watches',
            label: 'Watches',
            shape: {
                outer: [
                    [1, 1],
                    [3, 1],
                    [3, 2],
                    [1, 2],
                ],
            },
            labelAnchor: [2, 1.5],
            data: { sku: 7 },
        },
    ];
    level.obstacles = [
        {
            id: 'C1',
            kind: 'column',
            shape: {
                outer: [
                    [4, 4],
                    [4.4, 4],
                    [4.4, 4.4],
                    [4, 4.4],
                ],
            },
        },
    ];
    level.underlays = [
        {
            id: 'U1',
            src: 'plan.png',
            position: [0, 6],
            scale: 0.01,
            rotation: 0,
            opacity: 1,
            locked: true,
        },
    ];
    level.viewpoints = [{ id: 'V1', target: [4, 3], bearing: 0, tilt: 45, distance: 10 }];
    doc.connections = [
        {
            id: 'S1',
            kind: 'stairs',
            bidirectional: true,
            stops: [
                {
                    levelId: level.id,
                    shape: {
                        outer: [
                            [6, 4],
                            [7, 4],
                            [7, 5],
                            [6, 5],
                        ],
                    },
                    entry: [6.5, 3.8],
                },
            ],
        },
    ];
    return doc;
}

describe('placing an Inner Space into its unit', () => {
    it('turns a point, then moves it', () => {
        close(placePoint([1, 0], QUARTER), [10, 1]);
        close(placePoint([0, 0], QUARTER), [10, 0]);
        close(placePoint([2, 3], { x: -1, y: 5, rotation: 0 }), [1, 8]);
    });

    it('lays every position of the Document in, and keeps ids, names and data', () => {
        const placed = placeDocument(shop(), QUARTER);
        const level = placed.levels[0]!;
        close(level.outline.outer[1]!, placePoint([8, 0], QUARTER));
        close(level.wallNodes[1]!.position, [10, 8]);
        const zone = level.zones[0]!;
        expect(zone).toMatchObject({ id: 'watches', label: 'Watches', data: { sku: 7 } });
        close(zone.shape.outer[0]!, [9, 1]);
        close(zone.labelAnchor!, [8.5, 2]);
        close(level.obstacles[0]!.shape.outer[0]!, [6, 4]);
        close(placed.connections[0]!.stops[0]!.entry!, [6.2, 6.5]);
    });

    it('turns what has a direction: free Openings, Underlays and Viewpoints', () => {
        const level = placeDocument(shop(), QUARTER).levels[0]!;
        // An Opening in a Wall follows its Wall; one standing free turns with the plan.
        expect(level.openings[0]).toEqual(shop().levels[0]!.openings[0]);
        const free = level.openings[1]!;
        expect(free.host === 'free' && free.angle).toBeCloseTo(Math.PI / 2);
        expect(level.underlays[0]!.rotation).toBeCloseTo(Math.PI / 2);
        close(level.underlays[0]!.position, [4, 0]);
        // Looking north in the shop, it looks west once the shop is turned a quarter CCW.
        expect(level.viewpoints![0]!.bearing).toBeCloseTo(270);
        close(level.viewpoints![0]!.target, [7, 4]);
    });

    it('keeps the Document it was given as it was', () => {
        const doc = shop();
        const before = JSON.parse(JSON.stringify(doc)) as AreaformDocument;
        placeDocument(doc, QUARTER);
        expect(doc).toEqual(before);
    });
});

describe('fitting an Inner Space into its unit', () => {
    /** A unit 6 m wide and 15 m deep, its corner at [50, 20]. */
    const unit = {
        outer: [
            [50, 20],
            [56, 20],
            [56, 35],
            [50, 35],
        ] as Vec2[],
    };
    const shopOf = (w: number, h: number) =>
        createSpace({ name: 'Volt', kind: 'store', size: [w, h] });

    it('centres a plan drawn the unit’s way round on the unit, unturned', () => {
        const fit = fitToUnit(unit, shopOf(5.6, 14.6));
        expect(fit.rotation).toBe(0);
        close([fit.x, fit.y], [50.2, 20.2]);
        expect(fitsUnit(unit, shopOf(5.6, 14.6), fit)).toBe(true);
    });

    it('turns a plan drawn the other way round a quarter, so its long side runs as the unit’s', () => {
        const shop = shopOf(15, 6);
        const fit = fitToUnit(unit, shop);
        expect(fit.rotation).toBeCloseTo(Math.PI / 2);
        expect(fitsUnit(unit, shop, fit)).toBe(true);
        for (const corner of placeDocument(shop, fit).levels[0]!.outline.outer) {
            expect(corner[0]).toBeGreaterThanOrEqual(50 - 1e-9);
            expect(corner[0]).toBeLessThanOrEqual(56 + 1e-9);
        }
    });

    it('says when the shop’s plan no longer fits, past a wall’s width', () => {
        const fit = { x: 50, y: 20, rotation: 0 };
        expect(fitsUnit(unit, shopOf(6.2, 15), fit)).toBe(true);
        expect(fitsUnit(unit, shopOf(7, 15), fit)).toBe(false);
        expect(fitsUnit(unit, shopOf(6, 15), { ...fit, x: 40 })).toBe(false);
    });
});

describe('a shop laid into its unit, for one route', () => {
    it('joins the shop’s ground floor to the unit’s Level under its own ids, and opens the unit', () => {
        const centre = createSpace({ name: 'Centre', kind: 'mall', size: [40, 20] });
        const level = centre.levels[0]!;
        level.zones = [
            {
                id: 'unit',
                walkAround: true,
                shape: {
                    outer: [
                        [10, 0],
                        [20, 0],
                        [20, 6],
                        [10, 6],
                    ],
                },
            },
        ];
        const placed = placeDocument(shop(), { x: 10, y: 0, rotation: 0 });
        const merged = withInnerSpace(centre, { levelId: level.id, zoneId: 'unit' }, placed);
        const joined = merged.levels[0]!;
        expect(joined.zones.map((z) => [z.id, z.walkAround ?? false])).toEqual([
            ['unit', false],
            ['unit/watches', false],
        ]);
        expect(joined.walls[0]).toMatchObject({ id: 'unit/W1', a: 'unit/N1', b: 'unit/N2' });
        // The shop's Outline walled in, but for the entrance: its front is two walls with a gap.
        const at = (id: string) => joined.wallNodes.find((n) => n.id === id)!.position;
        const lengths = joined.walls.slice(1).map((w) => {
            const [a, b] = [at(w.a), at(w.b)];
            return Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 10) / 10;
        });
        expect(lengths).toEqual([3.4, 3.4, 6, 8, 6]);
        // Its own stairs block the way, as their Stop.
        expect(joined.obstacles.map((o) => o.id)).toEqual(['unit/C1', 'unit/S1-stop-0']);
        expect(joined.openings.map((o) => o.id)).toEqual(['unit/D1', 'unit/D2']);
        expect(joined.openings[0]).toMatchObject({ wallId: 'unit/W1' });
        // The centre itself is left as it was.
        expect(centre.levels[0]!.zones).toHaveLength(1);
    });
});
