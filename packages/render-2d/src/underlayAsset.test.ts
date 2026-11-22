import { describe, expect, it } from 'vitest';
import { underlayAsset } from './underlayAsset.ts';

describe('underlayAsset', () => {
    it('names the raster loader, whatever the URL looks like', () => {
        for (const src of [
            'plan.png',
            'https://cdn.example.com/photo?w=1600',
            '/api/spaces/sp_1/assets/as_1',
            'blob:http://localhost/1234',
            'data:image/png;base64,AAAA',
        ])
            expect(underlayAsset(src)).toEqual({ src, parser: 'texture' });
    });

    it("leaves SVG to Pixi's own loader", () => {
        for (const src of [
            '/sample-underlay.svg',
            'https://example.com/Plan.SVG?v=2',
            'data:image/svg+xml,<svg/>',
        ])
            expect(underlayAsset(src)).toBe(src);
    });
});
