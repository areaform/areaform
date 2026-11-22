import { describe, expect, it } from 'vitest';
import {
    FRAME_FILL,
    frame,
    MAX_POLAR,
    nearPlane,
    orbitOf,
    radiusOf,
    VIEWS,
    type Vec3,
} from './view.ts';

const box = { min: [0, -0.15, -10] as Vec3, max: [20, 3, 0] as Vec3 };
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * How far out the bounds' corners reach on screen from a camera at `position` looking at
 * `target` with world up: the largest |x| and |y| in normalised device coordinates (1 = the edge).
 */
function cornersOnScreen(position: Vec3, target: Vec3, fov: number, aspect: number) {
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: Vec3, b: Vec3): Vec3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    const unit = (a: Vec3): Vec3 => a.map((v) => v / Math.hypot(...a)) as Vec3;
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const forward = unit(sub(target, position));
    // Straight down, Three.js keeps north up; any up that is not along the view works the same.
    const right = unit(cross(forward, Math.abs(forward[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0]));
    const up = cross(right, forward);
    const tan = Math.tan((fov * Math.PI) / 360);
    let across = 0;
    let high = 0;
    for (const x of [box.min[0], box.max[0]])
        for (const y of [box.min[1], box.max[1]])
            for (const z of [box.min[2], box.max[2]]) {
                const p = sub([x, y, z], position);
                const depth = dot(p, forward);
                across = Math.max(across, Math.abs(dot(p, right)) / (depth * tan * aspect));
                high = Math.max(high, Math.abs(dot(p, up)) / (depth * tan));
            }
    return { across, up: high };
}

describe('nearPlane', () => {
    it('moves out with the camera, a hundredth of its distance, for depth precision far away', () => {
        expect(nearPlane(100, 40)).toBeCloseTo(1);
        expect(nearPlane(300, 40)).toBeCloseTo(3);
    });

    it('stays at least 5 cm, and a two-thousandth of a big Level, close up', () => {
        expect(nearPlane(1, 10)).toBeCloseTo(0.05);
        expect(nearPlane(1, 400)).toBeCloseTo(0.2);
    });

    it('keeps the 24-bit depth buffer finer than the 1 cm Zones lie above the floor, 150 m away', () => {
        // A depth step at distance z is about z² / (near · 2²⁴).
        const z = 150;
        expect((z * z) / (nearPlane(z, 50) * 2 ** 24)).toBeLessThan(0.001);
    });
});

describe('frame', () => {
    it('looks at the bounds from the asked angle', () => {
        const { position, target } = frame(box, VIEWS.perspective, 45, 1.5);

        // Centred on the bounds as they appear on screen: near their middle, not at it.
        expect(Math.abs(target[0] - 10)).toBeLessThan(2);
        expect(Math.abs(target[2] + 5)).toBeLessThan(2);
        const orbit = orbitOf(position, target);
        expect(orbit.azimuth).toBeCloseTo(VIEWS.perspective.azimuth);
        expect(orbit.polar).toBeCloseTo(VIEWS.perspective.polar);
    });

    it('keeps every corner of the bounds in view, from any angle and canvas shape', () => {
        for (const orbit of [VIEWS.perspective, VIEWS.top, { azimuth: 2, polar: 1.2 }])
            for (const aspect of [0.5, 1, 2]) {
                const { position, target } = frame(box, orbit, 45, aspect);
                const spread = cornersOnScreen(position, target, 45, aspect);
                expect(spread.across).toBeLessThanOrEqual(FRAME_FILL + 1e-9);
                expect(spread.up).toBeLessThanOrEqual(FRAME_FILL + 1e-9);
                // Tight: one pair of view edges is reached.
                expect(Math.max(spread.across, spread.up)).toBeCloseTo(FRAME_FILL);
            }
    });

    it('stands nearer than a sphere around the Level would need', () => {
        const { position, target } = frame(box, VIEWS.perspective, 45, 960 / 755);
        const sphere = radiusOf(box) / Math.sin((45 * Math.PI) / 360);

        expect(distance(position, target)).toBeLessThan(sphere * 0.85);
    });

    it('stands further back for a narrower canvas', () => {
        const wide = frame(box, VIEWS.top, 45, 2);
        const tall = frame(box, VIEWS.top, 45, 0.5);

        expect(distance(tall.position, tall.target)).toBeGreaterThan(
            distance(wide.position, wide.target),
        );
    });

    it('looks straight down with north up from the top', () => {
        const { position, target } = frame(box, VIEWS.top, 45, 1);

        expect(position[0]).toBeCloseTo(target[0]);
        expect(position[2] - target[2]).toBeGreaterThanOrEqual(0);
        expect(position[1]).toBeGreaterThan(target[1]);
    });

    it('never puts the camera below the floor', () => {
        const { position, target } = frame(box, { azimuth: 0, polar: Math.PI }, 45, 1);

        expect(orbitOf(position, target).polar).toBeCloseTo(MAX_POLAR);
    });

    it('frames an empty Level around the origin', () => {
        const empty = {
            min: [Infinity, Infinity, Infinity] as Vec3,
            max: [-Infinity, -Infinity, -Infinity] as Vec3,
        };

        const { target, position } = frame(empty, VIEWS.perspective, 45, 1);

        expect(target).toEqual([0, 0, 0]);
        expect(position.every(Number.isFinite)).toBe(true);
    });
});
