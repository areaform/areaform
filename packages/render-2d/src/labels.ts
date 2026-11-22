// How Zone names, Zone icons and logos, and Stop icons are laid out, shared by the 2D and 3D views (ADR-0010): which
// words, where, on how many lines and how big. Zoom-independent; each view hides what is too
// small on screen.
import {
    containsPoint,
    containsRing,
    textIn,
    type ContentLanguages,
    type Ring,
    type Shape,
    type Vec2,
    type Zone,
} from '@areaform/core';
import { visualCenter } from './polylabel.ts';
import type { Theme } from './theme.ts';

/** What a host shows on a Zone at runtime, over the Document: e.g. an exhibitor's name and logo. */
export interface LabelOverride {
    /** Replaces the Zone's name; `''` shows none. */
    text?: string;
    /** A logo in its own colours, as SVG markup, shown above the name instead of a category icon. */
    logo?: string;
    /** How strongly the name shows, 0–1 (default 1), e.g. faded to mark it as provisional. */
    opacity?: number;
}

/**
 * A host's runtime name and logo for a Zone; `undefined` keeps the Document's own. Never saved.
 * `language` is the visitor's Content Language, when the view has one, so a host can return its
 * own text in that language.
 */
export type LabelResolver = (zone: Zone, language?: string) => LabelOverride | undefined;

/** The words shown on a Zone: the host's, else its label. */
export function zoneLabelText(zone: Zone, override?: LabelOverride): string | undefined {
    return (override?.text !== undefined ? override.text : zone.label) || undefined;
}

/**
 * The one resolver both views and the 3D labels use (ADR-0011): a Zone shows the host's text,
 * else its label in the visitor's Content Language, else its label in the default. The host's
 * logo stays either way, and the host is told the language. Without a language it is the host's.
 */
export function contentLabelResolver(
    host: LabelResolver | undefined,
    languages: ContentLanguages | undefined,
    language: string | undefined,
): LabelResolver | undefined {
    if (language === undefined) return host;
    return (zone) => {
        const own = host?.(zone, language);
        if (own?.text !== undefined) return own;
        const text = textIn(zone.label, zone.labels, languages, language);
        return text === zone.label ? own : { ...own, text: text ?? '' };
    };
}

/** The width of a line of text at a font size of 1, so in font heights. */
export type LabelMeasure = (text: string) => number;

/** The font every label is drawn and measured in. */
export const LABEL_FONT = 'system-ui, sans-serif';
/** Distance between the middles of two lines, in font heights. */
export const LABEL_LINE_HEIGHT = 1.2;
/** Room left between a label and its Zone's edge, in font heights. */
const LABEL_MARGIN = 0.15;
/** Rough width of a character, in font heights, where no canvas can measure (system-ui averages a little less). */
const LABEL_CHAR_EM = 0.6;
/** A label is never shrunk below this share of its size; it is hidden instead. */
const MIN_SHRINK = 0.2;

let measureContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
const measured = new Map<string, number>();

/**
 * Measures text in the label font with the browser's canvas, so both views fit the same widths;
 * falls back to an estimate from its length where there is no canvas (tests, servers).
 */
export const measureLabel: LabelMeasure = (text) => {
    let width = measured.get(text);
    if (width !== undefined) return width;
    if (measureContext === undefined) measureContext = createMeasureContext();
    if (measureContext) {
        measureContext.font = `100px ${LABEL_FONT}`;
        width = measureContext.measureText(text).width / 100;
    } else width = text.length * LABEL_CHAR_EM;
    measured.set(text, width);
    return width;
};

function createMeasureContext() {
    try {
        if (typeof OffscreenCanvas !== 'undefined')
            return new OffscreenCanvas(1, 1).getContext('2d');
        return globalThis.document?.createElement('canvas').getContext('2d') ?? null;
    } catch {
        return null;
    }
}

/** A Zone's name as laid out on the plan. */
export interface NameLayout {
    /** The whole name. */
    text: string;
    /** One or two lines, drawn centred one below the other. */
    lines: string[];
    /** The middle of the text, plan metres. */
    position: Vec2;
    /** Font height, metres: the Zone's `labelSize` or the Theme's, shrunk to fit inside the Zone. */
    size: number;
    /** Width of the longest line, in font heights. */
    width: number;
    /** Height of the text, in font heights: 1 for a single line. */
    height: number;
}

/** A Zone's picture as laid out on the plan: its category icon or the host's logo. */
export interface IconLayout {
    svg: string;
    /** A logo keeps its own colours; an icon is a one-colour silhouette in the name's colour. */
    logo: boolean;
    /** Its middle, plan metres. */
    position: Vec2;
    /** Height, metres. */
    size: number;
    /** Width, metres: `size` for a square icon, more for a wide logo. */
    width: number;
}

/** What a Zone shows: its name, its picture above it, or either alone. */
export interface LabelLayout {
    name: NameLayout | null;
    icon: IconLayout | null;
}

/** Room between a picture and the name below it, in font heights. */
const ICON_GAP = 0.25;

/** Layouts by Zone: Zones never change in place (ADR-0005), and fitting is not free. */
const layouts = new WeakMap<
    Zone,
    {
        theme: Theme;
        measure: LabelMeasure;
        text: string | undefined;
        logo: string | undefined;
        layout: LabelLayout | null;
    }
>();

/**
 * Lays out a Zone's name and its picture: the host's logo (from `override`), else its category
 * icon (from `theme.categoryIcons`). The picture sits centred above the name at twice its height
 * (at most `theme.zoneIconSize`; a logo keeps its proportions, at most `theme.zoneLogoSize` wide).
 * The name goes on one line or, when that lets it be bigger, two; then both are made as large as
 * fits inside the Zone, up to its size. When the pair cannot fit, the name is left out and the
 * picture shown alone. A label whose anchor lies outside the Zone is left at full size.
 */
export function layoutZoneLabel(
    zone: Zone,
    theme: Theme,
    measure: LabelMeasure = measureLabel,
    override?: LabelOverride,
): LabelLayout | null {
    const text = zoneLabelText(zone, override);
    const logo = override?.logo || undefined;
    const cached = layouts.get(zone);
    if (
        cached?.theme === theme &&
        cached.measure === measure &&
        cached.text === text &&
        cached.logo === logo
    )
        return cached.layout;
    const layout = fitLabel(zone, theme, measure, text, logo);
    layouts.set(zone, { theme, measure, text, logo, layout });
    return layout;
}

/** The Theme's icon for a Zone's category, if it has one. */
function iconOf(zone: Zone, theme: Theme): string | undefined {
    return zone.category !== undefined
        ? theme.categoryIcons[zone.category] || undefined
        : undefined;
}

/** Width over height of SVG markup, from its view box or size; 1 when it gives neither. */
export function svgAspect(svg: string): number {
    const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
    const box = /\sviewBox="([^"]+)"/
        .exec(root)?.[1]
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
    if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) return box[2]! / box[3]!;
    const width = Number(/\swidth="([\d.]+)/.exec(root)?.[1]);
    const height = Number(/\sheight="([\d.]+)/.exec(root)?.[1]);
    return width > 0 && height > 0 ? width / height : 1;
}

function fitLabel(
    zone: Zone,
    theme: Theme,
    measure: LabelMeasure,
    text: string | undefined,
    logo: string | undefined,
): LabelLayout | null {
    const svg = logo ?? iconOf(zone, theme);
    if (!text && !svg) return null;
    const [x, y] = zone.labelAnchor ?? centreOf(zone.shape);
    const largest = zone.labelSize ?? theme.labelSize;
    const aspect = logo ? svgAspect(logo) : 1;
    /** The picture's width and height beside a name `size` high; nothing without one. */
    const pictureFor = (size: number): [number, number] => {
        if (!svg) return [0, 0];
        const height = Math.min(2 * size, theme.zoneIconSize);
        if (logo && height * aspect > theme.zoneLogoSize)
            return [theme.zoneLogoSize, theme.zoneLogoSize / aspect];
        return [height * aspect, height];
    };
    const picture = (position: Vec2, [width, height]: [number, number]): IconLayout | null =>
        svg ? { svg, logo: logo !== undefined, position, size: height, width } : null;
    const inside = containsPoint(zone.shape, [x, y]);

    /** The name at `size`, and the picture above it, as a pair centred on the anchor. */
    const pair = (lines: string[], width: number, height: number, size: number): LabelLayout => {
        const dims = pictureFor(size);
        const gap = svg ? ICON_GAP * size : 0;
        const total = dims[1] + gap + height * size;
        return {
            name: {
                text: text!,
                lines,
                position: [x, y - total / 2 + (height * size) / 2],
                size,
                width,
                height,
            },
            icon: picture([x, y + total / 2 - dims[1] / 2], dims),
        };
    };

    if (text) {
        let best: LabelLayout | null = null;
        for (const lines of lineChoices(text)) {
            const width = Math.max(...lines.map(measure));
            const height = 1 + (lines.length - 1) * LABEL_LINE_HEIGHT;
            const fits = (size: number) => {
                const [pw, ph] = pictureFor(size);
                const w = Math.max(width * size, pw) + 2 * LABEL_MARGIN * size;
                const h = ph + (svg ? ICON_GAP * size : 0) + (height + 2 * LABEL_MARGIN) * size;
                return containsRing(zone.shape, box([x, y], w, h));
            };
            const size = !inside || fits(largest) ? largest : largestFitting(fits, largest);
            if (size > (best?.name?.size ?? 0)) best = pair(lines, width, height, size);
        }
        if (best) return best;
    }
    if (!svg) return null;
    // A picture alone: the Zone has no name, or no room for one.
    const [fullWidth, fullHeight] = pictureFor(largest);
    const fits = (scale: number) =>
        containsRing(zone.shape, box([x, y], fullWidth * scale * 1.1, fullHeight * scale * 1.1));
    const scale = !inside || fits(1) ? 1 : largestFitting(fits, 1);
    return scale > 0
        ? { name: null, icon: picture([x, y], [fullWidth * scale, fullHeight * scale]) }
        : null;
}

/** The single line, then the two-line split with the most even halves (when there is a space). */
function lineChoices(text: string): string[][] {
    const choices = [[text]];
    let split = -1;
    for (let i = text.indexOf(' '); i !== -1; i = text.indexOf(' ', i + 1)) {
        if (split === -1 || Math.abs(text.length / 2 - i) < Math.abs(text.length / 2 - split))
            split = i;
    }
    if (split > 0) {
        const first = text.slice(0, split).trimEnd();
        const second = text.slice(split + 1).trimStart();
        if (first && second) choices.push([first, second]);
    }
    return choices;
}

/** The largest size between MIN_SHRINK × `largest` and `largest` that fits, or 0 when none does. */
function largestFitting(fits: (size: number) => boolean, largest: number): number {
    let low = largest * MIN_SHRINK;
    if (!fits(low)) return 0;
    let high = largest;
    for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
    }
    return low;
}

function box([x, y]: Vec2, width: number, height: number): Ring {
    const w = width / 2;
    const h = height / 2;
    return [
        [x - w, y - h],
        [x + w, y - h],
        [x + w, y + h],
        [x - w, y + h],
    ];
}

/** Visual centres by shape: shapes never change in place, and polylabel is not cheap. */
const centres = new WeakMap<Shape, Vec2>();

/** A shape's visual centre (polylabel), where its name or icon goes. */
export function centreOf(shape: Shape): Vec2 {
    let centre = centres.get(shape);
    if (!centre) {
        centre = visualCenter(shape);
        centres.set(shape, centre);
    }
    return centre;
}

/** How much of a Stop's narrower side its icon may take. */
const ICON_FILL = 0.6;

/** Where a Stop's Connection icon goes and how big it is, metres: the Theme's size, or less in a small Stop. */
export function layoutStopIcon(shape: Shape, theme: Theme): { position: Vec2; size: number } {
    const xs = shape.outer.map((p) => p[0]);
    const ys = shape.outer.map((p) => p[1]);
    const narrower = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return {
        position: centreOf(shape),
        size: Math.min(theme.connectionIconSize, ICON_FILL * narrower),
    };
}
