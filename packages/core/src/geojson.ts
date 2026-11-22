// Export to GeoJSON (RFC 7946), so a plan opens in map and GIS tools. Pure: no dependencies.
import { lngLatProjection } from './georeference.ts';
import { normalizeShape } from './geometry.ts';
import type {
    AreaformDocument,
    Georeference,
    Id,
    Level,
    Opening,
    Ring,
    Shape,
    Vec2,
} from './model.ts';
import { resolveOpening } from './queries.ts';
import { wallOutlines } from './wallOutlines.ts';

/** `[longitude, latitude]` in degrees, or `[x, y]` in metres for a plan without `geo`. */
export type GeoPosition = [number, number];

export type GeoGeometry =
    | { type: 'Polygon'; coordinates: GeoPosition[][] }
    | { type: 'LineString'; coordinates: GeoPosition[] };

/** What a Feature stands for, in its `featureType` property. */
export type GeoFeatureType = 'level' | 'wall' | 'opening' | 'zone' | 'obstacle' | 'stop';

export interface GeoFeature {
    type: 'Feature';
    id: string;
    geometry: GeoGeometry;
    properties: {
        featureType: GeoFeatureType;
        /** The Level the Feature is on. */
        levelId: Id;
        /** That Level's Ordinal, to show one storey at a time. */
        ordinal: number;
        [key: string]: unknown;
    };
}

export interface GeoFeatureCollection {
    type: 'FeatureCollection';
    /** The plan's name; GDAL and QGIS name the layer after it. */
    name: string;
    /**
     * `wgs84` when the plan has a georeference (`geo`) and the coordinates are longitude and
     * latitude, as RFC 7946 requires. `local` otherwise: metres on the plan's own plane, which
     * code can use but a map would place near 0°, 0°.
     */
    coordinateSystem: 'wgs84' | 'local';
    features: GeoFeature[];
}

/**
 * The plan as one GeoJSON FeatureCollection: each Level's Outline, and the Walls (as their
 * outlines, with thickness and joins), Openings (a line across their width), Zones, Obstacles and
 * Connection Stops on it. Every Feature carries its `featureType`, `levelId` and `ordinal`.
 */
export function toGeoJSON(doc: AreaformDocument): GeoFeatureCollection {
    const project = doc.geo
        ? toLngLat(doc.geo)
        : (p: Vec2): GeoPosition => [round(p[0], 4), round(p[1], 4)];
    const polygon = (shape: Shape): GeoGeometry => {
        const { outer, holes = [] } = normalizeShape(shape);
        return {
            type: 'Polygon',
            coordinates: [outer, ...holes].map((ring) => closed(ring, project)),
        };
    };

    const features: GeoFeature[] = [];
    for (const level of doc.levels) {
        const on = (featureType: GeoFeatureType, id: string, geometry: GeoGeometry, more: object) =>
            features.push({
                type: 'Feature',
                id,
                geometry,
                properties: { featureType, levelId: level.id, ordinal: level.ordinal, ...more },
            });

        on('level', level.id, polygon(level.outline), {
            name: level.name,
            ...(level.names && { names: level.names }),
            ...(level.group !== undefined && { group: level.group }),
            elevation: level.elevation,
            height: level.height,
        });

        const outlines = wallOutlines(level);
        for (const wall of level.walls) {
            const outline = outlines.get(wall.id);
            if (!outline) continue;
            on('wall', wall.id, polygon(outline), {
                thickness: wall.thickness,
                height: wall.height ?? level.height,
            });
        }

        for (const opening of level.openings) {
            const ends = openingEnds(level, opening);
            if (!ends) continue;
            on(
                'opening',
                opening.id,
                { type: 'LineString', coordinates: ends.map(project) },
                {
                    kind: opening.kind,
                    width: opening.width,
                    ...(opening.host === 'wall' && { wallId: opening.wallId }),
                },
            );
        }

        for (const zone of level.zones) {
            on('zone', zone.id, polygon(zone.shape), {
                ...(zone.label !== undefined && { label: zone.label }),
                ...(zone.labels && { labels: zone.labels }),
                ...(zone.category !== undefined && { category: zone.category }),
                ...(zone.restricted !== undefined && { restricted: zone.restricted }),
                ...(zone.walkAround !== undefined && { walkAround: zone.walkAround }),
                ...(zone.data && { data: zone.data }),
            });
        }

        for (const obstacle of level.obstacles) {
            on('obstacle', obstacle.id, polygon(obstacle.shape), { kind: obstacle.kind });
        }

        for (const connection of doc.connections) {
            for (const stop of connection.stops) {
                if (stop.levelId !== level.id) continue;
                on('stop', `${connection.id}@${level.id}`, polygon(stop.shape), {
                    connectionId: connection.id,
                    kind: connection.kind,
                    ...(connection.name !== undefined && { name: connection.name }),
                    ...(connection.names && { names: connection.names }),
                    bidirectional: connection.bidirectional,
                    ...(connection.accessible !== undefined && {
                        accessible: connection.accessible,
                    }),
                });
            }
        }
    }

    return {
        type: 'FeatureCollection',
        name: doc.name,
        coordinateSystem: doc.geo ? 'wgs84' : 'local',
        features,
    };
}

/** The two ends of an Opening, across its width; null when its Wall is missing. */
function openingEnds(level: Level, opening: Opening): [Vec2, Vec2] | null {
    const placement = resolveOpening(level, opening);
    if (!placement) return null;
    const {
        position: [x, y],
        angle,
    } = placement;
    const dx = (Math.cos(angle) * opening.width) / 2;
    const dy = (Math.sin(angle) * opening.width) / 2;
    return [
        [x - dx, y - dy],
        [x + dx, y + dy],
    ];
}

/** RFC 7946 rings repeat their first position at the end; ours do not. */
function closed(ring: Ring, project: (p: Vec2) => GeoPosition): GeoPosition[] {
    const positions = ring.map(project);
    return [...positions, positions[0]!];
}

/** Longitude and latitude to about a millimetre, the precision a plan has. */
function toLngLat(geo: Georeference): (p: Vec2) => GeoPosition {
    const project = lngLatProjection(geo);
    return (p) => {
        const [lng, lat] = project(p);
        return [round(lng, 8), round(lat, 8)];
    };
}

const round = (value: number, digits: number) => {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale + 0;
};
