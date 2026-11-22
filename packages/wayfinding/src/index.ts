// Wayfinding inside one Space (ADR-0017): the walkable area of each Level, walking routes on it,
// and routes between Levels through Connections.
import type { AreaformDocument, Id } from '@areaform/core';
import { walkableArea, type AreaOptions } from './area.ts';
import { triangulate, type NavMesh } from './mesh.ts';

export { DEFAULT_CLEARANCE, type AreaOptions } from './area.ts';
export type { NavMesh } from './mesh.ts';
export { locate, snap, type Placed, type Route } from './route.ts';
export { findRoute, type FoundRoute } from './walk.ts';
export {
    findSpaceRoute,
    isStepFree,
    RIDE_SECONDS,
    WALKING_SPEED,
    type Leg,
    type Ride,
    type SpaceRoute,
    type SpaceRouteOptions,
} from './space.ts';
export {
    exitsOf,
    inShape,
    isInside,
    OUTSIDE_CLEARANCE,
    placeOf,
    wayOutside,
    type Exit,
    type LevelPoint,
    type Place,
    type WayOut,
} from './place.ts';
export { unreachableZones, unreachableZonesOn, type UnreachableZone } from './reach.ts';

/**
 * The navmesh of one Level: where people can walk (the Outline minus Walls, Obstacles, Walk-around
 * Zones and Connection Stops, through the Openings in Walls), kept `clearance` away from what
 * blocks it. Build it once per Level and reuse it for every route there. Empty for a Level that
 * does not exist or has no floor left.
 */
export function buildNavMesh(
    doc: AreaformDocument,
    levelId: Id,
    options: AreaOptions = {},
): NavMesh {
    const level = doc.levels.find((l) => l.id === levelId);
    return triangulate(level ? walkableArea(doc, level, options) : []);
}
