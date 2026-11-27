// The camera driven by the page (ADR-0030): what a host's `flyTo`, `lookAt` and `setProgress` name, found in
// the Document, and the 2D plan's pan and zoom for a 3D camera. Pure, so it is tested without a
// browser; the View moves the renderers. The View loads this module on the page's first move, so
// a page that never moves the camera does not download it: what it needs at once is in
// `pageCameraCore.ts`.
import {
    boundingBox,
    type AreaformDocument,
    type Id,
    type Vec2,
    type Viewpoint,
} from '@areaform/core';
import type { Camera, Viewport } from '@areaform/render-2d';
import { ease, type Camera3D, type Vec3 } from '@areaform/render-3d';
import { HALF_FOV, ZONE_SHARE } from './pageCameraCore.ts';

export {
    camera3dOf2d,
    ZONE_SHARE,
    type CameraTarget,
    type FlightResult,
    type FlyToOptions,
    type LookAtOptions,
} from './pageCameraCore.ts';
// The 3D view's own pose helpers, loaded with the rest of the page's camera.
export { cameraOfPose, DEFAULT_FLIGHT, poseAlong } from '@areaform/render-3d';

/** The Viewpoint with this id, and its Level. */
export function findViewpoint(
    doc: AreaformDocument,
    id: Id,
): { viewpoint: Viewpoint; levelId: Id } | null {
    for (const level of doc.levels) {
        const viewpoint = level.viewpoints?.find((v) => v.id === id);
        if (viewpoint) return { viewpoint, levelId: level.id };
    }
    return null;
}

/** The middle of the Zone with this id, how big it is, and its Level. */
export function findZone(
    doc: AreaformDocument,
    id: Id,
): { center: Vec2; size: Vec2; levelId: Id } | null {
    for (const level of doc.levels) {
        const zone = level.zones.find((z) => z.id === id);
        if (!zone) continue;
        const box = boundingBox(zone.shape.outer);
        return {
            center: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2],
            size: [box.maxX - box.minX, box.maxY - box.minY],
            levelId: level.id,
        };
    }
    return null;
}

/**
 * The 2D plan's centre and zoom showing what a 3D camera does: the point it looks at in the
 * middle, and the plan as wide across as the camera sees at that distance.
 */
export function camera2dOf(
    camera: Pick<Camera3D, 'position' | 'target'>,
    viewportHeight: number,
): { center: Vec2; zoom: number } {
    const { target } = camera;
    return {
        center: [target[0], -target[2]],
        zoom: zoomAtDistance(cameraDistance(camera), viewportHeight),
    };
}

/** Metres from a camera to the point it looks at. */
export function cameraDistance({
    position,
    target,
}: Pick<Camera3D, 'position' | 'target'>): number {
    return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
}

/** The 2D zoom that shows as much of the plan as a 3D camera this far away sees. */
export function zoomAtDistance(distance: number, viewportHeight: number): number {
    const seen = 2 * Math.max(distance, 0.01) * Math.tan(HALF_FOV);
    return Math.max(viewportHeight, 1) / seen;
}

/**
 * The 2D camera `t` (0 to 1, eased) of the way from `from` to `to`: the centre along a line, the
 * zoom by ratio so it feels even, within the camera's zoom limits.
 */
export function camera2dAt(from: Camera, to: { center: Vec2; zoom: number }, t: number): Camera {
    const e = ease(t);
    const limit = (zoom: number) => Math.min(from.maxZoom, Math.max(from.minZoom, zoom));
    const end = limit(to.zoom);
    return {
        ...from,
        center: [
            from.center[0] + (to.center[0] - from.center[0]) * e,
            from.center[1] + (to.center[1] - from.center[1]) * e,
        ],
        zoom: from.zoom * (end / from.zoom) ** e,
    };
}

/** How many times the shorter side of the view a Zone `size` (metres) takes at `zoom`. */
function shareAt(size: Vec2, zoom: number, viewport: Viewport): number {
    const side = Math.max(1, Math.min(viewport.width, viewport.height));
    return (Math.max(size[0], size[1], 0.01) * zoom) / side;
}

/** How much the zoom changes for a Zone taking `share` of the view to take within `ZONE_SHARE`. */
function zoomFactorFor(share: number): number {
    return Math.min(Math.max(share, ZONE_SHARE.min), ZONE_SHARE.max) / share;
}

/**
 * The 2D zoom after `lookAt` a Zone `size` (metres): the zoom now, unless the Zone would take
 * less than `ZONE_SHARE.min` or more than `ZONE_SHARE.max` of the view's shorter side.
 */
export function zoomToShow(camera: Camera, size: Vec2): number {
    return camera.zoom * zoomFactorFor(shareAt(size, camera.zoom, camera.viewport));
}

/**
 * The 3D camera's distance after `lookAt` a Zone `size` (metres), from `current`, by the same
 * rule as `zoomToShow`, on a view `viewport` in size.
 */
export function distanceToShow(size: Vec2, current: number, viewport: Viewport): number {
    // The 3D view sees as much across its height as the 2D plan at the matching zoom.
    const zoom = zoomAtDistance(current, viewport.height);
    return current / zoomFactorFor(shareAt(size, zoom, viewport));
}

/** Where a camera at `position` ends up `distance` from `target`, along the line between them. */
export function positionAtDistance(position: Vec3, target: Vec3, distance: number): Vec3 {
    const back: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
    const length = Math.hypot(...back);
    // A camera on its target has no line: it goes straight up.
    if (length < 1e-9) return [target[0], target[1] + distance, target[2]];
    const k = Math.max(distance, 0.01) / length;
    return [target[0] + back[0] * k, target[1] + back[1] * k, target[2] + back[2] * k];
}
