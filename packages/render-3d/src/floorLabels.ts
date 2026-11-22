// Zone names painted on the floor and Connection icons on their Stops (ADR-0010), as plain arrays:
// where each label goes and how big, how big its bitmap is, and the quads that show it from an
// atlas. Pure: no Three.js, no canvas.
import type { AreaformDocument, Id, Level } from '@areaform/core';
import {
    layoutStopIcon,
    layoutZoneLabel,
    type LabelMeasure,
    type LabelResolver,
    type Theme,
} from '@areaform/render-2d';
import type { AtlasPlace } from './atlas.ts';
import type { ColorParser } from './meshes.ts';
import type { Theme3D } from './theme3d.ts';
import type { Vec3 } from './view.ts';

/** Labels float this far above the floor: over Zones and door thresholds. */
export const LABEL_LIFT = 0.014;
/** Font height labels are drawn into their bitmap at, pixels; the SDF keeps them sharp larger. */
export const LABEL_FONT_PX = 24;
/** Size icons are drawn into their bitmap at, pixels: their thin strokes need more than text. */
export const ICON_PX = 48;
/** A logo's longer side in its bitmap, pixels: colours have no distance field to sharpen them. */
export const LOGO_PX = 192;
/** Empty pixels around a logo, so sampling at its edge never bleeds into a neighbour. */
export const LOGO_PAD = 1;
/** How far the distance field reaches past the text, pixels; also the bitmap's padding. */
export const SDF_RADIUS = 6;

/** A Zone name, or a Connection icon when `svg` is set; drawn alike, as a flat quad. */
export interface FloorLabel {
    /** The Zone's id, or the Connection's for an icon. */
    id: Id;
    lines: string[];
    /** SVG markup drawn instead of text: one colour, or in its own colours with `logo`. */
    svg?: string;
    /** A host's logo in its own colours; `width` is then its width over its height. */
    logo?: true;
    /** The middle of the text, world space, just above the floor (or the top of a Stop). */
    position: Vec3;
    /** Font height, or the icon's width, metres. */
    size: number;
    /** Width of the longest line and height of the text, in font heights; 1 for an icon. */
    width: number;
    height: number;
    /** CSS colour. */
    color: string;
    /** 0–1; 1 when absent. */
    opacity?: number;
}

export interface LabelOptions {
    theme: Theme;
    theme3d: Theme3D;
    measure?: LabelMeasure;
    /** A host's runtime names and logos for Zones. */
    labelResolver?: LabelResolver;
}

/**
 * Every Zone name and picture on a Level, laid out as in 2D: a category icon in the name's colour,
 * or a host's logo in its own; which ones are too small is left to the shader.
 */
export function buildLevelLabels(level: Level, options: LabelOptions): FloorLabel[] {
    const { theme, theme3d, measure, labelResolver } = options;
    const fallback = theme3d.label ?? theme.label.fill ?? '#2b2b29';
    return level.zones.flatMap((zone) => {
        const override = labelResolver?.(zone);
        const layout = layoutZoneLabel(zone, theme, measure, override);
        if (!layout) return [];
        const color = zone.labelColor ?? fallback;
        const labels: FloorLabel[] = [];
        if (layout.icon) {
            const [x, y] = layout.icon.position;
            labels.push({
                id: zone.id,
                lines: [],
                svg: layout.icon.svg,
                ...(layout.icon.logo && { logo: true as const }),
                position: [x, LABEL_LIFT, -y],
                size: layout.icon.size,
                width: layout.icon.width / layout.icon.size,
                height: 1,
                color,
            });
        }
        if (layout.name) {
            const [x, y] = layout.name.position;
            labels.push({
                id: zone.id,
                lines: layout.name.lines,
                position: [x, LABEL_LIFT, -y],
                size: layout.name.size,
                width: layout.name.width,
                height: layout.name.height,
                color,
                ...(override?.opacity !== undefined && { opacity: override.opacity }),
            });
        }
        return labels;
    });
}

/** Each Stop's Connection icon on the Level, on top of its block, sized as in 2D. */
export function buildStopIcons(
    doc: AreaformDocument,
    level: Level,
    options: Omit<LabelOptions, 'measure'>,
): FloorLabel[] {
    const { theme, theme3d } = options;
    return doc.connections.flatMap((connection) => {
        const look = theme3d.connections[connection.kind];
        const top = look.height ?? level.height;
        return connection.stops.flatMap((stop) => {
            if (stop.levelId !== level.id) return [];
            const { position, size } = layoutStopIcon(stop.shape, theme);
            const [x, y] = position;
            return [
                {
                    id: connection.id,
                    lines: [],
                    svg: theme.connectionIcons[connection.kind],
                    position: [x, top + LABEL_LIFT, -y] as Vec3,
                    size,
                    width: 1,
                    height: 1,
                    color: look.icon ?? theme.connectionIcon.stroke ?? '#5b3f8a',
                },
            ];
        });
    });
}

export interface LabelBitmap {
    /** Pixels, padding included. */
    width: number;
    height: number;
    /** Font height drawn at: `LABEL_FONT_PX`, or less for a name too long for one page. */
    fontPx: number;
}

/** The bitmap a label is drawn into, at most `pageSize` wide. */
export function labelBitmap(label: FloorLabel, pageSize: number): LabelBitmap {
    if (label.logo) {
        // Its longer side LOGO_PX; `fontPx` is its height, so the quad comes out `size` tall.
        const aspect = label.width;
        const height = Math.round(aspect >= 1 ? LOGO_PX / aspect : LOGO_PX);
        return {
            width: Math.round(height * aspect) + 2 * LOGO_PAD,
            height: height + 2 * LOGO_PAD,
            fontPx: height,
        };
    }
    if (label.svg !== undefined)
        return {
            width: ICON_PX + 2 * SDF_RADIUS,
            height: ICON_PX + 2 * SDF_RADIUS,
            fontPx: ICON_PX,
        };
    const fit = (pageSize - 2 * SDF_RADIUS - 1) / label.width;
    const fontPx = Math.max(1, Math.min(LABEL_FONT_PX, Math.floor(fit)));
    return {
        width: Math.ceil(label.width * fontPx) + 2 * SDF_RADIUS,
        height: Math.ceil(label.height * fontPx) + 2 * SDF_RADIUS,
        fontPx,
    };
}

/** One atlas page's quads: four corners per label, two triangles each. */
export interface LabelQuads {
    /** The label's middle, x, y, z per corner. */
    positions: Float32Array;
    /** The corner's offset from the middle, plan metres (x east, y north), x, y per corner. */
    offsets: Float32Array;
    /** Where the corner is on the page, 0–1, v down from the top row; u, v per corner. */
    uvs: Float32Array;
    /** r, g, b, a per corner. */
    colors: Float32Array;
    /** The label's font height, metres, per corner, for hiding labels too small on screen. */
    sizes: Float32Array;
    indices: Uint32Array;
}

/** The quads of every label on each page, from where the atlas put their bitmaps. */
export function labelQuads(
    labels: FloorLabel[],
    bitmaps: LabelBitmap[],
    places: AtlasPlace[],
    pages: number,
    pageSize: number,
    color: ColorParser,
): LabelQuads[] {
    const counts = new Array<number>(pages).fill(0);
    for (const place of places) counts[place.page]!++;
    const quads = counts.map((n) => ({
        positions: new Float32Array(n * 12),
        offsets: new Float32Array(n * 8),
        uvs: new Float32Array(n * 8),
        colors: new Float32Array(n * 16),
        sizes: new Float32Array(n * 4),
        indices: new Uint32Array(n * 6),
    }));
    const filled = new Array<number>(pages).fill(0);
    labels.forEach((label, i) => {
        const bitmap = bitmaps[i]!;
        const place = places[i]!;
        const q = quads[place.page]!;
        const n = filled[place.page]!++;
        // The bitmap's middle sits on the label's middle; its padding shows nothing.
        const w = ((bitmap.width / bitmap.fontPx) * label.size) / 2;
        const h = ((bitmap.height / bitmap.fontPx) * label.size) / 2;
        const u0 = place.x / pageSize;
        const u1 = (place.x + bitmap.width) / pageSize;
        const v0 = place.y / pageSize;
        const v1 = (place.y + bitmap.height) / pageSize;
        // Top-left, top-right, bottom-right, bottom-left; the top is north on the plan.
        const corners = [
            [-w, h, u0, v0],
            [w, h, u1, v0],
            [w, -h, u1, v1],
            [-w, -h, u0, v1],
        ] as const;
        const rgb = color(label.color);
        corners.forEach(([ox, oy, u, v], c) => {
            const k = n * 4 + c;
            q.positions.set(label.position, k * 3);
            q.offsets.set([ox, oy], k * 2);
            q.uvs.set([u, v], k * 2);
            q.colors.set([...rgb, label.opacity ?? 1], k * 4);
            q.sizes[k] = label.size;
        });
        // Counter-clockwise seen from above.
        const base = n * 4;
        q.indices.set([base, base + 3, base + 2, base, base + 2, base + 1], n * 6);
    });
    return quads;
}
