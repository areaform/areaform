import { createSpace, placeDocument, type AreaformDocument, type Vec2 } from '@areaform/core';
import { describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../i18n/index.ts';
import { unreachableZonesOn } from '@areaform/wayfinding';
import {
    cachedInnerSpaces,
    INNER_PLAN_SECONDS,
    innerSpaceProblems,
    shopClosed,
} from './innerSpaces.ts';
import { problemText } from './problems.ts';

const unitShape: Vec2[] = [
    [0, 0],
    [6, 0],
    [6, 15],
    [0, 15],
];

/** A centre with three units: one whose shop fits, one too big for it, one not published. */
function centre(): AreaformDocument {
    const doc = createSpace({ name: 'Centre', kind: 'mall', size: [40, 20] });
    const level = doc.levels[0]!;
    const fit = { x: 0, y: 0, rotation: 0 };
    level.zones = [
        {
            id: 'fits',
            label: 'Volt',
            shape: { outer: unitShape },
            innerSpace: { space: 'sp_volt', fit },
        },
        {
            id: 'grown',
            label: 'Moss',
            shape: { outer: unitShape },
            innerSpace: { space: 'sp_moss', fit },
        },
        {
            id: 'hidden',
            label: 'Kettle',
            shape: { outer: unitShape },
            innerSpace: { space: 'sp_kettle' },
        },
        { id: 'plain', label: 'Books', shape: { outer: unitShape } },
    ];
    return doc;
}

const plans: Record<string, AreaformDocument | null> = {
    sp_volt: createSpace({ name: 'Volt', kind: 'store', size: [6, 15] }),
    sp_moss: createSpace({ name: 'Moss', kind: 'store', size: [9, 15] }),
    sp_kettle: null,
};

describe('Problems for Inner Spaces', () => {
    it('names a unit whose plan visitors cannot see, and one whose plan no longer fits', async () => {
        const doc = centre();
        const found = await innerSpaceProblems(doc, async (space) => plans[space] ?? null);
        expect(found.map((p) => [p.code, p.ref.id])).toEqual([
            ['inner-space-misfit', 'grown'],
            ['inner-space-unpublished', 'hidden'],
        ]);
        const i18n = createTranslator('en');
        expect(found.map((p) => problemText(doc, p, i18n))).toEqual([
            'The plan inside Moss changed and no longer fits the unit; check its fit',
            "The plan inside Kettle isn't published, so visitors can't see inside",
        ]);
    });
});

describe('the host’s plans, loaded once for a while', () => {
    it('asks again once they may have changed, and takes a failed load as none', async () => {
        let now = 0;
        const load = vi.fn(async (space: string) => {
            if (space === 'sp_broken') throw new Error('offline');
            return plans[space] ?? null;
        });
        const cached = cachedInnerSpaces({ load }, () => now);

        await cached.load('sp_volt');
        await cached.load('sp_volt');
        expect(load).toHaveBeenCalledTimes(1);
        now = INNER_PLAN_SECONDS * 1000;
        await cached.load('sp_volt');
        expect(load).toHaveBeenCalledTimes(2);
        expect(await cached.load('sp_broken')).toBeNull();
    });
});

describe('whether visitors get into a shop laid into its unit', () => {
    /** A hall with a way in on its south side, and a unit 6 × 10 m with its front on the hall. */
    function hall(): AreaformDocument {
        const doc = createSpace({ name: 'Hall', kind: 'mall', size: [30, 20] });
        const level = doc.levels[0]!;
        level.wallNodes = [
            { id: 'a', position: [0, 0] },
            { id: 'b', position: [30, 0] },
        ];
        level.walls = [{ id: 'south', a: 'a', b: 'b', thickness: 0.3 }];
        level.openings = [
            { id: 'door', kind: 'entrance', width: 2, host: 'wall', wallId: 'south', offset: 5 },
        ];
        level.zones = [
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
    /** A shop 6 × 10 m with its entrance in the middle of its front, toward y = 0. */
    function shop(): AreaformDocument {
        const doc = createSpace({ name: 'Volt', kind: 'store', size: [6, 10] });
        const level = doc.levels[0]!;
        level.wallNodes = [
            { id: 'p', position: [0, 0] },
            { id: 'q', position: [6, 0] },
        ];
        level.walls = [{ id: 'front', a: 'p', b: 'q', thickness: 0.15 }];
        level.openings = [
            { id: 'in', kind: 'entrance', width: 1.6, host: 'wall', wallId: 'front', offset: 3 },
        ];
        level.zones = [
            {
                id: 'watches',
                shape: {
                    outer: [
                        [4, 4],
                        [5.5, 4],
                        [5.5, 7],
                        [4, 7],
                    ],
                },
            },
        ];
        return doc;
    }
    const unreached = (doc: AreaformDocument, level: AreaformDocument['levels'][number]) =>
        unreachableZonesOn(doc, level);

    it('is open with the entrance on the hall, closed with it turned to the back wall', () => {
        const doc = hall();
        const unit = { levelId: doc.levels[0]!.id, zoneId: 'unit' };
        const front = placeDocument(shop(), { x: 10, y: 10, rotation: 0 });
        expect(shopClosed(doc, unit, front, unreached)).toBe(false);
        // Turned half round, its entrance faces the hall's back wall, beyond the plan's edge.
        const back = placeDocument(shop(), { x: 16, y: 20, rotation: Math.PI });
        expect(shopClosed(doc, unit, back, unreached)).toBe(true);
    });
});
