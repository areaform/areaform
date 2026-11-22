// Where a Space lies on Earth (`geo`): plan metres to longitude and latitude and back.
import type { Georeference, Vec2 } from './model.ts';

/** `[longitude, latitude]` in degrees, the GeoJSON order. */
export type LngLat = [number, number];

/**
 * Plan points to longitude and latitude, for the Space's `geo`. The plan is turned by `bearing`,
 * then laid on a plane tangent to the WGS 84 ellipsoid at `origin`: exact to well under a
 * centimetre across a building.
 */
export function lngLatProjection(geo: Georeference): (point: Vec2) => LngLat {
    const { lat, lng } = geo.origin;
    const { perLat, perLng } = metresPerDegree(lat);
    const theta = (geo.bearing * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return ([x, y]) => {
        const east = x * cos + y * sin;
        const north = -x * sin + y * cos;
        return [lng + east / perLng, lat + north / perLat];
    };
}

/**
 * The `geo` that puts the plan's `point` at `at` and turns up on the plan to `bearing`: the anchor
 * the Editor asks for, since people know where their building is, not where `[0, 0]` is.
 */
export function georeferenceAt(
    point: Vec2,
    at: { lat: number; lng: number },
    bearing: number,
): Georeference {
    // The scale depends on the origin's latitude, which is what is being found: a few rounds settle it.
    let origin = { lat: at.lat, lng: at.lng };
    for (let round = 0; round < 3; round++) {
        const [lng, lat] = lngLatProjection({ origin, bearing })(point);
        origin = { lat: origin.lat + at.lat - lat, lng: origin.lng + at.lng - lng };
    }
    return { origin, bearing };
}

/** Metres per degree of latitude and of longitude on the WGS 84 ellipsoid, at a latitude. */
function metresPerDegree(lat: number): { perLat: number; perLng: number } {
    const phi = (lat * Math.PI) / 180;
    return {
        perLat: 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
        perLng: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
    };
}
