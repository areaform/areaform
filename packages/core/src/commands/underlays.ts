import { EPSILON } from '../geometry/geometry.ts';
import { newId } from '../ids.ts';
import { Rejection } from '../checks/invariants.ts';
import type { AreaformDocument, Id, Underlay, Vec2 } from '../model.ts';
import { underlayToWorld } from '../geometry/queries.ts';
import {
    addElement,
    deleteElement,
    updateElement,
    withChanges,
    type Changes,
    type Input,
} from './shared.ts';

export interface UnderlayAdd {
    type: 'underlay.add';
    levelId: Id;
    underlay: Input<Underlay>;
}

export interface UnderlayUpdate {
    type: 'underlay.update';
    levelId: Id;
    underlayId: Id;
    changes: Changes<Underlay>;
}

export interface UnderlayDelete {
    type: 'underlay.delete';
    levelId: Id;
    underlayId: Id;
}

/**
 * Sets an Underlay's scale from two image pixels a known real distance apart, and optionally its
 * rotation, so the line between them points along `angle`. The first pixel stays where it was.
 */
export interface UnderlayCalibrate {
    type: 'underlay.calibrate';
    levelId: Id;
    underlayId: Id;
    pixels: [Vec2, Vec2];
    /** Metres between the two pixels. */
    distance: number;
    /** Radians, CCW from +X: the plan direction from the first pixel to the second. */
    angle?: number;
}

export type UnderlayCommand = UnderlayAdd | UnderlayUpdate | UnderlayDelete | UnderlayCalibrate;

export function applyUnderlayCommand(
    doc: AreaformDocument,
    command: UnderlayCommand,
): AreaformDocument {
    switch (command.type) {
        case 'underlay.add':
            return addElement(doc, command.levelId, 'underlays', {
                ...command.underlay,
                id: command.underlay.id ?? newId(),
            });
        case 'underlay.update':
            return updateElement(doc, command.levelId, 'underlays', command.underlayId, (u) =>
                withChanges(u, command.changes),
            );
        case 'underlay.calibrate':
            return updateElement(doc, command.levelId, 'underlays', command.underlayId, (u) =>
                calibrate(u, command),
            );
        case 'underlay.delete':
            return deleteElement(doc, command.levelId, 'underlays', command.underlayId);
    }
}

/** New scale (and rotation) from the calibration; `position` moves so the first pixel stays put. */
function calibrate(underlay: Underlay, { pixels, distance, angle }: UnderlayCalibrate): Underlay {
    const [first, second] = pixels;
    const pixelDistance = Math.hypot(second[0] - first[0], second[1] - first[1]);
    if (!(pixelDistance > EPSILON) || !(distance > 0) || !Number.isFinite(distance)) {
        throw new Rejection([{ code: 'invalid-underlay', id: underlay.id }]);
    }
    if (angle !== undefined && !Number.isFinite(angle)) {
        throw new Rejection([{ code: 'invalid-underlay', id: underlay.id }]);
    }
    const anchor = underlayToWorld(underlay, first);
    // Image pixels run Y-down; the line's direction in the image's own (Y-up) frame:
    const inImage = Math.atan2(-(second[1] - first[1]), second[0] - first[0]);
    const scaled = {
        ...underlay,
        position: [0, 0] as Vec2,
        scale: distance / pixelDistance,
        ...(angle !== undefined && { rotation: normalizeAngle(angle - inImage) }),
    };
    const offset = underlayToWorld(scaled, first);
    return { ...scaled, position: [anchor[0] - offset[0], anchor[1] - offset[1]] };
}

/** The same angle in (−π, π]. */
function normalizeAngle(radians: number): number {
    const turned = radians % (2 * Math.PI);
    if (turned > Math.PI) return turned - 2 * Math.PI;
    if (turned <= -Math.PI) return turned + 2 * Math.PI;
    return turned;
}
