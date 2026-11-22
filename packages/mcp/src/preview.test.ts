import { createSpace, type Level, type Underlay, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { renderPreview } from './preview.ts';

function hall(): Level {
    const level = createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] }).levels[0]!;
    return {
        ...level,
        zones: [
            {
                id: 'B1',
                label: 'Acme & Co',
                category: 'booth',
                shape: {
                    outer: [
                        [2, 2],
                        [6, 2],
                        [6, 5],
                        [2, 5],
                    ],
                },
            },
        ],
        obstacles: [
            {
                id: 'C1',
                kind: 'column',
                shape: {
                    outer: [
                        [10, 8],
                        [10.5, 8],
                        [10.5, 8.5],
                        [10, 8.5],
                    ],
                },
            },
        ],
    };
}

describe('renderPreview', () => {
    it('fits the plan into the width, keeping its proportions', () => {
        const { svg, pixelsPerMetre, origin } = renderPreview(hall(), { width: 448, ids: true });
        // 448 px less 24 px padding each side over 20 m.
        expect(pixelsPerMetre).toBe(20);
        expect(svg).toContain('width="448" height="248"');
        expect(origin).toEqual([-1.2, 11.2]);
    });

    it('draws Y up: the plan origin is at the bottom left', () => {
        const { svg } = renderPreview(hall(), { width: 448, ids: false });
        // The Outline starts at [0, 0], which is 24 px in from the left and bottom edges.
        expect(svg).toContain('M 24 224 L 424 224 L 424 24 L 24 24 Z');
    });

    it('writes labels and, on request, ids, escaped', () => {
        const withIds = renderPreview(hall(), { width: 448, ids: true }).svg;
        expect(withIds).toContain('>Acme &#38; Co</text>');
        expect(withIds).toContain('>B1</text>');
        expect(withIds).toContain('>C1</text>');
        const withoutIds = renderPreview(hall(), { width: 448, ids: false }).svg;
        expect(withoutIds).not.toContain('>B1</text>');
    });

    it('draws the Stops of stairs and lifts with their name, also outside the Outline', () => {
        const stop = (x: number, y: number) => ({
            outer: [
                [x, y],
                [x + 2, y],
                [x + 2, y + 2],
                [x, y + 2],
            ] as Vec2[],
        });
        const plain = renderPreview(hall(), { width: 448, ids: false });
        const { svg, origin } = renderPreview(hall(), {
            width: 448,
            ids: false,
            stops: [
                { name: 'Stair A', shape: stop(14, 4) },
                // A ramp down from a courtyard, below the Outline.
                { name: 'Car ramp', shape: stop(8, -4) },
            ],
        });
        expect(svg).toContain('>Stair A</text>');
        expect(svg).toContain('>Car ramp</text>');
        expect(svg.match(/stroke-dasharray="4 2" fill-rule="evenodd"/g)).toHaveLength(2);
        // Room is made for the ramp: same top-left and scale, 4 m (80 px) further down.
        expect(origin).toEqual(plain.origin);
        expect(plain.svg).toContain('width="448" height="248"');
        expect(svg).toContain('width="448" height="328"');
    });

    it('picks a grid step at least 20 pixels apart', () => {
        expect(renderPreview(hall(), { width: 448, ids: false }).gridStep).toBe(1);
        expect(renderPreview(hall(), { width: 248, ids: false }).gridStep).toBe(2);
    });

    it('draws the Source under the plan and makes room for all of it', () => {
        const underlay: Underlay = {
            id: 'import-source',
            src: 'source.png',
            position: [0, 12],
            scale: 0.1,
            rotation: 0,
            opacity: 0.5,
            locked: true,
            size: [200, 120],
        };
        const { svg, origin } = renderPreview(hall(), {
            width: 448,
            ids: false,
            source: { underlay, href: 'data:image/png;base64,AAAA' },
        });
        expect(origin[1]).toBeCloseTo(13.2);
        expect(svg).toMatch(
            /<image href="data:image\/png;base64,AAAA" x="24" y="24" width="400" height="240" opacity="0.5"/,
        );
        expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('>Acme'));
    });
});

describe('Viewpoints on the preview', () => {
    const at = (id: string, bearing: number, tilt: number) => ({
        id,
        target: [10, 5] as Vec2,
        bearing,
        tilt,
        distance: 6,
    });

    it('marks each camera with its number, a wedge and its crossed target', () => {
        const { svg } = renderPreview(
            { ...hall(), viewpoints: [at('V1', 0, 30), at('V2', 90, 0)] },
            { width: 400, ids: false },
        );

        expect(svg.match(/<circle/g)).toHaveLength(2);
        expect(svg).toMatch(/>1<\/text>/);
        expect(svg).toMatch(/>2<\/text>/);
        expect(svg.match(/stroke-dasharray="5 3"/g)).toHaveLength(2);
    });

    it('pulls a camera standing beyond the plan in to its edge, so the plan keeps its scale', () => {
        const plain = renderPreview(hall(), { width: 400, ids: false });
        const far = renderPreview(
            { ...hall(), viewpoints: [{ ...at('V1', 0, 80), distance: 500 }] },
            { width: 400, ids: false },
        );

        expect(far.pixelsPerMetre).toBe(plain.pixelsPerMetre);
        const [, cx, cy] = far.svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/)!;
        // On the plan's south edge, straight below the target.
        const height = Number(far.svg.match(/height="(\d+)"/)![1]);
        expect(Number(cy)).toBeCloseTo(height - 24, 0);
        expect(Number(cx)).toBeCloseTo(24 + 10 * plain.pixelsPerMetre, 0);
    });
});
