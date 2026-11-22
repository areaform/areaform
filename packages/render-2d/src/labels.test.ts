import type { Ring, Zone } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    contentLabelResolver,
    defaultTheme,
    layoutZoneLabel,
    svgAspect,
    zoneLabelText,
    type LabelMeasure,
    type LabelResolver,
} from './index.ts';

function rect(x: number, y: number, w: number, h: number): Ring {
    return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
    ];
}

const zone = (label: string | undefined, outer: Ring, extra: Partial<Zone> = {}): Zone => ({
    id: 'z',
    shape: { outer },
    ...(label !== undefined && { label }),
    ...extra,
});

/** Every character half a font height wide, so widths are easy to reason about. */
const measure: LabelMeasure = (text) => text.length * 0.5;
const theme = { ...defaultTheme, labelSize: 1 };

describe('zoneLabelText', () => {
    it('is the Zone label, and nothing for an empty one', () => {
        expect(zoneLabelText(zone('B12', rect(0, 0, 1, 1)))).toBe('B12');
        expect(zoneLabelText(zone('', rect(0, 0, 1, 1)))).toBeUndefined();
        expect(zoneLabelText(zone(undefined, rect(0, 0, 1, 1)))).toBeUndefined();
    });
});

describe('layoutZoneLabel', () => {
    it('keeps the full size, on one line, when the name fits', () => {
        const layout = layoutZoneLabel(zone('B12', rect(0, 0, 10, 10)), theme, measure);

        expect(layout?.name).toMatchObject({
            text: 'B12',
            lines: ['B12'],
            size: 1,
            width: 1.5,
            height: 1,
        });
        expect(layout!.name!.position[0]).toBeCloseTo(5);
        expect(layout!.name!.position[1]).toBeCloseTo(5);
    });

    it('wraps onto two even lines when that lets the name be bigger', () => {
        // 13 characters: 6.5 m wide on one line, too wide for a 4 m square booth.
        const layout = layoutZoneLabel(zone('Acme Robotics', rect(0, 0, 4, 4)), theme, measure);

        expect(layout!.name!.lines).toEqual(['Acme', 'Robotics']);
        expect(layout!.name!.height).toBeCloseTo(2.2);
        // Robotics is 4 font heights wide, plus margins: about 0.9 m type in a 4 m booth.
        expect(layout!.name!.size).toBeGreaterThan(0.85);
        expect(layout!.name!.size).toBeLessThan(1);
    });

    it('stays on one line in a long, low Zone where two lines would be smaller', () => {
        const layout = layoutZoneLabel(zone('Acme Robotics', rect(0, 0, 20, 1.5)), theme, measure);

        expect(layout!.name!.lines).toEqual(['Acme Robotics']);
        expect(layout!.name!.size).toBe(1);
    });

    it('shrinks a single word that cannot wrap', () => {
        const layout = layoutZoneLabel(zone('Registration', rect(0, 0, 3, 3)), theme, measure);

        expect(layout!.name!.lines).toEqual(['Registration']);
        // 6 font heights wide plus margins in a 3 m Zone.
        expect(layout!.name!.size).toBeCloseTo(3 / 6.3, 2);
    });

    it('treats labelSize as the largest size', () => {
        const small = layoutZoneLabel(
            zone('B12', rect(0, 0, 10, 10), { labelSize: 0.4 }),
            theme,
            measure,
        );
        const big = layoutZoneLabel(
            zone('B12', rect(0, 0, 3, 3), { labelSize: 5 }),
            theme,
            measure,
        );

        expect(small!.name!.size).toBe(0.4);
        expect(big!.name!.size).toBeLessThan(3 / 1.8 + 0.01);
    });

    it('fits around the labelAnchor, not the centre', () => {
        // 0.5 m from the left edge: only a narrow name fits there.
        const layout = layoutZoneLabel(
            zone('B12', rect(0, 0, 10, 10), { labelAnchor: [0.5, 5] }),
            theme,
            measure,
        );

        expect(layout!.name!.position).toEqual([0.5, 5]);
        expect(layout!.name!.size).toBeCloseTo(1 / 1.8, 2);
    });

    it('stays inside an L-shaped Zone', () => {
        const l: Ring = [
            [0, 0],
            [6, 0],
            [6, 1],
            [1, 1],
            [1, 6],
            [0, 6],
        ];
        const layout = layoutZoneLabel(zone('Long name here', l), theme, measure)!.name!;
        const [x, y] = layout.position;
        const w = ((layout.width + 0.3) * layout.size) / 2;
        const h = ((layout.height + 0.3) * layout.size) / 2;

        // The whole box sits in one of the L's arms.
        const inBottomArm = y - h >= -1e-9 && y + h <= 1 + 1e-9;
        const inLeftArm = x - w >= -1e-9 && x + w <= 1 + 1e-9;
        expect(inBottomArm || inLeftArm).toBe(true);
    });

    it('gives no layout when the name cannot be shrunk enough to fit', () => {
        expect(
            layoutZoneLabel(zone('Registration', rect(0, 0, 0.3, 0.3)), theme, measure),
        ).toBeNull();
    });

    it('leaves a name anchored outside its Zone at full size', () => {
        const layout = layoutZoneLabel(
            zone('B12', rect(0, 0, 2, 2), { labelAnchor: [5, 5] }),
            theme,
            measure,
        );

        expect(layout?.name).toMatchObject({ position: [5, 5], size: 1, lines: ['B12'] });
    });

    it('lays out a Zone once per Theme and measure', () => {
        const z = zone('B12', rect(0, 0, 10, 10));
        let calls = 0;
        const counting: LabelMeasure = (text) => (calls++, measure(text));

        layoutZoneLabel(z, theme, counting);
        const after = calls;
        layoutZoneLabel(z, theme, counting);

        expect(calls).toBe(after);
        layoutZoneLabel(z, { ...theme }, counting);
        expect(calls).toBeGreaterThan(after);
    });
});

describe('layoutZoneLabel with a category icon', () => {
    const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
    const iconTheme = { ...theme, categoryIcons: { wc: svg, booth: '' }, zoneIconSize: 1.5 };

    it('puts the icon centred above the name, twice its height, the pair centred on the anchor', () => {
        const layout = layoutZoneLabel(
            zone('WC', rect(0, 0, 10, 10), { category: 'wc' }),
            iconTheme,
            measure,
        )!;

        expect(layout.icon).toMatchObject({ svg, size: 1.5 });
        expect(layout.name).toMatchObject({ lines: ['WC'], size: 1 });
        // Icon 1.5 (capped from 2), gap 0.25, name 1: 2.75 tall, centred on y = 5.
        expect(layout.icon!.position[0]).toBeCloseTo(5);
        expect(layout.icon!.position[1]).toBeCloseTo(5 + 2.75 / 2 - 0.75);
        expect(layout.name!.position[1]).toBeCloseTo(5 - 2.75 / 2 + 0.5);
    });

    it('shrinks icon and name together to fit', () => {
        const layout = layoutZoneLabel(
            zone('WC', rect(0, 0, 2.5, 2.5), { category: 'wc' }),
            iconTheme,
            measure,
        )!;

        expect(layout.name!.size).toBeLessThan(1);
        expect(layout.icon!.size).toBeCloseTo(Math.min(2 * layout.name!.size, 1.5));
        const top = layout.icon!.position[1] + layout.icon!.size / 2;
        const bottom = layout.name!.position[1] - layout.name!.size / 2;
        expect(top).toBeLessThanOrEqual(2.5);
        expect(bottom).toBeGreaterThanOrEqual(0);
    });

    it('leaves the name out and keeps the icon when the pair cannot fit', () => {
        // A long single word needs 10 m; the Zone is 1.4 m square.
        const layout = layoutZoneLabel(
            zone('Toiletsandshowers', rect(0, 0, 1.4, 1.4), { category: 'wc' }),
            iconTheme,
            measure,
        )!;

        expect(layout.name).toBeNull();
        expect(layout.icon!.position).toEqual([0.7, 0.7]);
        expect(layout.icon!.size).toBeLessThan(1.4);
    });

    it('shows the icon alone, centred, on a Zone with no name', () => {
        const layout = layoutZoneLabel(
            zone(undefined, rect(0, 0, 10, 10), { category: 'wc' }),
            iconTheme,
            measure,
        )!;

        expect(layout.name).toBeNull();
        expect(layout.icon).toMatchObject({ svg, size: 1.5 });
        expect(layout.icon!.position[1]).toBeCloseTo(5);
    });

    it('gives no icon to a category without one, or set to an empty string', () => {
        const plain = layoutZoneLabel(
            zone('A', rect(0, 0, 10, 10), { category: 'room' }),
            iconTheme,
            measure,
        );
        const removed = layoutZoneLabel(
            zone('B', rect(0, 0, 10, 10), { category: 'booth' }),
            iconTheme,
            measure,
        );

        expect(plain!.icon).toBeNull();
        expect(removed!.icon).toBeNull();
        expect(
            layoutZoneLabel(
                zone(undefined, rect(0, 0, 10, 10), { category: 'booth' }),
                iconTheme,
                measure,
            ),
        ).toBeNull();
    });
});

describe('layoutZoneLabel with a host override', () => {
    const icon = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
    const wide = '<svg viewBox="0 0 400 100"><rect width="400" height="100"/></svg>';
    const hostTheme = {
        ...theme,
        categoryIcons: { booth: icon },
        zoneIconSize: 1.5,
        zoneLogoSize: 3,
    };

    it("shows the host's name instead of the Zone's, and no name for ''", () => {
        const z = zone('B12', rect(0, 0, 10, 10));

        expect(layoutZoneLabel(z, hostTheme, measure, { text: 'Acme' })!.name!.text).toBe('Acme');
        expect(layoutZoneLabel(z, hostTheme, measure, { text: '' })).toBeNull();
        expect(layoutZoneLabel(z, hostTheme, measure, {})!.name!.text).toBe('B12');
    });

    it('puts a logo above the name instead of the category icon, keeping its proportions', () => {
        const square = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
        const layout = layoutZoneLabel(
            zone('B12', rect(0, 0, 10, 10), { category: 'booth' }),
            hostTheme,
            measure,
            { logo: square },
        )!;

        expect(layout.icon).toMatchObject({ svg: square, logo: true, size: 1.5, width: 1.5 });
        expect(layout.icon!.position[1]).toBeGreaterThan(layout.name!.position[1]);
    });

    it('caps a wide logo at zoneLogoSize wide, shrinking its height to match', () => {
        const layout = layoutZoneLabel(zone('B12', rect(0, 0, 10, 10)), hostTheme, measure, {
            logo: wide,
        })!;

        // 4:1 at an icon's 1.5 m height would be 6 m wide; the cap is 3 m.
        expect(layout.icon!.width).toBeCloseTo(3);
        expect(layout.icon!.size).toBeCloseTo(0.75);
    });

    it('drops the name first and keeps the logo when both cannot fit', () => {
        const layout = layoutZoneLabel(
            zone('Toiletsandshowers', rect(0, 0, 1.7, 1.2)),
            hostTheme,
            measure,
            { logo: wide },
        )!;

        expect(layout.name).toBeNull();
        expect(layout.icon!.logo).toBe(true);
        expect(layout.icon!.width).toBeLessThanOrEqual(1.7);
    });

    it('lays out again when the host changes its name or logo', () => {
        const z = zone('B12', rect(0, 0, 10, 10));

        const first = layoutZoneLabel(z, hostTheme, measure, { text: 'Acme' });
        expect(layoutZoneLabel(z, hostTheme, measure, { text: 'Acme' })).toBe(first);
        expect(layoutZoneLabel(z, hostTheme, measure, { text: 'Beta' })!.name!.text).toBe('Beta');
    });
});

describe('svgAspect', () => {
    it('reads width over height from the view box, else the size, else 1', () => {
        expect(svgAspect('<svg viewBox="0 0 400 100"/>')).toBe(4);
        expect(svgAspect('<svg viewBox="10, 20, 30, 60"/>')).toBe(0.5);
        expect(svgAspect('<svg width="300" height="150"/>')).toBe(2);
        expect(svgAspect('<svg/>')).toBe(1);
    });
});

describe('contentLabelResolver', () => {
    const languages = { default: 'en', others: ['pl'] };
    const booth = zone('Booth 1', rect(0, 0, 3, 3), { labels: { pl: 'Stoisko 1', de: 'Stand 1' } });
    const textOf = (resolver: LabelResolver | undefined, z: Zone = booth) =>
        zoneLabelText(z, resolver?.(z));

    it('shows the label in the visitor’s language, else the default', () => {
        expect(textOf(contentLabelResolver(undefined, languages, 'pl-PL'))).toBe('Stoisko 1');
        expect(textOf(contentLabelResolver(undefined, languages, 'en'))).toBe('Booth 1');
        expect(textOf(contentLabelResolver(undefined, languages, 'uk'))).toBe('Booth 1');
        // A language the Space does not offer stays hidden.
        expect(textOf(contentLabelResolver(undefined, languages, 'de'))).toBe('Booth 1');
    });

    it('puts the host’s text first and tells the host the language', () => {
        const asked: (string | undefined)[] = [];
        const host: LabelResolver = (_, language) => {
            asked.push(language);
            return { text: 'ACME' };
        };

        expect(textOf(contentLabelResolver(host, languages, 'pl'))).toBe('ACME');
        expect(asked).toEqual(['pl']);
    });

    it('keeps the host’s logo when the name comes from a translation', () => {
        const host: LabelResolver = () => ({ logo: '<svg/>' });

        expect(contentLabelResolver(host, languages, 'pl')!(booth)).toEqual({
            logo: '<svg/>',
            text: 'Stoisko 1',
        });
    });

    it('is the host’s own resolver without a language', () => {
        const host: LabelResolver = () => undefined;

        expect(contentLabelResolver(host, languages, undefined)).toBe(host);
        expect(contentLabelResolver(undefined, languages, undefined)).toBeUndefined();
    });

    it('shows a translation of a Zone that has no label in the default language', () => {
        const unnamed = zone(undefined, rect(0, 0, 3, 3), { labels: { pl: 'Kawiarnia' } });

        expect(textOf(contentLabelResolver(undefined, languages, 'pl'), unnamed)).toBe('Kawiarnia');
        expect(textOf(contentLabelResolver(undefined, languages, 'en'), unnamed)).toBeUndefined();
    });
});
