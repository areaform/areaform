// Camera framing for the 3D view: pure maths, tested without WebGL.
import type { Id } from '@areaform/core';
import type { LevelMeshes } from './meshes.ts';

export type Vec3 = [number, number, number];

/** Where the 3D camera is, in world space (x east, y up, z south), and the Level it was framing. */
export interface Camera3D {
    position: Vec3;
    /** The point it orbits around and looks at. */
    target: Vec3;
    levelId: Id;
}

/** The camera's direction from its target. Angles as in Three.js's `Spherical`, radians. */
export interface Orbit {
    /** Around the vertical axis; 0 looks north from the south. */
    azimuth: number;
    /** From straight down (0) to level with the floor (π/2). */
    polar: number;
}

/** The named views: a ¾ view from the south, a little east, and straight down with north up. */
export type ViewPreset = 'perspective' | 'top';

export const VIEWS: Record<ViewPreset, Orbit> = {
    perspective: { azimuth: Math.PI / 8, polar: Math.PI / 4 },
    top: { azimuth: 0, polar: 1e-4 },
};

/** The 3D view's vertical field of view, degrees. */
export const FOV = 45;

/**
 * The camera's near plane for a camera `distance` metres from what it looks at, on a Level of
 * `radius`: a hundredth of the distance, so depth keeps its precision far away and the floor never
 * shows through a Zone; never below a two-thousandth of the Level, nor 5 cm.
 */
export function nearPlane(distance: number, radius: number): number {
    return Math.max(0.05, radius / 2000, distance / 100);
}

/** The lowest the camera may go: just above the floor, so it never looks from underneath. */
export const MAX_POLAR = Math.PI / 2 - 0.05;

export function orbitOf(position: Vec3, target: Vec3): Orbit {
    const [dx, dy, dz] = [
        position[0] - target[0],
        position[1] - target[1],
        position[2] - target[2],
    ];
    const r = Math.hypot(dx, dy, dz);
    if (r === 0) return VIEWS.perspective;
    return { azimuth: Math.atan2(dx, dz), polar: Math.acos(Math.min(1, Math.max(-1, dy / r))) };
}

type Bounds = LevelMeshes['bounds'];

/** Half the diagonal of the bounds; 1 m for an empty Level. */
export function radiusOf(bounds: Bounds): number {
    if (bounds.min[0] > bounds.max[0]) return 1;
    const r = Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
    );
    return Math.max(r / 2, 1);
}

/** The share of the view a framed Level may fill, so its edges keep clear of the canvas's. */
export const FRAME_FILL = 0.92;

/**
 * A camera looking from `orbit` at the bounds, just far enough away that all their corners are in
 * view, and centred on them as they appear on screen. `fov` is the vertical field of view in
 * degrees; `aspect` is width / height.
 */
export function frame(
    bounds: Bounds,
    orbit: Orbit,
    fov: number,
    aspect: number,
): { position: Vec3; target: Vec3 } {
    const polar = Math.min(orbit.polar, MAX_POLAR);
    const { azimuth } = orbit;
    // From the target towards the camera, then the camera's right and up, unit length.
    const back: Vec3 = [
        Math.sin(polar) * Math.sin(azimuth),
        Math.cos(polar),
        Math.sin(polar) * Math.cos(azimuth),
    ];
    const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
    const up: Vec3 = [
        back[1] * right[2] - back[2] * right[1],
        back[2] * right[0] - back[0] * right[2],
        back[0] * right[1] - back[1] * right[0],
    ];
    if (bounds.min[0] > bounds.max[0]) {
        const distance = 1 / Math.sin((fov * Math.PI) / 180 / 2);
        return { target: [0, 0, 0], position: back.map((b) => b * distance) as Vec3 };
    }

    const middle: Vec3 = [0, 1, 2].map((i) => (bounds.min[i]! + bounds.max[i]!) / 2) as Vec3;
    const tanUp = Math.tan((fov * Math.PI) / 180 / 2) * FRAME_FILL;
    const tanAcross = tanUp * aspect;
    // Each corner seen from the middle: across, up and towards the camera. A corner nearer the
    // camera needs more room, so it is checked against the view's edges at its own depth.
    const fit = { across: [Infinity, -Infinity], up: [Infinity, -Infinity] };
    for (const x of [bounds.min[0], bounds.max[0]])
        for (const y of [bounds.min[1], bounds.max[1]])
            for (const z of [bounds.min[2], bounds.max[2]]) {
                const p: Vec3 = [x - middle[0], y - middle[1], z - middle[2]];
                const depth = dot(p, back);
                const across = dot(p, right);
                const height = dot(p, up);
                fit.across = [
                    Math.min(fit.across[0]!, across - tanAcross * depth),
                    Math.max(fit.across[1]!, across + tanAcross * depth),
                ];
                fit.up = [
                    Math.min(fit.up[0]!, height - tanUp * depth),
                    Math.max(fit.up[1]!, height + tanUp * depth),
                ];
            }
    // The distance each pair of view edges needs, and the shift that centres the corners between them.
    const distance = Math.max(
        (fit.across[1]! - fit.across[0]!) / (2 * tanAcross),
        (fit.up[1]! - fit.up[0]!) / (2 * tanUp),
        0.5,
    );
    const shiftAcross = (fit.across[0]! + fit.across[1]!) / 2;
    const shiftUp = (fit.up[0]! + fit.up[1]!) / 2;
    const target = [0, 1, 2].map(
        (i) => middle[i]! + right[i]! * shiftAcross + up[i]! * shiftUp,
    ) as Vec3;
    return {
        target,
        position: [0, 1, 2].map((i) => target[i]! + back[i]! * distance) as Vec3,
    };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
