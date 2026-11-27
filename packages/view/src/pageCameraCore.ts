// What the View needs of the camera driven by the page (ADR-0030) before the page moves it: the
// API's types, and `getCamera`'s 3D camera for the 2D plan. The rest is in `pageCamera.ts`, which
// the View loads on the page's first `flyTo`, `lookAt` or `setProgress`.
import type { Id } from '@areaform/core';
import type { Camera } from '@areaform/render-2d';
import { FOV, type Camera3D, type Vec3 } from '@areaform/render-3d';

/**
 * Where the page sends the camera: a Viewpoint's id, on any Level, or a camera as `getCamera`
 * gives it, in the 3D view's coordinates (metres; x east, y up, z south). A camera with a
 * `levelId` shows that Level first.
 */
export type CameraTarget = Id | { position: Vec3; target: Vec3; levelId?: Id };

/** What a flight's Promise resolves with: `interrupted` when something took the camera on the way. */
export interface FlightResult {
    interrupted: boolean;
}

/** How long a flight takes. */
export interface FlyToOptions {
    /** Seconds; 0 jumps there. A Viewpoint's own flight time, or 3, when absent (1.5 to turn). */
    seconds?: number;
}

/** How `lookAt` turns the camera, and how near it ends. */
export interface LookAtOptions extends FlyToOptions {
    /**
     * Metres from the camera to what it looks at, once there: the camera moves along its line of
     * sight as it turns (in 2D, the zoom that shows as much). By default a Zone ends up between
     * `ZONE_SHARE.min` and `ZONE_SHARE.max` of the view's shorter side, and a point keeps the
     * distance the camera has.
     */
    distance?: number;
}

/**
 * How much of the view's shorter side a Zone takes after `lookAt`: a smaller one brings the
 * camera closer, a bigger one sends it back, and one in between leaves the distance alone.
 */
export const ZONE_SHARE = { min: 0.4, max: 0.8 } as const;

/** Half the 3D view's vertical field of view, in radians. */
export const HALF_FOV = ((FOV / 2) * Math.PI) / 180;

/** A 3D camera straight above the 2D plan's centre, as far up as its zoom: `getCamera` in 2D. */
export function camera3dOf2d(camera: Camera, levelId: Id): Camera3D {
    const seen = Math.max(camera.viewport.height, 1) / camera.zoom;
    const distance = seen / (2 * Math.tan(HALF_FOV));
    const [x, y] = camera.center;
    return { position: [x, distance, -y], target: [x, 0, -y], levelId };
}
