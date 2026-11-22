import { describe, expect, it } from 'vitest';
import { distanceField, SDF_EDGE } from './sdf.ts';

/** A width × height coverage bitmap with a filled rectangle from (x0, y0) to (x1, y1), exclusive. */
function bitmap(width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
    const alpha = new Uint8Array(width * height);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[y * width + x] = 255;
    return alpha;
}

describe('distanceField', () => {
    const [width, height, radius] = [20, 20, 6];
    const field = distanceField(bitmap(width, height, 5, 5, 15, 15), width, height, radius);
    const at = (x: number, y: number) => field[y * width + x]! / 255;

    it('is above the edge value inside the shape and below it outside', () => {
        expect(at(10, 10)).toBeGreaterThan(SDF_EDGE);
        expect(at(5, 10)).toBeGreaterThanOrEqual(SDF_EDGE);
        expect(at(4, 10)).toBeLessThan(SDF_EDGE);
        expect(at(0, 0)).toBeLessThan(SDF_EDGE);
    });

    it('falls steadily with distance outside the shape, to nothing past the radius', () => {
        const row = [4, 3, 2, 1, 0].map((x) => at(x, 10));
        for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThan(row[i - 1]!);
        // One pixel out loses 1 / radius of the full range.
        expect(at(4, 10) - at(3, 10)).toBeCloseTo(1 / radius, 2);
        const far = distanceField(bitmap(40, 1, 30, 0, 40, 1), 40, 1, radius);
        expect(far[0]).toBe(0);
    });

    it('measures straight-line distance, not along rows and columns', () => {
        // (2, 2) is 3√2 from the corner at (5, 5), (2, 10) is 3 from the left side.
        expect(at(2, 2)).toBeLessThan(at(2, 10));
    });

    it('puts a half-covered pixel on the edge', () => {
        const alpha = new Uint8Array([0, 0, 128, 255, 255]);
        const line = distanceField(alpha, 5, 1, radius);

        expect(line[2]! / 255).toBeCloseTo(SDF_EDGE, 1);
    });
});
