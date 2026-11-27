import { createSpace, type AreaformDocument } from '@areaform/core';
import { createCamera } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import {
    camera2dAt,
    camera2dOf,
    findViewpoint,
    distanceToShow,
    findZone,
    positionAtDistance,
    zoomAtDistance,
    zoomToShow,
} from './pageCamera.ts';
import { camera3dOf2d } from './pageCameraCore.ts';

const base = createSpace({ name: 'House', kind: 'office', size: [40, 20] });
const ground = base.levels[0]!;
const doc: AreaformDocument = {
    ...base,
    levels: [
        { ...ground, id: 'G', viewpoints: [] },
        {
            ...ground,
            id: 'L1',
            viewpoints: [{ id: 'vp_roof', target: [10, 5], bearing: 0, tilt: 0, distance: 30 }],
            zones: [
                {
                    id: 'z_office',
                    shape: {
                        outer: [
                            [2, 2],
                            [12, 2],
                            [12, 6],
                            [2, 6],
                        ],
                    },
                    data: { rent: 1200 },
                },
            ],
        },
    ],
};

describe('findViewpoint and findZone', () => {
    it('find by id on any Level, with that Level', () => {
        expect(findViewpoint(doc, 'vp_roof')).toMatchObject({ levelId: 'L1' });
        expect(findZone(doc, 'z_office')).toEqual({ center: [7, 4], size: [10, 4], levelId: 'L1' });
    });

    it('find nothing for an id the plan does not have', () => {
        expect(findViewpoint(doc, 'nope')).toBeNull();
        expect(findZone(doc, 'nope')).toBeNull();
    });
});

describe('the 2D plan for a 3D camera', () => {
    const viewport = { width: 800, height: 600 };

    it('centres on what the camera looks at, plan y being the 3D view’s -z', () => {
        const { center } = camera2dOf({ position: [10, 30, -5], target: [10, 0, -5] }, 600);
        expect(center).toEqual([10, 5]);
    });

    it('zooms out as the camera goes further away', () => {
        const near = camera2dOf({ position: [0, 10, 0], target: [0, 0, 0] }, 600).zoom;
        const far = camera2dOf({ position: [0, 40, 0], target: [0, 0, 0] }, 600).zoom;
        expect(far).toBeCloseTo(near / 4, 6);
    });

    it('goes there and back: a 2D camera as 3D, then as 2D again', () => {
        const camera = { ...createCamera({ viewport }), center: [3, -8] as [number, number] };
        const there = camera3dOf2d(camera, 'G');
        expect(there.levelId).toBe('G');
        const back = camera2dOf(there, viewport.height);
        expect(back.center[0]).toBeCloseTo(3, 9);
        expect(back.center[1]).toBeCloseTo(-8, 9);
        expect(back.zoom).toBeCloseTo(camera.zoom, 6);
    });
});

describe('camera2dAt', () => {
    const from = { ...createCamera({ viewport: { width: 800, height: 600 } }), zoom: 10 };

    it('starts where the plan is and ends where it was sent', () => {
        const to = { center: [20, 10] as [number, number], zoom: 40 };
        expect(camera2dAt(from, to, 0)).toMatchObject({ center: [0, 0], zoom: 10 });
        expect(camera2dAt(from, to, 1)).toMatchObject(to);
    });

    it('zooms by ratio, so half way from 10 to 40 is 20', () => {
        expect(camera2dAt(from, { center: [0, 0], zoom: 40 }, 0.5).zoom).toBeCloseTo(20, 6);
    });

    it('stays within the zoom limits', () => {
        expect(camera2dAt(from, { center: [0, 0], zoom: 1e9 }, 1).zoom).toBe(from.maxZoom);
    });
});

describe('zoomToShow', () => {
    const camera = { ...createCamera({ viewport: { width: 800, height: 600 } }), zoom: 10 };

    it('comes closer to a small Zone, until it takes 40 % of the shorter side', () => {
        // A 2 m locker at 10 px/m is 20 px of 600: it needs 0.4 × 600 / 2 = 120 px/m.
        expect(zoomToShow(camera, [2, 1])).toBeCloseTo(120, 6);
    });

    it('goes back from a Zone too big for 80 % of the shorter side', () => {
        expect(zoomToShow(camera, [100, 20])).toBeCloseTo((0.8 * 600) / 100, 6);
    });

    it('keeps the zoom for a Zone in between', () => {
        expect(zoomToShow(camera, [30, 10])).toBeCloseTo(10, 6);
    });
});

describe('distanceToShow', () => {
    const viewport = { width: 800, height: 600 };

    it('brings the camera closer to a small Zone, by the same rule as 2D', () => {
        const far = 100;
        const near = distanceToShow([2, 1], far, viewport);
        expect(near).toBeLessThan(far);
        const zoom = zoomAtDistance(near, viewport.height);
        expect((2 * zoom) / 600).toBeCloseTo(0.4, 6);
    });

    it('sends it back from a Zone too big to fit, and leaves one in between alone', () => {
        expect(distanceToShow([200, 50], 20, viewport)).toBeGreaterThan(20);
        // At 30 m, a Zone 0.6 of the shorter side across stays at 30 m.
        const across = (0.6 * 600) / zoomAtDistance(30, 600);
        expect(distanceToShow([across, 1], 30, viewport)).toBeCloseTo(30, 6);
    });
});

describe('positionAtDistance', () => {
    it('slides the camera along its line of sight', () => {
        expect(positionAtDistance([0, 30, 40], [0, 0, 0], 10)).toEqual([0, 6, 8]);
    });

    it('goes straight up from a camera on its target', () => {
        expect(positionAtDistance([1, 0, 1], [1, 0, 1], 5)).toEqual([1, 5, 1]);
    });
});
