import { createSpace } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    formatLatLng,
    middleLatLng,
    normalizeBearing,
    parseLatLng,
    placeMiddle,
} from './location.ts';

describe('parseLatLng', () => {
    it.each([
        ['52.22977, 21.01178', { lat: 52.22977, lng: 21.01178 }],
        ['  -33.8568,151.2153 ', { lat: -33.8568, lng: 151.2153 }],
        ['64.1466 -21.9426', { lat: 64.1466, lng: -21.9426 }],
        ['0, 0', { lat: 0, lng: 0 }],
    ])('reads %j', (text, expected) => {
        expect(parseLatLng(text)).toEqual(expected);
    });

    it.each(['', '52.2', '52,22977, 21,01178', '91, 10', '10, 181', 'Warsaw', '52.2, 21.0, 3'])(
        'refuses %j',
        (text) => {
            expect(parseLatLng(text)).toBeUndefined();
        },
    );

    it('reads back what it writes', () => {
        const at = { lat: 52.229771, lng: 21.011782 };
        expect(parseLatLng(formatLatLng(at))).toEqual(at);
    });
});

describe('placing the middle of the plan', () => {
    it('puts the middle of the ground Outline where the person said', () => {
        const doc = createSpace({ name: 'Hall', kind: 'exhibition', size: [60, 30] });
        const at = { lat: 52.22977, lng: 21.01178 };

        const placed = { ...doc, geo: placeMiddle(doc, at, 30) };
        const middle = middleLatLng(placed)!;

        expect(placed.geo.bearing).toBe(30);
        expect(middle.lat).toBeCloseTo(at.lat, 9);
        expect(middle.lng).toBeCloseTo(at.lng, 9);
        // Bearing 0: the corner [0, 0] is 30 m west and 15 m south of the middle.
        const corner = placeMiddle(doc, at, 0).origin;
        expect(corner.lat).toBeLessThan(at.lat);
        expect(corner.lng).toBeLessThan(at.lng);
    });

    it('has no middle on the map until the plan is placed', () => {
        expect(
            middleLatLng(createSpace({ name: 'Hall', kind: 'office', size: [10, 10] })),
        ).toBeUndefined();
    });

    it.each([
        [0, 0],
        [360, 0],
        [-90, 270],
        [450.5, 90.5],
    ])('reads bearing %d as %d', (degrees, expected) => {
        expect(normalizeBearing(degrees)).toBe(expected);
    });
});
