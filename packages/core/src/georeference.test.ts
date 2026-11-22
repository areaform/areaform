import { describe, expect, it } from 'vitest';
import { georeferenceAt, lngLatProjection } from './index.ts';

describe('georeferenceAt', () => {
    it.each([
        { lat: 52.2297, lng: 21.0122, bearing: 0 },
        { lat: -33.8568, lng: 151.2153, bearing: 135 },
        { lat: 64.1466, lng: -21.9426, bearing: 271.5 },
    ])(
        'puts the chosen point of the plan at $lat, $lng (bearing $bearing)',
        ({ lat, lng, bearing }) => {
            const middle: [number, number] = [120, -45];

            const geo = georeferenceAt(middle, { lat, lng }, bearing);
            const [atLng, atLat] = lngLatProjection(geo)(middle);

            expect(geo.bearing).toBe(bearing);
            // 1e-9 degrees is about 0.1 mm.
            expect(atLat).toBeCloseTo(lat, 9);
            expect(atLng).toBeCloseTo(lng, 9);
        },
    );

    it('keeps the origin where it is when the chosen point is the origin', () => {
        expect(georeferenceAt([0, 0], { lat: 50, lng: 20 }, 10)).toEqual({
            origin: { lat: 50, lng: 20 },
            bearing: 10,
        });
    });
});
