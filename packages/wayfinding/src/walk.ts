// A walk on one Level's navmesh, from a point to a point.
import type { Vec2 } from '@areaform/core';
import type { NavMesh } from './mesh.ts';
import { locate, route, snap, type Route } from './route.ts';

export interface FoundRoute extends Route {
    /** Where the route starts: `from`, or the nearest point on the floor to it. */
    from: Vec2;
    /** Where it ends: `to`, or the nearest point to it that can be reached from the start. */
    to: Vec2;
}

/**
 * The walking route from `from` to `to` on one Level's navmesh. A start off the floor (a tap on a
 * Wall) moves to the nearest point on the floor. An end off the floor (inside a Walk-around Zone)
 * moves to the nearest point the start can reach, so a route to a booth ends at its edge. Null
 * when the end is on floor the start cannot reach (a room with no way in), or the mesh is empty.
 */
export function findRoute(mesh: NavMesh, from: Vec2, to: Vec2): FoundRoute | null {
    const start = snap(mesh, from);
    if (!start) return null;
    const component = mesh.components[start.triangle];
    const on = locate(mesh, to);
    if (on !== -1 && mesh.components[on] !== component) return null;
    const end = on !== -1 ? { point: to, triangle: on } : snap(mesh, to, component);
    if (!end) return null;
    const found = route(mesh, start, end);
    return found && { ...found, from: start.point, to: end.point };
}
