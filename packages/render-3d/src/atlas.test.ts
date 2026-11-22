import { describe, expect, it } from 'vitest';
import { packAtlas } from './atlas.ts';

type Size = { width: number; height: number };

/** Whether two placed bitmaps on the same page overlap. */
function overlap(a: Size & { x: number; y: number }, b: Size & { x: number; y: number }) {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

describe('packAtlas', () => {
    it('places every bitmap inside its page without overlaps', () => {
        const sizes: Size[] = Array.from({ length: 60 }, (_, i) => ({
            width: 20 + ((i * 37) % 90),
            height: 10 + ((i * 13) % 30),
        }));

        const { places, pages } = packAtlas(sizes, 256);

        const placed = sizes.map((s, i) => ({ ...s, ...places[i]! }));
        for (const p of placed) {
            expect(p.page).toBeLessThan(pages);
            expect(p.x + p.width).toBeLessThanOrEqual(256);
            expect(p.y + p.height).toBeLessThanOrEqual(256);
        }
        for (let i = 0; i < placed.length; i++)
            for (let j = i + 1; j < placed.length; j++)
                if (placed[i]!.page === placed[j]!.page)
                    expect(overlap(placed[i]!, placed[j]!)).toBe(false);
    });

    it('starts a new page only when one is full', () => {
        const small = packAtlas(
            [
                { width: 10, height: 10 },
                { width: 10, height: 10 },
            ],
            64,
        );
        const full = packAtlas(
            Array.from({ length: 5 }, () => ({ width: 60, height: 30 })),
            64,
        );

        expect(small.pages).toBe(1);
        // Two 30 px rows fit a 64 px page, with a pixel's gap between them.
        expect(full.pages).toBe(3);
        expect(full.places.map((p) => p.page)).toEqual([0, 0, 1, 1, 2]);
    });

    it('has no pages for no bitmaps', () => {
        expect(packAtlas([], 64)).toEqual({ places: [], pages: 0 });
    });
});
