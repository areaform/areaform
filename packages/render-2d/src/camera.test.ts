import { describe, expect, it } from 'vitest';
import {
    applyWheel,
    createCamera,
    fit,
    panBy,
    pinchBy,
    screenToWorld,
    worldToScreen,
    zoomAt,
} from './index.ts';

/** 800 × 600 px viewport looking at plan point (10, 5) at 20 px per metre. */
const camera = createCamera({ viewport: { width: 800, height: 600 }, center: [10, 5], zoom: 20 });

function expectPoint(actual: [number, number], expected: [number, number]) {
    expect(actual[0]).toBeCloseTo(expected[0]);
    expect(actual[1]).toBeCloseTo(expected[1]);
}

describe('worldToScreen / screenToWorld', () => {
    it('puts the camera centre in the middle of the viewport', () => {
        expectPoint(worldToScreen(camera, [10, 5]), [400, 300]);
    });

    it('maps plan +Y (up) to screen −Y (up the screen)', () => {
        expectPoint(worldToScreen(camera, [11, 6]), [420, 280]);
    });

    it('are inverses of each other', () => {
        expectPoint(screenToWorld(camera, [123, 456]), [-3.85, -2.8]);
        expectPoint(screenToWorld(camera, worldToScreen(camera, [3.5, -2])), [3.5, -2]);
    });
});

describe('zoomAt', () => {
    it('keeps the plan point under the cursor in place', () => {
        const cursor: [number, number] = [600, 100];
        const under = screenToWorld(camera, cursor);

        const zoomed = zoomAt(camera, cursor, 2);

        expect(zoomed.zoom).toBe(40);
        expectPoint(worldToScreen(zoomed, under), cursor);
    });

    it('clamps the zoom to the camera limits', () => {
        const limited = createCamera({
            viewport: { width: 800, height: 600 },
            center: [0, 0],
            zoom: 20,
            minZoom: 5,
            maxZoom: 50,
        });

        expect(zoomAt(limited, [0, 0], 100).zoom).toBe(50);
        expect(zoomAt(limited, [0, 0], 0.001).zoom).toBe(5);
    });
});

describe('panBy', () => {
    it('moves the plan with the pointer: dragging right shows what was on the left', () => {
        const panned = panBy(camera, [100, 40]);

        expectPoint(panned.center, [5, 7]);
    });
});

describe('pinchBy', () => {
    it('zooms about the fingers as they spread, keeping the plan point between them in place', () => {
        const between = screenToWorld(camera, [300, 200]);
        const pinched = pinchBy(
            camera,
            [
                [250, 200],
                [350, 200],
            ],
            [
                [200, 200],
                [400, 200],
            ],
        );

        expect(pinched.zoom).toBeCloseTo(camera.zoom * 2);
        expectPoint(screenToWorld(pinched, [300, 200]), between);
    });

    it('moves the plan with the fingers when they move together', () => {
        const under = screenToWorld(camera, [300, 200]);
        const moved = pinchBy(
            camera,
            [
                [250, 200],
                [350, 200],
            ],
            [
                [270, 240],
                [370, 240],
            ],
        );

        expect(moved.zoom).toBeCloseTo(camera.zoom);
        expectPoint(screenToWorld(moved, [320, 240]), under);
    });

    it('keeps the zoom within its limits', () => {
        const pinched = pinchBy(
            { ...camera, maxZoom: camera.zoom * 1.5 },
            [
                [290, 200],
                [310, 200],
            ],
            [
                [100, 200],
                [500, 200],
            ],
        );

        expect(pinched.zoom).toBeCloseTo(camera.zoom * 1.5);
    });
});

describe('fit', () => {
    it('centres a box and zooms so it fits inside the padding', () => {
        const fitted = fit(camera, { minX: 0, minY: 0, maxX: 40, maxY: 25 }, 50);

        expectPoint(fitted.center, [20, 12.5]);
        // Width limits: (800 − 100) / 40 = 17.5; height would allow (600 − 100) / 25 = 20.
        expect(fitted.zoom).toBeCloseTo(17.5);
    });

    it('fits right of a covered strip on the left, centred in what is left', () => {
        const fitted = fit(camera, { minX: 0, minY: 0, maxX: 40, maxY: 25 }, 50, 200);

        // (800 − 200 − 100) / 40 = 12.5, and the box's middle at x = 200 + 600 / 2.
        expect(fitted.zoom).toBeCloseTo(12.5);
        expectPoint(worldToScreen(fitted, [20, 12.5]), [500, 300]);
    });
});

describe('applyWheel', () => {
    const cursor: [number, number] = [600, 100];
    const trackpad = (deltaX: number, deltaY: number) => ({
        deltaX,
        deltaY,
        deltaMode: 0,
        wheelDeltaY: -3 * deltaY,
    });
    const mouse = (deltaY: number) => ({
        deltaX: 0,
        deltaY,
        deltaMode: 0,
        wheelDeltaY: -120 * Math.sign(deltaY),
    });

    it('pans with a two-finger trackpad scroll, the plan following the fingers', () => {
        const next = applyWheel(camera, cursor, trackpad(40, -20));
        expect(next.zoom).toBe(20);
        // Content moves up and left by the scroll distance: the centre moves right and up 2 m and 1 m.
        expectPoint(next.center, [12, 6]);
    });

    it('zooms at the cursor on a pinch (reported as a wheel event with ctrlKey)', () => {
        const under = screenToWorld(camera, cursor);
        const next = applyWheel(camera, cursor, { ...trackpad(0, -10), ctrlKey: true });
        expect(next.zoom).toBeGreaterThan(20);
        expectPoint(screenToWorld(next, cursor), under);
    });

    it('zooms with a mouse wheel: in when scrolling up, out when scrolling down', () => {
        expect(applyWheel(camera, cursor, mouse(-100)).zoom).toBeGreaterThan(20);
        expect(applyWheel(camera, cursor, mouse(100)).zoom).toBeLessThan(20);
    });

    it('treats line-based scrolling (Firefox mouse wheels) as a mouse wheel', () => {
        const lines = { deltaX: 0, deltaY: 3, deltaMode: 1 };
        expect(applyWheel(camera, cursor, lines).zoom).toBeLessThan(20);
    });

    it('can be forced to always zoom or always pan', () => {
        expect(applyWheel(camera, cursor, trackpad(0, -10), 'zoom').zoom).toBeGreaterThan(20);
        const panned = applyWheel(camera, cursor, mouse(100), 'pan');
        expect(panned.zoom).toBe(20);
        expectPoint(panned.center, [10, 0]);
    });
});
