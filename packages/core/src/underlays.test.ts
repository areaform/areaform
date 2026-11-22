import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    underlayCorners,
    underlayToWorld,
    type Underlay,
    type Vec2,
} from './index.ts';

function hallEditor() {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const underlay = () => editor.getDocument().levels[0]!.underlays[0]!;
    return { editor, levelId, underlay };
}

const scan: Underlay = {
    id: 'U1',
    src: 'asset://hall-a.png',
    position: [0, 0],
    scale: 1,
    rotation: 0,
    opacity: 0.5,
    locked: false,
};

function expectPoint(actual: Vec2, expected: Vec2) {
    expect(actual[0]).toBeCloseTo(expected[0]);
    expect(actual[1]).toBeCloseTo(expected[1]);
}

describe('underlayToWorld', () => {
    it('maps image pixels (Y-down) to plan metres (Y-up) from the top-left corner', () => {
        const underlay = { ...scan, position: [10, 20] as Vec2, scale: 0.01 };

        expectPoint(underlayToWorld(underlay, [0, 0]), [10, 20]);
        expectPoint(underlayToWorld(underlay, [100, 200]), [11, 18]);
    });

    it('applies rotation counter-clockwise', () => {
        const underlay = {
            ...scan,
            position: [10, 20] as Vec2,
            scale: 0.01,
            rotation: Math.PI / 2,
        };

        expectPoint(underlayToWorld(underlay, [100, 0]), [10, 21]);
    });
});

describe('underlayCorners', () => {
    it('gives the image corners in plan metres, counter-clockwise from the bottom-left', () => {
        const underlay = {
            ...scan,
            position: [10, 20] as Vec2,
            scale: 0.01,
            size: [400, 200] as Vec2,
        };

        const corners = underlayCorners(underlay)!;

        expect(corners).toHaveLength(4);
        [
            [10, 18],
            [14, 18],
            [14, 20],
            [10, 20],
        ].forEach((p, i) => expectPoint(corners[i]!, p as Vec2));
    });

    it('is undefined while the image size is unknown', () => {
        expect(underlayCorners(scan)).toBeUndefined();
    });
});

describe('underlay commands', () => {
    it('adds, updates and deletes an Underlay', () => {
        const { editor, levelId, underlay } = hallEditor();

        editor.exec({ type: 'underlay.add', levelId, underlay: scan });
        expect(underlay()).toEqual(scan);

        editor.exec({
            type: 'underlay.update',
            levelId,
            underlayId: 'U1',
            changes: { opacity: 0.8, locked: true },
        });
        expect(underlay()).toMatchObject({ opacity: 0.8, locked: true });

        editor.exec({ type: 'underlay.delete', levelId, underlayId: 'U1' });
        expect(editor.getDocument().levels[0]?.underlays).toEqual([]);
    });

    it.each([
        ['opacity above 1', { opacity: 1.5 }],
        ['zero scale', { scale: 0 }],
        ['non-finite position', { position: [Number.NaN, 0] as Vec2 }],
        ['a zero image size', { size: [0, 100] as Vec2 }],
    ])('rejects an Underlay with %s', (_, override) => {
        const { editor, levelId } = hallEditor();

        const result = editor.exec({
            type: 'underlay.add',
            levelId,
            underlay: { ...scan, ...override },
        });

        expect(result).toEqual({ ok: false, errors: [{ code: 'invalid-underlay', id: 'U1' }] });
    });
});

describe('underlay.calibrate', () => {
    it('with an angle, also turns the image so the line points that way, about the first pixel', () => {
        const { editor, levelId, underlay } = hallEditor();
        editor.exec({
            type: 'underlay.add',
            levelId,
            underlay: { ...scan, position: [5, 30], rotation: 0.3 },
        });
        // A line on the scan that runs at a slight slope in the image.
        const pixels: [Vec2, Vec2] = [
            [100, 100],
            [500, 130],
        ];
        const anchorBefore = underlayToWorld(underlay(), pixels[0]);

        editor.exec({
            type: 'underlay.calibrate',
            levelId,
            underlayId: 'U1',
            pixels,
            distance: 8,
            angle: Math.PI / 2,
        });

        const [a, b] = pixels.map((p) => underlayToWorld(underlay(), p)) as [Vec2, Vec2];
        expectPoint(a, anchorBefore);
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(8);
        expect(Math.atan2(b[1] - a[1], b[0] - a[0])).toBeCloseTo(Math.PI / 2);
    });

    it('sets the scale from two pixels and their real distance, keeping the first pixel in place', () => {
        const { editor, levelId, underlay } = hallEditor();
        editor.exec({
            type: 'underlay.add',
            levelId,
            underlay: { ...scan, position: [5, 30], rotation: 0.3 },
        });
        const anchorBefore = underlayToWorld(underlay(), [100, 100]);

        editor.exec({
            type: 'underlay.calibrate',
            levelId,
            underlayId: 'U1',
            pixels: [
                [100, 100],
                [400, 500],
            ],
            distance: 10,
        });

        expect(underlay().scale).toBeCloseTo(0.02);
        expect(underlay().rotation).toBe(0.3);
        expectPoint(underlayToWorld(underlay(), [100, 100]), anchorBefore);
    });

    it('rejects calibration with coincident pixels or a non-positive distance', () => {
        const { editor, levelId } = hallEditor();
        editor.exec({ type: 'underlay.add', levelId, underlay: scan });
        const calibrate = (pixels: [Vec2, Vec2], distance: number) =>
            editor.exec({
                type: 'underlay.calibrate',
                levelId,
                underlayId: 'U1',
                pixels,
                distance,
            });

        expect(
            calibrate(
                [
                    [5, 5],
                    [5, 5],
                ],
                3,
            ).ok,
        ).toBe(false);
        expect(
            calibrate(
                [
                    [0, 0],
                    [5, 5],
                ],
                0,
            ).ok,
        ).toBe(false);
    });
});
