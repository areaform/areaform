// What the pointer is on in the 3D view: pure maths, tested without WebGL. A ray from the camera
// is cast against what stands on the Level (Walls as drawn, lowered ones included, Obstacles and
// Stops), then against the floor, where Openings and Zones are found as in 2D.
import {
    containsPoint,
    resolveOpening,
    zoneAt,
    type AreaformDocument,
    type ElementRef,
    type Level,
    type Ring,
    type Shape,
    type Vec2,
} from '@areaform/core';
import { KERB_HEIGHT } from './cutaway.ts';
import { wallPieces, type WallPiece } from './meshes.ts';
import type { Theme3D } from './theme3d.ts';
import type { Vec3 } from './view.ts';

/** A ray in world space (x east, y up, z south); `direction` need not be unit length. */
export interface Ray {
    origin: Vec3;
    direction: Vec3;
}

export interface PickOptions {
    theme3d: Theme3D;
    doorHeight: number;
}

/** How far each Wall is lowered towards the kerb, 0–1, by its anchor (plan metres). */
export type WallCut = (anchor: Vec2) => number;

export interface Pick {
    /** The Element hit, or null for the bare floor, the ground outside, or the sky. */
    ref: ElementRef | null;
    /** Where the ray hit, plan metres; null when it hit nothing at all (the sky). */
    point: Vec2 | null;
    /** How far along the ray it hit, in multiples of `direction`; Infinity for the sky. */
    distance: number;
}

/**
 * Finds the nearest thing along a ray on one Level: something standing, else what lies on the
 * floor. The Wall pieces are worked out once, so picking on every pointer move stays cheap.
 */
export function createPicker(
    doc: AreaformDocument,
    level: Level,
    options: PickOptions,
    /** The Level's Wall pieces when already worked out, e.g. by `buildLevelMeshes`. */
    pieces: WallPiece[] = wallPieces(level, options.doorHeight),
): (ray: Ray, cut?: WallCut) => Pick {
    return (ray, cut) => pick(doc, level, pieces, ray, options, cut);
}

function pick(
    doc: AreaformDocument,
    level: Level,
    pieces: WallPiece[],
    ray: Ray,
    options: PickOptions,
    wallCut?: WallCut,
): Pick {
    const levelId = level.id;
    let nearest = Infinity;
    let ref: ElementRef | null = null;
    const consider = (shape: Shape, bottom: number, top: number, hit: ElementRef) => {
        const t = rayPrism(ray, shape, bottom, top);
        if (t < nearest) {
            nearest = t;
            ref = hit;
        }
    };

    for (const piece of pieces) {
        const cut = wallCut?.(piece.anchor) ?? 0;
        const lower = (y: number) => y + (Math.min(y, KERB_HEIGHT) - y) * cut;
        const [bottom, top] = [lower(piece.bottom), lower(piece.top)];
        if (top - bottom > 1e-3)
            consider({ outer: piece.shape }, bottom, top, {
                kind: 'wall',
                id: piece.wallId,
                levelId,
            });
    }
    for (const obstacle of level.obstacles) {
        if (obstacle.kind === 'void') continue;
        consider(obstacle.shape, 0, level.height, { kind: 'obstacle', id: obstacle.id, levelId });
    }
    for (const connection of doc.connections) {
        const height = options.theme3d.connections[connection.kind].height ?? level.height;
        for (const stop of connection.stops)
            if (stop.levelId === levelId)
                consider(stop.shape, 0, height, { kind: 'stop', id: connection.id, levelId });
    }

    const [ox, oy, oz] = ray.origin;
    const [dx, dy, dz] = ray.direction;
    const floor = dy < 0 ? -oy / dy : Infinity;
    if (floor < nearest) {
        const point: Vec2 = [ox + dx * floor, -(oz + dz * floor)];
        return { ref: floorAt(level, point), point, distance: floor };
    }
    if (nearest === Infinity) return { ref: null, point: null, distance: Infinity };
    return { ref, point: [ox + dx * nearest, -(oz + dz * nearest)], distance: nearest };
}

/** What lies on the floor at a plan point: an Opening's strip, then the topmost Zone. */
function floorAt(level: Level, point: Vec2): ElementRef | null {
    const levelId = level.id;
    const thickness = new Map(level.walls.map((w) => [w.id, w.thickness]));
    const opening = level.openings.findLast((o) => {
        const placement = resolveOpening(level, o);
        if (!placement) return false;
        const dx = point[0] - placement.position[0];
        const dy = point[1] - placement.position[1];
        const cos = Math.cos(placement.angle);
        const sin = Math.sin(placement.angle);
        const depth = o.host === 'wall' ? (thickness.get(o.wallId) ?? 0) : 0;
        return (
            Math.abs(dx * cos + dy * sin) <= o.width / 2 &&
            Math.abs(-dx * sin + dy * cos) <= depth / 2
        );
    });
    if (opening) return { kind: 'opening', id: opening.id, levelId };
    const zone = zoneAt(level, point);
    return zone ? { kind: 'zone', id: zone.id, levelId } : null;
}

/**
 * How far along the ray (in multiples of `direction`) it first meets a shape stood up from
 * `bottom` to `top`: its top, its underside or a side. Infinity when it misses.
 */
export function rayPrism(ray: Ray, shape: Shape, bottom: number, top: number): number {
    if (!crossesBox(ray, shape.outer, bottom, top)) return Infinity;
    const [ox, oy, oz] = ray.origin;
    const [dx, dy, dz] = ray.direction;
    let nearest = Infinity;
    if (dy !== 0) {
        for (const y of [top, bottom]) {
            const t = (y - oy) / dy;
            if (t > 0 && t < nearest && containsPoint(shape, [ox + dx * t, -(oz + dz * t)]))
                nearest = t;
        }
    }
    for (const ring of [shape.outer, ...(shape.holes ?? [])]) {
        for (let i = 0; i < ring.length; i++) {
            const [px, py] = ring[i]!;
            const [qx, qy] = ring[(i + 1) % ring.length]!;
            // The side's foot from P to Q in world x, z.
            const ex = qx - px;
            const ez = -qy + py;
            const denominator = dx * ez - dz * ex;
            if (Math.abs(denominator) < 1e-12) continue;
            const wx = px - ox;
            const wz = -py - oz;
            const t = (wx * ez - wz * ex) / denominator;
            const s = (wx * dz - wz * dx) / denominator;
            if (t <= 0 || t >= nearest || s < 0 || s > 1) continue;
            const y = oy + dy * t;
            if (y >= bottom && y <= top) nearest = t;
        }
    }
    return nearest;
}

/** Whether the ray passes through the shape's bounding box at all (the slab test). */
function crossesBox(ray: Ray, ring: Ring, bottom: number, top: number): boolean {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (-y < minZ) minZ = -y;
        if (-y > maxZ) maxZ = -y;
    }
    let near = 0;
    let far = Infinity;
    const slabs: [number, number, number, number][] = [
        [ray.origin[0], ray.direction[0], minX, maxX],
        [ray.origin[1], ray.direction[1], bottom, top],
        [ray.origin[2], ray.direction[2], minZ, maxZ],
    ];
    for (const [o, d, lo, hi] of slabs) {
        if (Math.abs(d) < 1e-12) {
            if (o < lo || o > hi) return false;
            continue;
        }
        let t0 = (lo - o) / d;
        let t1 = (hi - o) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        near = Math.max(near, t0);
        far = Math.min(far, t1);
        if (near > far + 1e-9) return false;
    }
    return true;
}
