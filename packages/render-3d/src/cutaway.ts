// Walls cut away near the camera: pure maths, tested without WebGL. The Walls' vertex shader
// (threeRenderer.ts) lowers each Wall by the same rule, from the values worked out here.
import type { Vec3 } from './view.ts';

/** How tall a cut-away Wall stays, metres: a kerb that still shows where the Wall runs. */
export const KERB_HEIGHT = 0.3;
/** Over how far around the orbit target a Wall goes down, metres, so orbiting never pops. */
export const CUT_SOFTNESS = 1;
/** From straight down to this tilt, radians, Walls hide nothing and stand; past `CUT_FULL` they are cut. */
export const CUT_START = (8 * Math.PI) / 180;
export const CUT_FULL = (20 * Math.PI) / 180;
/**
 * How big a name of the Theme's label size shows at the target, as a share of the smallest label
 * drawn (`minLabelPx`): below `TEXT_START`, there is nothing to read yet and Walls stand as they
 * are; by `TEXT_FULL`, where names begin to fade in, they are down, so no name shows behind one.
 */
export const TEXT_START = 0.75;
export const TEXT_FULL = 1;

export interface Cutaway {
    /** The camera's view across the floor, world x and z, unit length (north when straight down). */
    direction: [number, number];
    /** How far Walls nearer than the target go down, 0 (not at all) to 1 (to the kerb). */
    amount: number;
}

/**
 * How to cut Walls for a camera at `position` looking at `target`. Given `textScale`, how big a
 * name of the Theme's label size shows at the target over `minLabelPx`, Walls are cut only as far
 * as names are about to be read, too; without it, by the tilt alone.
 */
export function cutawayOf(position: Vec3, target: Vec3, textScale?: number): Cutaway {
    const dx = target[0] - position[0];
    const dz = target[2] - position[2];
    const dy = position[1] - target[1];
    const across = Math.hypot(dx, dz);
    const polar = Math.atan2(across, dy);
    const tilted = smoothstep(CUT_START, CUT_FULL, polar);
    const readable = textScale === undefined ? 1 : smoothstep(TEXT_START, TEXT_FULL, textScale);
    return {
        direction: across > 1e-9 ? [dx / across, dz / across] : [0, -1],
        amount: tilted * readable,
    };
}

/**
 * How far a Wall anchored at `anchor` (world x, z) goes down, 0 to 1: fully when its middle is
 * nearer the camera than the target by `CUT_SOFTNESS`, not at all when it is as far beyond. The
 * shader computes the same.
 */
export function wallCut(anchor: [number, number], target: Vec3, cutaway: Cutaway): number {
    const depth =
        (anchor[0] - target[0]) * cutaway.direction[0] +
        (anchor[1] - target[2]) * cutaway.direction[1];
    return cutaway.amount * (1 - smoothstep(-CUT_SOFTNESS, CUT_SOFTNESS, depth));
}

/** As GLSL's `smoothstep`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
