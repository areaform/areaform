// The "Where is it?" setting: people give the latitude and longitude of the middle of their plan,
// which they can copy from a map, and the Space's `geo` is worked out from it.
import {
    georeferenceAt,
    lngLatProjection,
    type AreaformDocument,
    type Georeference,
    type Vec2,
} from '@areaform/core';

export interface LatLng {
    lat: number;
    lng: number;
}

/** The middle of the ground Level's Outline (its bounding box), the point people place. */
export function planMiddle(doc: AreaformDocument): Vec2 {
    const level = doc.levels.find((l) => l.ordinal === 0) ?? doc.levels[0]!;
    const xs = level.outline.outer.map(([x]) => x);
    const ys = level.outline.outer.map(([, y]) => y);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Where the middle of the plan lies, or undefined for a Space not placed on a map. */
export function middleLatLng(doc: AreaformDocument): LatLng | undefined {
    if (!doc.geo) return undefined;
    const [lng, lat] = lngLatProjection(doc.geo)(planMiddle(doc));
    return { lat, lng };
}

/** The `geo` that puts the middle of the plan at `at`, with up on the plan facing `bearing`. */
export function placeMiddle(doc: AreaformDocument, at: LatLng, bearing: number): Georeference {
    return georeferenceAt(planMiddle(doc), at, normalizeBearing(bearing));
}

/** Degrees from north in [0, 360). */
export function normalizeBearing(degrees: number): number {
    return ((degrees % 360) + 360) % 360;
}

/**
 * Reads a latitude and longitude as maps copy them: `52.22977, 21.01178`, or with a space instead
 * of the comma. Undefined unless both are numbers in range. The decimal mark must be a point,
 * since the comma separates the two.
 */
export function parseLatLng(text: string): LatLng | undefined {
    const parts = text
        .trim()
        .replace(/−/g, '-')
        .split(/\s*,\s*|\s+/);
    if (parts.length !== 2) return undefined;
    const [lat, lng] = parts.map((part) => (/^[-+]?\d+(\.\d+)?$/.test(part) ? Number(part) : NaN));
    if (!(Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180)) return undefined;
    return { lat: lat!, lng: lng! };
}

/** Six decimals, about ten centimetres, as maps show them. */
export function formatLatLng({ lat, lng }: LatLng): string {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
