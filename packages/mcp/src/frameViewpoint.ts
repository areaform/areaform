// `frame_viewpoint` (ADR-0025): a Viewpoint looking at Zones or a point from the angles asked,
// framed as the 3D view frames a Level, so the agent never guesses a distance.
import {
    boundingBox,
    isViewpointTilt,
    MAX_VIEWPOINT_TILT,
    type AreaformDocument,
    type Command,
    type Id,
    type Vec2,
    type Viewpoint,
} from '@areaform/core';
import { framePose } from '@areaform/render-3d';
import { DraftError } from './session.ts';

/** What to look at and from where; the angles are a Viewpoint's own. */
export interface FrameRequest extends Pick<Viewpoint, 'bearing' | 'tilt'> {
    levelId: Id;
    /** The Zones to show, by id; or else `point`. */
    zoneIds?: Id[];
    /** A plan point to look at, with `radius` metres around it in view. */
    point?: Vec2;
    radius?: number;
    /** The canvas's width for its height, e.g. 1.5 for 3 : 2 (the default). */
    aspect?: number;
    name?: string;
}

/** Around a point, when no radius is given: about a room. */
const DEFAULT_RADIUS = 5;

/** The Viewpoint, and the Command that adds it last in the Level's tour. */
export function frameViewpoint(
    doc: AreaformDocument,
    request: FrameRequest,
): { viewpoint: Omit<Viewpoint, 'id'>; command: Command } {
    const level = doc.levels.find((l) => l.id === request.levelId);
    if (!level) throw new DraftError(`There is no Level ${request.levelId}.`);
    let corners: Vec2[];
    if (request.zoneIds?.length) {
        const zones = request.zoneIds.map((id) => {
            const zone = level.zones.find((z) => z.id === id);
            if (!zone) throw new DraftError(`Level ${level.id} has no Zone ${id}.`);
            return zone;
        });
        corners = zones.flatMap((zone) => zone.shape.outer);
    } else if (request.point) {
        const r = request.radius ?? DEFAULT_RADIUS;
        if (!(r > 0)) throw new DraftError('radius must be more than 0.');
        const [x, y] = request.point;
        corners = [
            [x - r, y - r],
            [x + r, y + r],
        ];
    } else {
        throw new DraftError('Give zoneIds or a point to look at.');
    }
    if (!isViewpointTilt(request.tilt))
        throw new DraftError(
            `tilt is degrees from straight down: from 0 to ${MAX_VIEWPOINT_TILT}, where the 3D view stops above the floor.`,
        );

    const box = boundingBox(corners);
    const pose = framePose(
        { min: [box.minX, box.minY], max: [box.maxX, box.maxY], height: level.height },
        request.bearing,
        request.tilt,
        request.aspect,
    );
    const round = (value: number, digits: number) => Number(value.toFixed(digits));
    const viewpoint: Omit<Viewpoint, 'id'> = {
        ...(request.name && { name: request.name }),
        target: [round(pose.target[0], 2), round(pose.target[1], 2)],
        bearing: round(pose.bearing, 1),
        tilt: round(pose.tilt, 1),
        distance: round(pose.distance, 2),
    };
    return { viewpoint, command: { type: 'viewpoint.add', levelId: level.id, viewpoint } };
}
