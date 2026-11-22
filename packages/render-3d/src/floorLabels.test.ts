import { createEditor, createSpace, type Command, type Ring } from '@areaform/core';
import { defaultTheme, type LabelMeasure } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { packAtlas } from './atlas.ts';
import {
    buildLevelLabels,
    buildStopIcons,
    ICON_PX,
    LABEL_FONT_PX,
    LOGO_PAD,
    LOGO_PX,
    LABEL_LIFT,
    labelBitmap,
    labelQuads,
    SDF_RADIUS,
    type FloorLabel,
} from './floorLabels.ts';
import { ZONE_LIFT } from './meshes.ts';
import { defaultTheme3D } from './theme3d.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

function level(...zones: { id: string; at: [number, number]; extra?: object }[]) {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const G = doc.levels[0]!.id;
    for (const { id, at, extra } of zones) {
        const command: Command = {
            type: 'zone.add',
            levelId: G,
            zone: { id, shape: { outer: square(at[0], at[1], 4) }, label: id, ...extra },
        };
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return editor.getDocument().levels[0]!;
}

const measure: LabelMeasure = (text) => text.length * 0.5;
const options = { theme: defaultTheme, theme3d: defaultTheme3D, measure };

describe('buildLevelLabels', () => {
    it('puts each name where 2D does, just above the Zones, with plan y as world −z', () => {
        const [label] = buildLevelLabels(level({ id: 'B12', at: [0, 0] }), options);

        expect(label).toMatchObject({
            id: 'B12',
            lines: ['B12'],
            size: defaultTheme.labelSize,
        });
        const [x, y, z] = label!.position;
        expect(x).toBeCloseTo(2);
        expect(y).toBe(LABEL_LIFT);
        expect(y).toBeGreaterThan(ZONE_LIFT);
        expect(z).toBeCloseTo(-2);
    });

    it('wraps and shrinks names by the same rule as 2D', () => {
        const [label] = buildLevelLabels(
            level({ id: 'Acme Robotics', at: [0, 0], extra: { labelSize: 2 } }),
            options,
        );

        expect(label!.lines).toEqual(['Acme', 'Robotics']);
        expect(label!.size).toBeLessThan(2);
    });

    it("colours names by the Zone's labelColor, then Theme3D, then the 2D Theme", () => {
        const l = level(
            { id: 'A', at: [0, 0], extra: { labelColor: '#ff0000' } },
            { id: 'B', at: [10, 0] },
        );

        expect(buildLevelLabels(l, options).map((x) => x.color)).toEqual([
            '#ff0000',
            defaultTheme.label.fill,
        ]);
        const themed = { ...options, theme3d: { ...defaultTheme3D, label: '#0000ff' } };
        expect(buildLevelLabels(l, themed).map((x) => x.color)).toEqual(['#ff0000', '#0000ff']);
    });

    it("adds a category icon above the name, in the name's colour", () => {
        const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
        const theme = { ...defaultTheme, categoryIcons: { wc: svg } };
        const l = level({ id: 'WC', at: [0, 0], extra: { category: 'wc', labelColor: '#123456' } });

        const [icon, name] = buildLevelLabels(l, { ...options, theme });

        expect(icon).toMatchObject({
            id: 'WC',
            svg,
            lines: [],
            color: '#123456',
            width: 1,
            height: 1,
        });
        expect(name).toMatchObject({ id: 'WC', lines: ['WC'], color: '#123456' });
        // Above the name on the plan is further north: a smaller world z.
        expect(icon!.position[2]).toBeLessThan(name!.position[2]);
        expect(icon!.size).toBeCloseTo(Math.min(2 * name!.size, theme.zoneIconSize));
    });

    it("shows a host's name and logo, the logo in its own colours with its proportions", () => {
        const logo = '<svg viewBox="0 0 300 100"><rect width="300" height="100"/></svg>';
        const l = level({ id: 'B12', at: [0, 0], extra: { labelSize: 0.5 } });

        const [picture, name] = buildLevelLabels(l, {
            ...options,
            labelResolver: (zone) => (zone.id === 'B12' ? { text: 'Acme', logo } : undefined),
        });

        expect(name).toMatchObject({ lines: ['Acme'] });
        expect(picture).toMatchObject({ svg: logo, logo: true, height: 1 });
        // Width over height: 3 to 1.
        expect(picture!.width).toBeCloseTo(3);
    });

    it('fades a name by the opacity a resolver gives it, in its colours’ alpha', () => {
        const l = level({ id: 'B12', at: [0, 0] });

        const [name] = buildLevelLabels(l, { ...options, labelResolver: () => ({ opacity: 0.4 }) });

        expect(name).toMatchObject({ lines: ['B12'], opacity: 0.4 });
    });

    it('leaves out Zones without a name', () => {
        expect(
            buildLevelLabels(level({ id: 'A', at: [0, 0], extra: { label: '' } }), options),
        ).toEqual([]);
    });
});

const label = (extra: Partial<FloorLabel> = {}): FloorLabel => ({
    id: 'z',
    lines: ['B12'],
    position: [2, LABEL_LIFT, -3],
    size: 0.5,
    width: 1.5,
    height: 1,
    color: 'ink',
    ...extra,
});

describe('labelBitmap', () => {
    it('is the text at the label font size, padded by the field radius', () => {
        expect(labelBitmap(label(), 2048)).toEqual({
            width: 1.5 * LABEL_FONT_PX + 2 * SDF_RADIUS,
            height: LABEL_FONT_PX + 2 * SDF_RADIUS,
            fontPx: LABEL_FONT_PX,
        });
    });

    it('draws a logo LOGO_PX along its longer side, its height as the size', () => {
        const wide = labelBitmap(label({ svg: '<svg/>', logo: true, width: 3 }), 1024);
        const tall = labelBitmap(label({ svg: '<svg/>', logo: true, width: 0.5 }), 1024);

        expect(wide).toEqual({
            width: LOGO_PX + 2 * LOGO_PAD,
            height: LOGO_PX / 3 + 2 * LOGO_PAD,
            fontPx: LOGO_PX / 3,
        });
        expect(tall).toEqual({
            width: LOGO_PX / 2 + 2 * LOGO_PAD,
            height: LOGO_PX + 2 * LOGO_PAD,
            fontPx: LOGO_PX,
        });
    });

    it('draws a name too long for a page smaller, so it still fits', () => {
        const bitmap = labelBitmap(label({ width: 100 }), 2048);

        expect(bitmap.fontPx).toBeLessThan(LABEL_FONT_PX);
        expect(bitmap.width).toBeLessThanOrEqual(2048);
    });
});

describe('labelQuads', () => {
    const ink: [number, number, number] = [0.1, 0.2, 0.3];
    const color = () => ink;

    it('gives each label a quad centred on it, sized by its bitmap in metres', () => {
        const labels = [label()];
        const bitmaps = labels.map((l) => labelBitmap(l, 256));
        const { places, pages } = packAtlas(bitmaps, 256);

        const [q] = labelQuads(labels, bitmaps, places, pages, 256, color);

        const w = ((bitmaps[0]!.width / LABEL_FONT_PX) * 0.5) / 2;
        const h = ((bitmaps[0]!.height / LABEL_FONT_PX) * 0.5) / 2;
        expect([...q!.offsets].map((v) => +v.toFixed(5))).toEqual(
            [-w, h, w, h, w, -h, -w, -h].map((v) => +v.toFixed(5)),
        );
        expect([...q!.positions.slice(0, 3)]).toEqual([2, Math.fround(LABEL_LIFT), -3]);
        expect([...q!.sizes]).toEqual([0.5, 0.5, 0.5, 0.5]);
        expect([...q!.colors.slice(0, 4)].map((v) => +v.toFixed(5))).toEqual([0.1, 0.2, 0.3, 1]);
        expect([...q!.indices]).toEqual([0, 3, 2, 0, 2, 1]);
    });

    it('maps the top of each quad to the top row of its bitmap on the page', () => {
        const labels = [label(), label({ lines: ['A', 'B'], height: 2.2 })];
        const bitmaps = labels.map((l) => labelBitmap(l, 256));
        const { places, pages } = packAtlas(bitmaps, 256);

        const [q] = labelQuads(labels, bitmaps, places, pages, 256, color);

        labels.forEach((_, i) => {
            const { x, y } = places[i]!;
            const { width, height } = bitmaps[i]!;
            const uv = [...q!.uvs.slice(i * 8, i * 8 + 8)].map((v) => +v.toFixed(5));
            const u0 = x / 256;
            const u1 = (x + width) / 256;
            const v0 = y / 256;
            const v1 = (y + height) / 256;
            expect(uv).toEqual([u0, v0, u1, v0, u1, v1, u0, v1].map((v) => +v.toFixed(5)));
        });
    });

    it('splits labels across pages as the atlas does', () => {
        const labels = [label(), label({ id: 'y' }), label({ id: 'x' })];
        const bitmaps = labels.map((l) => labelBitmap(l, 64));
        const { places, pages } = packAtlas(bitmaps, 64);

        const quads = labelQuads(labels, bitmaps, places, pages, 64, color);

        expect(quads).toHaveLength(pages);
        expect(quads.reduce((n, q) => n + q.sizes.length / 4, 0)).toBe(3);
    });
});

describe('buildStopIcons', () => {
    function withConnections(...kinds: ('stairs' | 'elevator')[]) {
        const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
        const editor = createEditor(doc);
        const G = doc.levels[0]!.id;
        editor.exec({ type: 'level.add', id: 'L1', name: 'L1' });
        kinds.forEach((kind, i) => {
            const shape = { outer: square(i * 10, 0, 2) };
            const result = editor.exec({
                type: 'connection.add',
                connection: {
                    id: kind,
                    kind,
                    stops: [G, 'L1'].map((levelId) => ({ levelId, shape })),
                    bidirectional: true,
                },
            });
            if (!result.ok) throw new Error(JSON.stringify(result.errors));
        });
        const next = editor.getDocument();
        return { doc: next, level: next.levels[0]! };
    }

    it("puts each Stop's icon on top of its block, centred and sized as in 2D", () => {
        const { doc, level } = withConnections('stairs', 'elevator');

        const [stairs, lift] = buildStopIcons(doc, level, options);

        expect(stairs).toMatchObject({
            id: 'stairs',
            lines: [],
            svg: defaultTheme.connectionIcons.stairs,
            size: Math.min(defaultTheme.connectionIconSize, 0.6 * 2),
            width: 1,
            height: 1,
        });
        expect(stairs!.position[0]).toBeCloseTo(1);
        expect(stairs!.position[1]).toBeCloseTo(
            defaultTheme3D.connections.stairs.height! + LABEL_LIFT,
        );
        expect(stairs!.position[2]).toBeCloseTo(-1);
        // The lift's block reaches the ceiling.
        expect(lift!.position[1]).toBeCloseTo(level.height + LABEL_LIFT);
    });

    it("colours icons by Theme3D's Connection look, then the 2D Theme's icon colour", () => {
        const { doc, level } = withConnections('stairs');
        const plain = {
            ...options,
            theme3d: {
                ...defaultTheme3D,
                connections: { ...defaultTheme3D.connections, stairs: { color: '#000' } },
            },
        };

        expect(buildStopIcons(doc, level, options)[0]!.color).toBe(
            defaultTheme3D.connections.stairs.icon,
        );
        expect(buildStopIcons(doc, level, plain)[0]!.color).toBe(
            defaultTheme.connectionIcon.stroke,
        );
    });

    it('draws icons into a square bitmap at the icon size', () => {
        const { doc, level } = withConnections('stairs');

        expect(labelBitmap(buildStopIcons(doc, level, options)[0]!, 2048)).toEqual({
            width: ICON_PX + 2 * SDF_RADIUS,
            height: ICON_PX + 2 * SDF_RADIUS,
            fontPx: ICON_PX,
        });
    });
});
