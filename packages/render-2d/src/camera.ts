import type { Vec2 } from '@areaform/core';

export interface Viewport {
    width: number;
    height: number;
}

export interface Box {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * What part of the plan is on screen. `zoom` is screen pixels per metre. Plan coordinates are
 * Y-up (ADR-0002); screen coordinates are Y-down, with the origin at the viewport's top-left.
 */
export interface Camera {
    viewport: Viewport;
    center: Vec2;
    zoom: number;
    minZoom: number;
    maxZoom: number;
}

export interface CameraOptions {
    viewport: Viewport;
    center?: Vec2;
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
}

export function createCamera(options: CameraOptions): Camera {
    return {
        viewport: options.viewport,
        center: options.center ?? [0, 0],
        zoom: options.zoom ?? 20,
        minZoom: options.minZoom ?? 0.5,
        maxZoom: options.maxZoom ?? 2000,
    };
}

export function worldToScreen(camera: Camera, [x, y]: Vec2): Vec2 {
    const { viewport, center, zoom } = camera;
    return [
        viewport.width / 2 + (x - center[0]) * zoom,
        viewport.height / 2 - (y - center[1]) * zoom,
    ];
}

export function screenToWorld(camera: Camera, [sx, sy]: Vec2): Vec2 {
    const { viewport, center, zoom } = camera;
    return [
        center[0] + (sx - viewport.width / 2) / zoom,
        center[1] - (sy - viewport.height / 2) / zoom,
    ];
}

/** Zooms by `factor`, keeping the plan point under `screenPoint` where it is. */
export function zoomAt(camera: Camera, screenPoint: Vec2, factor: number): Camera {
    const zoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, camera.zoom * factor));
    const anchor = screenToWorld(camera, screenPoint);
    const zoomed = { ...camera, zoom };
    const drift = screenToWorld(zoomed, screenPoint);
    return {
        ...zoomed,
        center: [camera.center[0] + anchor[0] - drift[0], camera.center[1] + anchor[1] - drift[1]],
    };
}

/** Moves the plan along with a pointer drag of `delta` screen pixels. */
export function panBy(camera: Camera, [dx, dy]: Vec2): Camera {
    return {
        ...camera,
        center: [camera.center[0] - dx / camera.zoom, camera.center[1] + dy / camera.zoom],
    };
}

/**
 * The camera after two fingers moved from `from` to `to` (screen points, in the same order): the
 * plan point under their middle follows it, and the zoom changes as the distance between them.
 */
export function pinchBy(camera: Camera, from: [Vec2, Vec2], to: [Vec2, Vec2]): Camera {
    const middle = ([a, b]: [Vec2, Vec2]): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const spread = ([a, b]: [Vec2, Vec2]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [m0, m1] = [middle(from), middle(to)];
    const before = spread(from);
    const factor = before > 0 ? spread(to) / before : 1;
    return zoomAt(panBy(camera, [m1[0] - m0[0], m1[1] - m0[1]]), m1, factor);
}

/** The parts of a DOM `WheelEvent` that decide what a wheel or trackpad gesture does. */
export interface WheelInput {
    deltaX: number;
    deltaY: number;
    /** 0 pixels, 1 lines, 2 pages. */
    deltaMode: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    /** The legacy `wheelDeltaY` (Chrome, Safari); used to tell a trackpad from a mouse wheel. */
    wheelDeltaY?: number;
}

/**
 * What scrolling does: `auto` pans on a two-finger trackpad scroll and zooms on a pinch or a mouse
 * wheel; `zoom` and `pan` always do the one thing (pinch and ⌘/Ctrl + scroll still zoom).
 */
export type WheelMode = 'auto' | 'zoom' | 'pan';

const LINE_PX = 16;

/** The camera after a wheel event at `screenPoint`. */
export function applyWheel(
    camera: Camera,
    screenPoint: Vec2,
    wheel: WheelInput,
    mode: WheelMode = 'auto',
): Camera {
    const scale =
        wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? camera.viewport.height : 1;
    const dx = wheel.deltaX * scale;
    const dy = wheel.deltaY * scale;
    // Browsers report a trackpad pinch as a wheel event with ctrlKey; its deltas are small.
    if (wheel.ctrlKey || wheel.metaKey) return zoomAt(camera, screenPoint, Math.exp(-dy * 0.01));
    const pans = mode === 'pan' || (mode === 'auto' && isTrackpad(wheel));
    if (pans) return panBy(camera, [-dx, -dy]);
    return zoomAt(camera, screenPoint, Math.exp(-dy * 0.0015));
}

/**
 * A heuristic: Chrome and Safari report `wheelDeltaY` as −3 × `deltaY` for trackpads only, and a
 * sideways component only comes from trackpads (or Shift + wheel, which pans too). Without
 * `wheelDeltaY` (Firefox), mice scroll by lines and trackpads by pixels.
 */
function isTrackpad({ deltaX, deltaY, deltaMode, wheelDeltaY }: WheelInput): boolean {
    if (deltaMode !== 0) return false;
    if (deltaX !== 0) return true;
    if (wheelDeltaY !== undefined && wheelDeltaY !== 0) return wheelDeltaY === -3 * deltaY;
    return true;
}

/**
 * Centres `box` and zooms so it fits with `padding` screen pixels on every side, in the part of
 * the viewport right of `insetLeft` screen pixels that something covers.
 */
export function fit(camera: Camera, box: Box, padding = 0, insetLeft = 0): Camera {
    const width = Math.max(box.maxX - box.minX, 1e-6);
    const height = Math.max(box.maxY - box.minY, 1e-6);
    const inset = Math.min(Math.max(0, insetLeft), camera.viewport.width / 2);
    const fitted = Math.min(
        (camera.viewport.width - inset - 2 * padding) / width,
        (camera.viewport.height - 2 * padding) / height,
    );
    const zoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, fitted));
    return {
        ...camera,
        // The box's middle at the middle of the uncovered part: half the inset right of centre.
        center: [(box.minX + box.maxX) / 2 - inset / 2 / zoom, (box.minY + box.maxY) / 2],
        zoom,
    };
}
