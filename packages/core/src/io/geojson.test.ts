import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    toGeoJSON,
    type AreaformDocument,
    type GeoFeature,
    type GeoPosition,
    type Ring,
} from '../index.ts';

const square = (x: number, y: number, size: number): Ring => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
];

/** A two-Level hall with one of each element, built through Commands. */
function hall(geo?: AreaformDocument['geo']): AreaformDocument {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [40, 20] }));
    const L1 = editor.getDocument().levels[0]!.id;
    const run = (command: Parameters<typeof editor.exec>[0]) => {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    };
    if (geo) run({ type: 'space.update', changes: { geo } });
    run({ type: 'wall.add', levelId: L1, id: 'W1', a: [0, 5], b: [10, 5], thickness: 0.2 });
    run({
        type: 'opening.add',
        levelId: L1,
        opening: { id: 'D1', kind: 'door', width: 1, host: 'wall', wallId: 'W1', offset: 4 },
    });
    run({
        type: 'opening.add',
        levelId: L1,
        opening: {
            id: 'E1',
            kind: 'entrance',
            width: 4,
            host: 'free',
            position: [40, 10],
            angle: Math.PI / 2,
        },
    });
    run({
        type: 'zone.add',
        levelId: L1,
        zone: {
            id: 'A-1',
            shape: { outer: square(20, 10, 4), holes: [square(21, 11, 1)] },
            label: 'A-1',
            category: 'booth',
            data: { exhibitor: 'Acme' },
        },
    });
    run({
        type: 'obstacle.add',
        levelId: L1,
        obstacle: { id: 'COL', kind: 'column', shape: { outer: square(30, 2, 0.5) } },
    });
    run({ type: 'level.add', id: 'L2', name: 'Gallery' });
    run({
        type: 'connection.add',
        connection: {
            id: 'LIFT',
            kind: 'elevator',
            stops: [L1, 'L2'].map((levelId) => ({ levelId, shape: { outer: square(1, 1, 2) } })),
            bidirectional: true,
            accessible: true,
        },
    });
    return editor.getDocument();
}

const feature = (features: GeoFeature[], id: string) => {
    const found = features.find((f) => f.id === id);
    if (!found) throw new Error(`no Feature ${id}`);
    return found;
};

/** Positive for counter-clockwise rings, in whatever units the positions are. */
const signedArea = (ring: GeoPosition[]) =>
    ring.slice(0, -1).reduce((sum, [x1, y1], i) => {
        const [x2, y2] = ring[i + 1]!;
        return sum + x1 * y2 - x2 * y1;
    }, 0) / 2;

describe('toGeoJSON without a georeference', () => {
    const doc = hall();
    const geojson = toGeoJSON(doc);
    const levelId = doc.levels[0]!.id;

    it('is a FeatureCollection in local metres, named after the plan', () => {
        expect(geojson).toMatchObject({
            type: 'FeatureCollection',
            name: 'Hall',
            coordinateSystem: 'local',
        });
        expect(JSON.parse(JSON.stringify(geojson))).toEqual(geojson);
    });

    it('has a Feature for each Level, Wall, Opening, Zone, Obstacle and Stop', () => {
        const types = geojson.features.map((f) => `${f.properties.featureType} ${f.id}`).sort();
        expect(types).toEqual(
            [
                `level ${levelId}`,
                'level L2',
                'wall W1',
                'opening D1',
                'opening E1',
                'zone A-1',
                'obstacle COL',
                `stop LIFT@${levelId}`,
                'stop LIFT@L2',
            ].sort(),
        );
    });

    it('closes each ring, outer counter-clockwise and holes clockwise', () => {
        const outline = feature(geojson.features, levelId).geometry;
        expect(outline).toEqual({
            type: 'Polygon',
            coordinates: [
                [
                    [0, 0],
                    [40, 0],
                    [40, 20],
                    [0, 20],
                    [0, 0],
                ],
            ],
        });

        const zone = feature(geojson.features, 'A-1').geometry;
        if (zone.type !== 'Polygon') throw new Error('expected a Polygon');
        const [outer, hole] = zone.coordinates;
        expect(signedArea(outer!)).toBe(16);
        expect(signedArea(hole!)).toBe(-1);
    });

    it('draws a Wall as its outline, with its thickness', () => {
        const wall = feature(geojson.features, 'W1');
        expect(wall.properties).toMatchObject({
            featureType: 'wall',
            thickness: 0.2,
            height: doc.levels[0]!.height,
        });
        if (wall.geometry.type !== 'Polygon') throw new Error('expected a Polygon');
        expect(Math.abs(signedArea(wall.geometry.coordinates[0]!))).toBeCloseTo(10 * 0.2);
    });

    it('draws an Opening as a line across its width', () => {
        expect(feature(geojson.features, 'D1')).toMatchObject({
            geometry: {
                type: 'LineString',
                coordinates: [
                    [3.5, 5],
                    [4.5, 5],
                ],
            },
            properties: { featureType: 'opening', kind: 'door', width: 1, wallId: 'W1' },
        });
        expect(feature(geojson.features, 'E1').geometry).toEqual({
            type: 'LineString',
            coordinates: [
                [40, 8],
                [40, 12],
            ],
        });
    });

    it("keeps a Zone's label, category and the owner's data", () => {
        expect(feature(geojson.features, 'A-1').properties).toEqual({
            featureType: 'zone',
            levelId,
            ordinal: 0,
            label: 'A-1',
            category: 'booth',
            data: { exhibitor: 'Acme' },
        });
    });

    it('gives each Stop its Connection and its own Level', () => {
        expect(feature(geojson.features, 'LIFT@L2').properties).toEqual({
            featureType: 'stop',
            levelId: 'L2',
            ordinal: 1,
            connectionId: 'LIFT',
            kind: 'elevator',
            bidirectional: true,
            accessible: true,
        });
    });
});

describe('toGeoJSON with a georeference', () => {
    const origin = { lat: 52.2297, lng: 21.0122 };
    const outlineOf = (doc: AreaformDocument) => {
        const outline = feature(toGeoJSON(doc).features, doc.levels[0]!.id).geometry;
        if (outline.type !== 'Polygon') throw new Error('expected a Polygon');
        return outline.coordinates[0]!;
    };

    it('writes longitude and latitude, the plan origin at geo.origin', () => {
        const doc = hall({ origin, bearing: 0 });
        const [o, x40, x40y20] = outlineOf(doc);

        expect(toGeoJSON(doc).coordinateSystem).toBe('wgs84');
        expect(o).toEqual([origin.lng, origin.lat]);
        // Bearing 0: +X is east, +Y north.
        expect(x40![1]).toBe(origin.lat);
        expect(x40![0]).toBeGreaterThan(origin.lng);
        expect(x40y20![0]).toBe(x40![0]);
        expect(x40y20![1]).toBeGreaterThan(origin.lat);
        expect(signedArea(outlineOf(doc))).toBeGreaterThan(0);
    });

    it('measures degrees on the WGS 84 ellipsoid', () => {
        // At 45°, a degree of latitude is 111,132 m and a degree of longitude 78,847 m.
        const doc = hall({ origin: { lat: 45, lng: 10 }, bearing: 0 });
        doc.levels[0]!.outline.outer = [
            [0, 0],
            [788.47, 0],
            [788.47, 1111.32],
        ];
        const [o, east, northEast] = outlineOf(doc);

        expect(o).toEqual([10, 45]);
        expect(east![0]).toBeCloseTo(10.01, 6);
        expect(northEast![1]).toBeCloseTo(45.01, 6);
    });

    it('turns the plan by its bearing, clockwise from north', () => {
        const doc = hall({ origin, bearing: 90 });
        const [, x40, , y20] = outlineOf(doc);

        // Bearing 90: up on the plan (+Y) points east, so +X points south.
        expect(y20![1]).toBeCloseTo(origin.lat, 8);
        expect(y20![0]).toBeGreaterThan(origin.lng);
        expect(x40![0]).toBeCloseTo(origin.lng, 8);
        expect(x40![1]).toBeLessThan(origin.lat);
        expect(signedArea(outlineOf(doc))).toBeGreaterThan(0);
    });
});
