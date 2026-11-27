// A camera tour through a Level's Viewpoints (ADR-0025): pure maths, tested without WebGL. The
// camera flies in orbit terms (the point it looks at, the bearing the short way round, the tilt,
// the distance), so it arcs over the plan instead of cutting through Walls, and never goes below
// the floor.
import { MAX_VIEWPOINT_TILT, type Id, type Vec2, type Viewpoint } from '@areaform/core';
import { FOV, frame, MAX_POLAR, type Camera3D, type Vec3 } from './view.ts';

/** A camera in a Viewpoint's terms, without its name or times: plan metres and compass degrees. */
export type Pose = Pick<Viewpoint, 'target' | 'bearing' | 'tilt' | 'distance'>;

/** Seconds a tour flies to a Viewpoint that has no `flight` of its own. */
export const DEFAULT_FLIGHT = 3;
/** Seconds a tour stays at a Viewpoint that has no `pause` of its own. */
export const DEFAULT_PAUSE = 2;

const RAD = Math.PI / 180;
const MAX_TILT = MAX_POLAR / RAD;

/** The camera a Pose stands for, in world space (x east, y up, z south). */
export function cameraOfPose(pose: Pose, levelId: Id): Camera3D {
    const azimuth = -pose.bearing * RAD;
    const polar = Math.min(Math.max(pose.tilt, 0), MAX_TILT) * RAD;
    const target: Vec3 = [pose.target[0], 0, -pose.target[1]];
    const position: Vec3 = [
        target[0] + pose.distance * Math.sin(polar) * Math.sin(azimuth),
        pose.distance * Math.cos(polar),
        target[2] + pose.distance * Math.sin(polar) * Math.cos(azimuth),
    ];
    return { position, target, levelId };
}

/**
 * The Pose of a camera, its target moved along the line of sight down to the floor, so the view
 * stays the same: what the Editor saves as a Viewpoint.
 */
export function poseOfCamera({ position, target }: Camera3D): Pose {
    const back: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
    const length = Math.hypot(...back) || 1;
    const up = back[1] / length;
    // Along the line of sight to the floor; a camera level with the floor keeps its target.
    const slide = up > 1e-6 ? target[1] / up : 0;
    const floor: Vec3 = [
        target[0] - (back[0] / length) * slide,
        0,
        target[2] - (back[2] / length) * slide,
    ];
    const distance = Math.hypot(
        position[0] - floor[0],
        position[1] - floor[1],
        position[2] - floor[2],
    );
    const azimuth = Math.atan2(position[0] - floor[0], position[2] - floor[2]);
    return {
        target: [floor[0], -floor[2]],
        bearing: normalizeBearing(-azimuth / RAD),
        // The 3D view goes a hair lower than a Viewpoint may; to the eye the view is the same.
        tilt: Math.min(
            Math.acos(Math.min(1, Math.max(-1, (position[1] - floor[1]) / (distance || 1)))) / RAD,
            MAX_VIEWPOINT_TILT,
        ),
        distance,
    };
}

/**
 * A Pose looking from `bearing` and `tilt` at a box on the plan (`min` and `max` corners, metres,
 * and a height for Walls), just far enough away that it fills the view as the 3D view frames a
 * Level, on a canvas `aspect` wide for its height (3 : 2 by default).
 */
export function framePose(
    box: { min: Vec2; max: Vec2; height: number },
    bearing: number,
    tilt: number,
    aspect = 1.5,
): Pose {
    const bounds = {
        min: [box.min[0], 0, -box.max[1]] as Vec3,
        max: [box.max[0], box.height, -box.min[1]] as Vec3,
    };
    const polar = Math.min(Math.max(tilt, 0) * RAD, MAX_POLAR);
    const { position, target } = frame(bounds, { azimuth: -bearing * RAD, polar }, FOV, aspect);
    const pose = poseOfCamera({ position, target, levelId: '' });
    // The angles asked for, as they were given, rather than as worked back from the camera.
    return {
        ...pose,
        bearing: normalizeBearing(bearing),
        tilt: Math.min(polar / RAD, MAX_VIEWPOINT_TILT),
    };
}

/** A Viewpoint's Pose alone, without its id, name and times. */
function poseOf(viewpoint: Viewpoint): Pose {
    const { target, bearing, tilt, distance } = viewpoint;
    return { target, bearing, tilt, distance };
}

/** Eased in and out: slow off the start, slow onto the end. */
export function ease(t: number): number {
    const x = Math.min(Math.max(t, 0), 1);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * Between two Poses at `t` from 0 to 1 (not eased): the target along a straight line, the bearing
 * the short way round, the tilt evenly, and the distance by ratio, so zooming feels even.
 */
export function between(a: Pose, b: Pose, t: number): Pose {
    const turn = ((((b.bearing - a.bearing) % 360) + 540) % 360) - 180;
    return {
        target: [
            a.target[0] + (b.target[0] - a.target[0]) * t,
            a.target[1] + (b.target[1] - a.target[1]) * t,
        ],
        bearing: normalizeBearing(a.bearing + turn * t),
        tilt: a.tilt + (b.tilt - a.tilt) * t,
        distance: a.distance * (b.distance / a.distance) ** t,
    };
}

/** Where a tour is: the Pose, and the Viewpoint it flies to or stays at. */
export interface TourState {
    pose: Pose;
    /** The Viewpoint it flies to or stays at. */
    index: number;
    /** It is at that Viewpoint, staying there, rather than on its way. */
    arrived: boolean;
    /** A tour of one Viewpoint has arrived and ends there. */
    done: boolean;
}

/** Where a stopped tour would go on: the Viewpoint after the one it reached, else the one it flew to. */
export function nextIndex(state: Pick<TourState, 'index' | 'arrived'>, count: number): number {
    if (count === 0) return 0;
    return state.arrived ? (state.index + 1) % count : state.index;
}

/**
 * The tour `seconds` after it started from `start`: it flies to the first Viewpoint, stays, flies
 * to the next, and after the last back to the first, round and round. With one Viewpoint it flies
 * there and is done.
 */
export function tourAt(start: Pose, viewpoints: Viewpoint[], seconds: number): TourState {
    const stops = viewpoints.map((v) => ({
        pose: poseOf(v),
        flight: Math.max(0, v.flight ?? DEFAULT_FLIGHT),
        pause: Math.max(0, v.pause ?? DEFAULT_PAUSE),
    }));
    if (stops.length === 0) return { pose: start, index: 0, arrived: true, done: true };
    const legs = (from: Pose) =>
        stops.map((stop, i) => ({ ...stop, from: i === 0 ? from : stops[i - 1]!.pose }));
    const length = stops.reduce((sum, s) => sum + s.flight + s.pause, 0);

    let t = Math.max(0, seconds);
    let route = legs(start);
    if (t >= length) {
        if (stops.length === 1)
            return { pose: stops[0]!.pose, index: 0, arrived: true, done: true };
        // After the first round, each starts from the last Viewpoint; a round of no time stays put.
        if (length === 0)
            return {
                pose: stops.at(-1)!.pose,
                index: stops.length - 1,
                arrived: true,
                done: false,
            };
        t = (t - length) % length;
        route = legs(stops.at(-1)!.pose);
    }
    for (const [index, leg] of route.entries()) {
        if (t < leg.flight)
            return {
                pose: between(leg.from, leg.pose, ease(t / leg.flight)),
                index,
                arrived: false,
                done: false,
            };
        t -= leg.flight;
        if (t < leg.pause) return { pose: leg.pose, index, arrived: true, done: false };
        t -= leg.pause;
    }
    return {
        pose: stops.at(-1)!.pose,
        index: stops.length - 1,
        arrived: true,
        done: stops.length === 1,
    };
}

/**
 * The Pose `t` of the way along these Viewpoints, from 0 at the first to 1 at the last, for a
 * page scrubbing the camera as it scrolls. Each leg between two Viewpoints is an equal share of
 * `t`, eased as a tour flies it, so a scroll settles on each Viewpoint. Null without any.
 */
export function poseAlong(viewpoints: readonly Viewpoint[], t: number): Pose | null {
    const poses = viewpoints.map(poseOf);
    if (poses.length === 0) return null;
    if (poses.length === 1) return poses[0]!;
    const legs = poses.length - 1;
    const at = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1) * legs;
    const leg = Math.min(Math.floor(at), legs - 1);
    return between(poses[leg]!, poses[leg + 1]!, ease(at - leg));
}

/**
 * How a flight goes: `arc` flies in orbit terms, as a tour does, over the plan rather than through
 * Walls; `line` swings the target across and moves the camera in a straight line, if at all, e.g.
 * along its line of sight to come closer (`lookAt`).
 */
export type FlightPath = 'arc' | 'line';

/** The camera of a flight `t` (0 to 1, not eased) of the way from `from` to `to`, on Level `levelId`. */
export function flightAt(
    from: Camera3D,
    to: Camera3D,
    t: number,
    path: FlightPath,
    levelId: Id,
): Camera3D {
    const e = ease(t);
    if (e >= 1) return { position: to.position, target: to.target, levelId };
    if (path === 'line') {
        const along = (a: Vec3, b: Vec3): Vec3 => [
            a[0] + (b[0] - a[0]) * e,
            a[1] + (b[1] - a[1]) * e,
            a[2] + (b[2] - a[2]) * e,
        ];
        return {
            position: along(from.position, to.position),
            target: along(from.target, to.target),
            levelId,
        };
    }
    return cameraOfPose(between(poseOfCamera(from), poseOfCamera(to), e), levelId);
}

function normalizeBearing(degrees: number): number {
    const d = degrees % 360;
    // `+ 0` turns −0 into 0.
    return d < 0 ? d + 360 : d + 0;
}
