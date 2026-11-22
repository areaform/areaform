// Zones in 3D, apart from the rest of the Level: their look changes at runtime (a host's Style
// Overrides, a highlight), and rebuilding only them leaves the Walls and the baked labels alone.
// Pure, like meshes.ts.
import type { ElementRef, Level, Ring } from '@areaform/core';
import { mergeStyles, type StyleResolver, type Theme } from '@areaform/render-2d';
import { MeshBuilder, ZONE_LIFT, type ColorParser, type MeshData } from './meshes.ts';

/** Zone outlines float this far above the floor: over Zones and thresholds, under names. */
export const OUTLINE_LIFT = 0.013;

/**
 * Line segments of one width, in screen pixels, and one opacity: every two points are a segment.
 * Highlighted outlines are kept apart so they can be drawn over a neighbour's on a shared edge.
 */
export interface OutlineData {
    width: number;
    /** The Zone's opacity, as 2D gives its stroke. */
    opacity: number;
    highlight: boolean;
    /** x, y, z per point. */
    positions: Float32Array;
    /** r, g, b per point. */
    colors: Float32Array;
}

export interface ZoneLayer {
    opaque: MeshData;
    /** Zones drawn with an opacity below 1. */
    transparent: MeshData;
    outlines: OutlineData[];
}

export interface ZoneLayerOptions {
    theme: Theme;
    color: ColorParser;
    styleResolver?: StyleResolver;
    highlight?: ElementRef[];
}

const refKey = (ref: ElementRef) => `${ref.kind}:${ref.id}:${'levelId' in ref ? ref.levelId : ''}`;

/**
 * The Level's Zones in their look as in 2D: the Theme, the category, `restricted`, the Zone's own
 * style, then the host's Style Override and the highlight, each Zone filled and outlined in its
 * stroke, so a row of booths reads as separate booths. Zones later in the list draw their outline
 * over earlier ones on a shared edge, as in 2D.
 */
export function buildZoneLayer(level: Level, options: ZoneLayerOptions): ZoneLayer {
    const { theme, color } = options;
    const highlighted = new Set((options.highlight ?? []).map(refKey));
    const opaque = new MeshBuilder();
    const transparent = new MeshBuilder();
    const lines = new Map<
        string,
        { width: number; opacity: number; highlight: boolean; points: number[] }
    >();

    for (const zone of level.zones) {
        const ref: ElementRef = { kind: 'zone', id: zone.id, levelId: level.id };
        const highlight = highlighted.has(refKey(ref));
        const runtime = mergeStyles(
            options.styleResolver?.(ref, zone),
            highlight ? theme.highlight : undefined,
        );
        const style = mergeStyles(
            theme.zone,
            zone.category !== undefined ? theme.categories[zone.category] : undefined,
            zone.restricted ? theme.restricted : undefined,
            zone.style,
            runtime,
        );
        const opacity = style.opacity ?? 1;
        if (opacity <= 0) continue;
        const target = opacity < 1 ? transparent : opaque;
        target.cap(zone.shape, ZONE_LIFT, [...color(style.fill ?? '#dbe7f5'), opacity], 'up');

        const width = style.strokeWidth ?? 1;
        if (style.stroke === undefined || width <= 0) continue;
        const key = `${width}:${opacity}:${highlight}`;
        let group = lines.get(key);
        if (!group) lines.set(key, (group = { width, opacity, highlight, points: [] }));
        const rgb = color(style.stroke);
        for (const ring of [zone.shape.outer, ...(zone.shape.holes ?? [])])
            pushRing(group.points, ring, rgb);
    }

    const outlines = [...lines.values()].map(({ points, ...look }): OutlineData => {
        const count = points.length / 6;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions.set(points.slice(6 * i, 6 * i + 3), 3 * i);
            colors.set(points.slice(6 * i + 3, 6 * i + 6), 3 * i);
        }
        return { ...look, positions, colors };
    });
    return { opaque: opaque.build(), transparent: transparent.build(), outlines };
}

/** A closed ring as segments, each point as x, y, z, r, g, b. */
function pushRing(out: number[], ring: Ring, [r, g, b]: [number, number, number]) {
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % ring.length]!;
        out.push(p[0], OUTLINE_LIFT, -p[1], r, g, b, q[0], OUTLINE_LIFT, -q[1], r, g, b);
    }
}
