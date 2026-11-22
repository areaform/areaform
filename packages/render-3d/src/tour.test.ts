import { MAX_VIEWPOINT_TILT, type Viewpoint } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    between,
    cameraOfPose,
    ease,
    framePose,
    nextIndex,
    poseOfCamera,
    tourAt,
    type Pose,
} from './tour.ts';
import { MAX_POLAR, orbitOf, VIEWS } from './view.ts';

const close = (actual: number[], expected: number[]) =>
    actual.forEach((v, i) => expect(v, `[${i}]`).toBeCloseTo(expected[i]!, 6));

const viewpoint = (id: string, pose: Partial<Pose>, times: Partial<Viewpoint> = {}): Viewpoint => ({
    id,
    target: [0, 0],
    bearing: 0,
    tilt: 45,
    distance: 10,
    ...pose,
    ...times,
});

describe('cameraOfPose', () => {
    it('looking north puts the camera south of its target, as the ¾ view from the south does', () => {
        const camera = cameraOfPose({ target: [5, 5], bearing: 0, tilt: 45, distance: 10 }, 'L1');

        // Plan (5, 5) is world (5, 0, −5); south is +z.
        close(camera.target, [5, 0, -5]);
        close(camera.position, [5, 10 * Math.SQRT1_2, -5 + 10 * Math.SQRT1_2]);
        expect(orbitOf(camera.position, camera.target).azimuth).toBeCloseTo(0);
    });

    it('looking east puts it west of the target; straight down puts it above', () => {
        const east = cameraOfPose({ target: [0, 0], bearing: 90, tilt: 90, distance: 10 }, 'L1');
        // Tilt stops just short of level with the floor, as the 3D view does.
        expect(east.position[0]).toBeLessThan(-9.9);
        expect(east.position[1]).toBeGreaterThan(0);

        const down = cameraOfPose({ target: [0, 0], bearing: 0, tilt: 0, distance: 10 }, 'L1');
        close(down.position, [0, 10, 0]);
    });
});

describe('poseOfCamera', () => {
    it('gives back the Pose a camera was made from', () => {
        const pose: Pose = { target: [3, -4], bearing: 225, tilt: 60, distance: 25 };

        const back = poseOfCamera(cameraOfPose(pose, 'L1'));

        close(back.target, pose.target);
        expect(back.bearing).toBeCloseTo(225);
        expect(back.tilt).toBeCloseTo(60);
        expect(back.distance).toBeCloseTo(25);
    });

    it('moves a target above the floor down the line of sight, so the view stays the same', () => {
        // Looking north and 45° down at a point 2 m up, from 10 m away.
        const camera = {
            target: [0, 2, 0] as [number, number, number],
            position: [0, 2 + 10 * Math.SQRT1_2, 10 * Math.SQRT1_2] as [number, number, number],
            levelId: 'L1',
        };

        const pose = poseOfCamera(camera);

        // The line of sight meets the floor 2 m further north.
        close(pose.target, [0, 2]);
        expect(pose.distance).toBeCloseTo(10 + 2 * Math.SQRT2);
        expect(pose.tilt).toBeCloseTo(45);
        expect(pose.bearing).toBeCloseTo(0);
    });

    it('reads the ¾ view as looking north-north-west, 45° down', () => {
        const { azimuth, polar } = VIEWS.perspective;
        const camera = {
            target: [0, 0, 0] as [number, number, number],
            position: [
                10 * Math.sin(polar) * Math.sin(azimuth),
                10 * Math.cos(polar),
                10 * Math.sin(polar) * Math.cos(azimuth),
            ] as [number, number, number],
            levelId: 'L1',
        };

        const pose = poseOfCamera(camera);

        expect(pose.bearing).toBeCloseTo(360 - 22.5);
        expect(pose.tilt).toBeCloseTo(45);
    });
});

describe('the tilt limit', () => {
    it('lets the 3D view reach every tilt a Viewpoint may have', () => {
        expect((MAX_POLAR * 180) / Math.PI).toBeGreaterThanOrEqual(MAX_VIEWPOINT_TILT);
    });

    it('saves a camera at the 3D view’s lowest as a Viewpoint at the limit', () => {
        const low = cameraOfPose({ target: [0, 0], bearing: 0, tilt: 89, distance: 10 }, 'L1');

        expect(poseOfCamera(low).tilt).toBe(MAX_VIEWPOINT_TILT);
        expect(framePose({ min: [0, 0], max: [4, 4], height: 3 }, 0, 89).tilt).toBe(
            MAX_VIEWPOINT_TILT,
        );
    });
});

describe('between', () => {
    const a: Pose = { target: [0, 0], bearing: 350, tilt: 30, distance: 10 };
    const b: Pose = { target: [10, 20], bearing: 10, tilt: 60, distance: 40 };

    it('turns the short way round, past north, not the long way', () => {
        expect(between(a, b, 0.5).bearing).toBeCloseTo(0);
        expect(between(a, b, 0.25).bearing).toBeCloseTo(355);
    });

    it('moves the target evenly and the distance by ratio', () => {
        const half = between(a, b, 0.5);

        close(half.target, [5, 10]);
        expect(half.tilt).toBeCloseTo(45);
        expect(half.distance).toBeCloseTo(20);
    });

    it('starts and ends where it should', () => {
        expect(between(a, b, 0)).toEqual(a);
        const end = between(a, b, 1);
        close(end.target, b.target);
        expect(end.bearing).toBeCloseTo(10);
        expect(end.distance).toBeCloseTo(40);
    });
});

describe('ease', () => {
    it('starts and ends slowly, and is halfway at half time', () => {
        expect(ease(0)).toBe(0);
        expect(ease(0.5)).toBeCloseTo(0.5);
        expect(ease(1)).toBe(1);
        expect(ease(0.1)).toBeLessThan(0.1);
        expect(ease(0.9)).toBeGreaterThan(0.9);
    });
});

describe('tourAt', () => {
    const start: Pose = { target: [0, 0], bearing: 0, tilt: 45, distance: 100 };
    const entrance = viewpoint('A', { target: [10, 0], bearing: 90 });
    const hall = viewpoint('B', { target: [20, 0], bearing: 180 }, { flight: 4, pause: 1 });

    it('flies from where the camera was to the first Viewpoint, in its flight time (3 s by default)', () => {
        expect(tourAt(start, [entrance, hall], 0).pose).toEqual(start);
        const halfway = tourAt(start, [entrance, hall], 1.5);
        expect(halfway.index).toBe(0);
        expect(halfway.pose.target[0]).toBeCloseTo(5);
    });

    it('stays there for its pause (2 s by default), then flies on to the next', () => {
        expect(tourAt(start, [entrance, hall], 4).pose).toEqual({
            target: [10, 0],
            bearing: 90,
            tilt: 45,
            distance: 10,
        });
        const on = tourAt(start, [entrance, hall], 5 + 2);
        expect(on.index).toBe(1);
        expect(on.pose.target[0]).toBeCloseTo(15);
    });

    it('after the last Viewpoint flies back to the first, round and round', () => {
        // First round: 3 + 2 to A, 4 + 1 to B; then B → A takes 3 s.
        const back = tourAt(start, [entrance, hall], 10 + 1.5);
        expect(back.index).toBe(0);
        expect(back.pose.target[0]).toBeCloseTo(15);
        // Ten rounds later, the same place.
        const later = tourAt(start, [entrance, hall], 10 + 1.5 + 10 * 10);
        expect(later.pose.target[0]).toBeCloseTo(15);
        expect(later.done).toBe(false);
    });

    it('with one Viewpoint flies there and is done', () => {
        expect(tourAt(start, [entrance], 2).done).toBe(false);
        const arrived = tourAt(start, [entrance], 60);
        expect(arrived.done).toBe(true);
        expect(arrived.pose.target).toEqual([10, 0]);
    });

    it('with no flight time jumps straight there', () => {
        const jump = viewpoint('J', { target: [7, 7] }, { flight: 0 });

        expect(tourAt(start, [jump, entrance], 0).pose.target).toEqual([7, 7]);
    });
});

describe('framePose', () => {
    const box = { min: [0, 0] as [number, number], max: [10, 4] as [number, number], height: 3 };

    it('looks at the middle of the box, from the angles asked', () => {
        const pose = framePose(box, 45, 0);

        // Straight down, the box's middle is the target.
        close(pose.target, [5, 2]);
        expect(pose.bearing).toBe(45);
        expect(pose.tilt).toBe(0);
    });

    it('comes as close as the box allows, and further for a bigger one', () => {
        const small = framePose(box, 0, 45);
        const big = framePose({ ...box, max: [40, 16] }, 0, 45);

        expect(small.distance).toBeGreaterThan(5);
        expect(big.distance).toBeGreaterThan(small.distance * 3);
    });

    it('keeps the box on screen: each floor corner within the view', () => {
        const pose = framePose(box, 30, 50, 1.5);
        const camera = cameraOfPose(pose, 'L1');
        const back = camera.position.map((p, i) => p - camera.target[i]!);
        const length = Math.hypot(...back);
        for (const [x, y] of [
            [0, 0],
            [10, 0],
            [10, 4],
            [0, 4],
        ] as const) {
            const toCorner = [x - camera.position[0], -camera.position[1], -y - camera.position[2]];
            const along = -toCorner.reduce((sum, v, i) => sum + v * back[i]!, 0) / length;
            const off = Math.sqrt(Math.max(0, Math.hypot(...toCorner) ** 2 - along ** 2));
            // Within the wider half-angle of a 3 : 2 view at 45° high.
            expect(off / along).toBeLessThan(Math.tan((22.5 * Math.PI) / 180) * 1.5);
        }
    });
});

describe('nextIndex', () => {
    const start: Pose = { target: [0, 0], bearing: 0, tilt: 45, distance: 100 };
    const list = ['A', 'B', 'C'].map((id, i) => viewpoint(id, { target: [i * 10, 0] }));

    it('goes on to the Viewpoint it was flying to, when stopped on the way', () => {
        expect(nextIndex(tourAt(start, list, 1), 3)).toBe(0);
    });

    it('goes on to the next, when stopped while staying at one; after the last, the first', () => {
        // 3 s to A, then 2 s there.
        expect(nextIndex(tourAt(start, list, 4), 3)).toBe(1);
        // A, B and C each 5 s: at 14 s it stays at C.
        expect(nextIndex(tourAt(start, list, 14), 3)).toBe(0);
    });
});
