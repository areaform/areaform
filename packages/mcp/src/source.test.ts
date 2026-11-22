import { describe, expect, it } from 'vitest';
import { imageInfo, scaleFrom, sourceTopLeft, sourceToPlan } from './source.ts';
import { jpeg, png } from './testImages.ts';

describe('scaleFrom', () => {
    it('divides the real distance by the distance in Source units', () => {
        expect(scaleFrom([10, 10], [13, 14], 10)).toBe(2);
    });

    it('refuses coinciding points and non-positive distances', () => {
        expect(scaleFrom([1, 1], [1, 1], 5)).toBeUndefined();
        expect(scaleFrom([0, 0], [1, 0], 0)).toBeUndefined();
        expect(scaleFrom([0, 0], [1, 0], Number.NaN)).toBeUndefined();
    });
});

describe('sourceToPlan', () => {
    const calibration = { scale: 0.5, size: [40, 20] as [number, number] };

    it('flips Y, putting the bottom-left corner of the Source on the origin', () => {
        expect(sourceToPlan(calibration, [0, 20])).toEqual([0, 0]);
        expect(sourceToPlan(calibration, [40, 0])).toEqual([20, 10]);
        expect(sourceTopLeft(calibration)).toEqual([0, 10]);
    });
});

describe('imageInfo', () => {
    it('reads PNG and JPEG headers', () => {
        expect(imageInfo(png(640, 480))).toEqual({ type: 'png', size: [640, 480] });
        expect(imageInfo(jpeg(1024, 768))).toEqual({ type: 'jpeg', size: [1024, 768] });
    });

    it('returns undefined for anything else', () => {
        expect(imageInfo(new TextEncoder().encode('<svg></svg>'))).toBeUndefined();
        expect(imageInfo(new Uint8Array())).toBeUndefined();
    });
});
