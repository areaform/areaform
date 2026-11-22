import { createEditor, createSpace, type ElementRef, type Level, type Zone } from '@areaform/core';
import { defaultTheme, type Style, type StyleResolver } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { ZONE_LIFT, type MeshData } from './meshes.ts';
import { buildZoneLayer, OUTLINE_LIFT, type OutlineData, type ZoneLayerOptions } from './zones.ts';

/** Colours by name, so tests can tell which triangles and lines are which. */
const PALETTE: Record<string, [number, number, number]> = {
    zone: [0.1, 0, 0],
    booth: [0.2, 0, 0],
    sold: [0.3, 0, 0],
    mine: [0.4, 0, 0],
    highlight: [0.5, 0, 0],
};
const byValue = new Map(Object.entries(PALETTE).map(([name, rgb]) => [rgb.join(), name]));
const name = (r: number, g: number, b: number) =>
    byValue.get([r, g, b].map((v) => Number(v.toFixed(2))).join()) ?? 'other';

const options: ZoneLayerOptions = {
    theme: {
        ...defaultTheme,
        zone: { fill: 'zone', stroke: 'zone', strokeWidth: 1 },
        categories: { booth: { fill: 'booth', stroke: 'booth' } },
        highlight: { stroke: 'highlight', strokeWidth: 3 },
    },
    color: (css) => PALETTE[css] ?? [1, 1, 1],
};

/** A Level with these Zones. */
function level(...zones: Zone[]): Level {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    for (const zone of zones) {
        const result = editor.exec({ type: 'zone.add', levelId, zone });
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return editor.getDocument().levels[0]!;
}

const square = (id: string, x: number, extra: Partial<Zone> = {}): Zone => ({
    id,
    shape: {
        outer: [
            [x, 1],
            [x + 2, 1],
            [x + 2, 3],
            [x, 3],
        ],
    },
    ...extra,
});

const ref = (l: Level, id: string): ElementRef => ({ kind: 'zone', id, levelId: l.id });

/** The colour name and alpha of each triangle. */
function fills(data: MeshData): { color: string; alpha: number }[] {
    const out = [];
    for (let v = 0; v < data.positions.length / 3; v += 3) {
        const [r, g, b, a] = data.colors.slice(4 * v, 4 * v + 4);
        out.push({ color: name(r!, g!, b!), alpha: a! });
    }
    return out;
}

const colorsOf = (data: MeshData) => [...new Set(fills(data).map((f) => f.color))];

/** The colour name of an outline's first point. */
const strokeOf = (outline: OutlineData) =>
    name(outline.colors[0]!, outline.colors[1]!, outline.colors[2]!);

/** Each outline's look and how many segments it has. */
const looks = (outlines: OutlineData[]) =>
    outlines.map((o) => ({
        stroke: strokeOf(o),
        width: o.width,
        opacity: o.opacity,
        highlight: o.highlight,
        segments: o.positions.length / 6,
    }));

describe('buildZoneLayer', () => {
    it('colours Zones like the plan, just above the floor, and keeps see-through ones apart', () => {
        const l = level(
            square('B', 1, { category: 'booth' }),
            square('Z', 10, { style: { opacity: 0.5 } }),
        );
        const { opaque, transparent, outlines } = buildZoneLayer(l, options);

        expect(colorsOf(opaque)).toEqual(['booth']);
        expect(fills(transparent)).toEqual([
            { color: 'zone', alpha: 0.5 },
            { color: 'zone', alpha: 0.5 },
        ]);
        expect(new Set(opaque.positions.filter((_, i) => i % 3 === 1))).toEqual(
            new Set([Math.fround(ZONE_LIFT)]),
        );
        expect(looks(outlines)).toEqual([
            { stroke: 'booth', width: 1, opacity: 1, highlight: false, segments: 4 },
            { stroke: 'zone', width: 1, opacity: 0.5, highlight: false, segments: 4 },
        ]);
    });

    it('outlines every Zone, so a row of booths reads as separate booths', () => {
        const l = level(
            square('A', 1, { category: 'booth' }),
            square('B', 3, { category: 'booth' }),
            square('C', 5, { category: 'booth' }),
        );
        const { outlines } = buildZoneLayer(l, options);

        // One group; the edges booths share are drawn by both.
        expect(looks(outlines)).toEqual([
            { stroke: 'booth', width: 1, opacity: 1, highlight: false, segments: 12 },
        ]);
        expect(new Set(outlines[0]!.positions.filter((_, i) => i % 3 === 1))).toEqual(
            new Set([Math.fround(OUTLINE_LIFT)]),
        );
    });

    it('leaves out the outline of a Zone without a stroke or with a zero width', () => {
        const l = level(square('A', 1), square('B', 5));
        const theme = (zone: Style) => ({ ...options.theme, zone });
        const plain = buildZoneLayer(l, { ...options, theme: theme({ fill: 'zone' }) });
        const thin = buildZoneLayer(l, {
            ...options,
            theme: theme({ fill: 'zone', stroke: 'zone', strokeWidth: 0 }),
        });

        expect(plain.outlines).toEqual([]);
        expect(thin.outlines).toEqual([]);
    });

    it('lays a Style Override over the category, as in 2D', () => {
        const l = level(
            square('A', 1, { category: 'booth' }),
            square('B', 5, { category: 'booth' }),
        );
        const styleResolver: StyleResolver = (r) => (r.id === 'A' ? { fill: 'sold' } : undefined);
        const { opaque } = buildZoneLayer(l, { ...options, styleResolver });

        expect(fills(opaque).map((f) => f.color)).toEqual(['sold', 'sold', 'booth', 'booth']);
    });

    it('passes each Zone and its ref to the Style Override', () => {
        const l = level(square('A', 1));
        const seen: [ElementRef, unknown][] = [];
        buildZoneLayer(l, { ...options, styleResolver: (r, e) => void seen.push([r, e]) });

        expect(seen).toEqual([[ref(l, 'A'), l.zones[0]]]);
    });

    it('leaves out a Zone the Style Override hides', () => {
        const l = level(square('A', 1), square('B', 5));
        const styleResolver: StyleResolver = (r) => (r.id === 'A' ? { opacity: 0 } : undefined);
        const { opaque, transparent } = buildZoneLayer(l, { ...options, styleResolver });

        expect(fills(opaque)).toHaveLength(2);
        expect(fills(transparent)).toEqual([]);
    });

    it('outlines a Zone in the stroke and width of its Style Override', () => {
        const l = level(square('A', 1), square('B', 5));
        const styleResolver: StyleResolver = (r) =>
            r.id === 'A' ? { stroke: 'mine', strokeWidth: 2 } : undefined;
        const { outlines } = buildZoneLayer(l, { ...options, styleResolver });

        expect(looks(outlines)).toEqual([
            { stroke: 'mine', width: 2, opacity: 1, highlight: false, segments: 4 },
            { stroke: 'zone', width: 1, opacity: 1, highlight: false, segments: 4 },
        ]);
    });

    it('highlights Zones in the Theme’s highlight, apart from other outlines and over them', () => {
        const l = level(square('A', 1), square('B', 3));
        const styleResolver: StyleResolver = () => ({ fill: 'sold', stroke: 'mine' });
        const { opaque, outlines } = buildZoneLayer(l, {
            ...options,
            styleResolver,
            highlight: [ref(l, 'B')],
        });

        // The highlight has a stroke only, so the status fill stays.
        expect(colorsOf(opaque)).toEqual(['sold']);
        expect(outlines.map((o) => [o.width, o.highlight])).toEqual([
            [1, false],
            [3, true],
        ]);
        expect(strokeOf(outlines.find((o) => o.highlight)!)).toBe('highlight');
    });

    it('outlines the holes of a Zone too', () => {
        const zone: Zone = {
            id: 'R',
            shape: {
                outer: [
                    [0, 0],
                    [6, 0],
                    [6, 6],
                    [0, 6],
                ],
                holes: [
                    [
                        [2, 2],
                        [4, 2],
                        [4, 4],
                    ],
                ],
            },
        };
        const l = level(zone);
        const { outlines } = buildZoneLayer(l, { ...options, highlight: [ref(l, 'R')] });

        expect(outlines[0]!.positions).toHaveLength((4 + 3) * 2 * 3);
    });

    it('ignores highlighted Elements that are not Zones of this Level', () => {
        const l = level(square('A', 1));
        const { outlines } = buildZoneLayer(l, {
            ...options,
            highlight: [
                { kind: 'zone', id: 'A', levelId: 'elsewhere' },
                { kind: 'wall', id: 'A', levelId: l.id },
            ],
        });

        expect(outlines.some((o) => o.highlight)).toBe(false);
    });
});
