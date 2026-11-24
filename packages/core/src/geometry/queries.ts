// Read-only helpers for consumers of a Document (View, 2.5D viewer). Pure functions of the data.
import { locateInShape, ringsOverlap, ringWithinShape } from './geometry.ts';
import type { Level, Opening, Ring, Shape, Underlay, Vec2, Viewpoint, Zone } from '../model.ts';

export interface Placement {
    position: Vec2;
    /** Radians, CCW from +X. For a hosted Opening, the direction of its Wall from `a` to `b`. */
    angle: number;
}

/** Where an Opening is on its Level, or null if its Wall or Wall Nodes are missing. */
export function resolveOpening(level: Level, opening: Opening): Placement | null {
    if (opening.host === 'free') return { position: opening.position, angle: opening.angle };

    const wall = level.walls.find((w) => w.id === opening.wallId);
    const a = wall && level.wallNodes.find((n) => n.id === wall.a)?.position;
    const b = wall && level.wallNodes.find((n) => n.id === wall.b)?.position;
    if (!a || !b) return null;

    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return {
        position: [
            a[0] + Math.cos(angle) * opening.offset,
            a[1] + Math.sin(angle) * opening.offset,
        ],
        angle,
    };
}

/** The Underlay image pixel at a plan point; the inverse of `underlayToWorld`. */
export function worldToUnderlay(underlay: Underlay, point: Vec2): Vec2 {
    const dx = point[0] - underlay.position[0];
    const dy = point[1] - underlay.position[1];
    const cos = Math.cos(underlay.rotation);
    const sin = Math.sin(underlay.rotation);
    const x = dx * cos + dy * sin;
    const y = -dx * sin + dy * cos;
    return [x / underlay.scale, -y / underlay.scale];
}

/** Plan coordinates (metres, Y-up) of a pixel of an Underlay's image. */
export function underlayToWorld(underlay: Underlay, pixel: Vec2): Vec2 {
    const x = pixel[0] * underlay.scale;
    const y = -pixel[1] * underlay.scale;
    const cos = Math.cos(underlay.rotation);
    const sin = Math.sin(underlay.rotation);
    return [underlay.position[0] + x * cos - y * sin, underlay.position[1] + x * sin + y * cos];
}

/**
 * The image's corners in plan metres, counter-clockwise from its bottom-left; undefined while the
 * image size is unknown.
 */
export function underlayCorners(underlay: Underlay): Ring | undefined {
    if (!underlay.size) return undefined;
    const [w, h] = underlay.size;
    const pixels: Vec2[] = [
        [0, h],
        [w, h],
        [w, 0],
        [0, 0],
    ];
    return pixels.map((p) => underlayToWorld(underlay, p));
}

/**
 * Where on the plan a Viewpoint's camera stands: behind its target, against its bearing, as far as
 * its distance reaches across the floor at its tilt. Straight down, above the target.
 */
export function viewpointSpot({ target, bearing, tilt, distance }: Viewpoint): Vec2 {
    const across = distance * Math.sin((Math.min(Math.max(tilt, 0), 90) * Math.PI) / 180);
    const angle = (bearing * Math.PI) / 180;
    return [target[0] - across * Math.sin(angle), target[1] - across * Math.cos(angle)];
}

/** The topmost Zone (last drawn) containing the point, edges included; holes are excluded. */
export function zoneAt(level: Level, point: Vec2): Zone | undefined {
    return level.zones.findLast((zone) => containsPoint(zone.shape, point));
}

/** Whether a point is inside a shape or on its edge; points in a hole are outside. */
export function containsPoint(shape: Shape, point: Vec2): boolean {
    return locateInShape(point, shape) !== 'outside';
}

/**
 * Whether a ring lies within a shape, touching its edge allowed: every edge, not just every
 * corner, stays inside, and the ring does not enclose any of the shape's holes.
 */
export function containsRing(shape: Shape, ring: Ring): boolean {
    return ringWithinShape(ring, shape);
}

/** Whether any two holes of a shape overlap; holes that only share edges or corners do not. */
export function holesOverlap(shape: Shape): boolean {
    const holes = shape.holes ?? [];
    return holes.some((hole, i) => holes.slice(i + 1).some((other) => ringsOverlap(hole, other)));
}
