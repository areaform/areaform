import {
    containsPoint,
    type Connection,
    resolveOpening,
    wallOutlines,
    type ElementRef,
    type AreaformDocument,
    type Id,
    type Level,
    type Opening,
    type Shape,
    type Vec2,
    type Zone,
} from '@areaform/core';
import {
    layoutStopIcon,
    layoutZoneLabel,
    type LabelMeasure,
    type LabelResolver,
} from './labels.ts';
import type { Box } from './camera.ts';
import { defaultTheme, mergeStyles, type Style, type Theme } from './theme.ts';

/** One thing to draw, in plan coordinates (metres, Y-up), listed in paint order. */
export type SceneItem =
    | { type: 'polygon'; ref: ElementRef; shape: Shape; style: Style }
    | {
          type: 'opening';
          ref: ElementRef;
          kind: Opening['kind'];
          position: Vec2;
          angle: number;
          width: number;
          /** How far the gap reaches across the wall, metres. */
          depth: number;
          /** For doors: the jamb the leaf hangs from, along `angle` (`start` is at −width/2). */
          hinge: 'start' | 'end';
          /** For doors: the side the leaf opens to, looking along `angle`. */
          swing: 'left' | 'right';
          /**
           * The side (looking along `angle`) inside the Outline, when only one side is: an
           * entrance points in from there, an emergency exit out. Absent for inner Openings.
           */
          inside?: 'left' | 'right';
          style: Style;
      }
    | {
          type: 'label';
          ref: ElementRef;
          text: string;
          /** One or two lines, centred one below the other. */
          lines: string[];
          position: Vec2;
          /** Font height, metres. */
          size: number;
          style: Style;
      }
    /**
     * An icon: a Connection's in one of its Stops, or a Zone Category's above the Zone's name. SVG
     * markup drawn as a one-colour silhouette in `style.stroke`, centred, `size` metres across.
     */
    | {
          type: 'icon';
          ref: ElementRef;
          /** The Connection's kind; absent for a Zone's icon. */
          kind?: Connection['kind'];
          svg: string;
          position: Vec2;
          size: number;
          style: Style;
      }
    /** A host's logo on a Zone, in its own colours: SVG markup fitted whole into the box, centred. */
    | {
          type: 'logo';
          ref: ElementRef;
          svg: string;
          position: Vec2;
          /** Metres. */
          width: number;
          height: number;
      }
    | {
          type: 'image';
          ref: ElementRef;
          src: string;
          position: Vec2;
          scale: number;
          rotation: number;
          opacity: number;
      };

/** A host's runtime look for an Element (e.g. booth status); never saved. */
export type StyleResolver = (ref: ElementRef, element: unknown) => Style | undefined;

/**
 * Turns an Underlay's `src` (a URL, a relative path or an asset id) into a URL the browser can
 * load, e.g. a file the host holds as a `blob:` URL. The Document keeps the original `src`.
 */
export type AssetResolver = (src: string) => string;

export interface SceneOptions {
    /** Current camera zoom, screen pixels per metre; drives level-of-detail. */
    zoom: number;
    theme?: Theme;
    styleResolver?: StyleResolver;
    resolveAsset?: AssetResolver;
    highlight?: ElementRef[];
    /** Measures label text; the browser's canvas by default. */
    measure?: LabelMeasure;
    /** A host's runtime names and logos for Zones. */
    labelResolver?: LabelResolver;
}

const refKey = (ref: ElementRef) => `${ref.kind}:${ref.id}:${'levelId' in ref ? ref.levelId : ''}`;

export function buildScene(doc: AreaformDocument, levelId: Id, options: SceneOptions): SceneItem[] {
    const level = doc.levels.find((l) => l.id === levelId);
    if (!level) return [];
    const theme = options.theme ?? defaultTheme;
    const highlighted = new Set((options.highlight ?? []).map(refKey));
    const { zoom } = options;
    const style = (ref: ElementRef, element: unknown, ...base: (Style | undefined)[]) =>
        mergeStyles(
            ...base,
            options.styleResolver?.(ref, element),
            highlighted.has(refKey(ref)) ? theme.highlight : undefined,
        );
    const visible = (metres: number) => metres * zoom >= theme.minFeaturePx;

    const items: SceneItem[] = [];

    const outlineRef: ElementRef = { kind: 'level', id: levelId };
    items.push({
        type: 'polygon',
        ref: outlineRef,
        shape: level.outline,
        style: style(outlineRef, level, theme.outline),
    });

    // Above the opaque floor fill, below everything drawn on the floor.
    for (const underlay of level.underlays) {
        const { position, scale, rotation, opacity } = underlay;
        const ref: ElementRef = { kind: 'underlay', id: underlay.id, levelId };
        const src = options.resolveAsset?.(underlay.src) ?? underlay.src;
        items.push({ type: 'image', ref, src, position, scale, rotation, opacity });
    }

    for (const zone of level.zones) {
        const ref: ElementRef = { kind: 'zone', id: zone.id, levelId };
        const zoneStyle = style(
            ref,
            zone,
            theme.zone,
            zone.category !== undefined ? theme.categories[zone.category] : undefined,
            zone.restricted ? theme.restricted : undefined,
            zone.style,
        );
        items.push({ type: 'polygon', ref, shape: zone.shape, style: zoneStyle });
    }

    for (const obstacle of level.obstacles) {
        if (!visible(extent(obstacle.shape))) continue;
        const ref: ElementRef = { kind: 'obstacle', id: obstacle.id, levelId };
        items.push({
            type: 'polygon',
            ref,
            shape: obstacle.shape,
            style: style(ref, obstacle, theme.obstacle),
        });
    }

    for (const connection of doc.connections) {
        for (const stop of connection.stops) {
            if (stop.levelId !== levelId) continue;
            const ref: ElementRef = { kind: 'stop', id: connection.id, levelId };
            items.push({
                type: 'polygon',
                ref,
                shape: stop.shape,
                style: style(ref, connection, theme.stop),
            });
        }
    }

    const wallShapes = wallOutlines(level);
    for (const wall of level.walls) {
        const shape = wallShapes.get(wall.id);
        if (!shape) continue;
        const ref: ElementRef = { kind: 'wall', id: wall.id, levelId };
        items.push({ type: 'polygon', ref, shape, style: style(ref, wall, theme.wall) });
    }

    const thickness = new Map(level.walls.map((w) => [w.id, w.thickness]));
    for (const opening of level.openings) {
        if (!visible(opening.width)) continue;
        const placement = resolveOpening(level, opening);
        if (!placement) continue;
        const ref: ElementRef = { kind: 'opening', id: opening.id, levelId };
        const depth =
            opening.host === 'wall'
                ? (thickness.get(opening.wallId) ?? theme.freeOpeningDepth)
                : theme.freeOpeningDepth;
        items.push({
            type: 'opening',
            ref,
            kind: opening.kind,
            position: placement.position,
            angle: placement.angle,
            width: opening.width,
            depth,
            hinge: opening.hinge ?? 'start',
            swing: opening.swing ?? 'left',
            ...insideSide(level, placement.position, placement.angle, depth),
            style: style(
                ref,
                opening,
                theme.opening,
                opening.kind === 'emergency-exit' ? theme.emergencyExit : undefined,
            ),
        });
    }

    for (const connection of doc.connections) {
        for (const stop of connection.stops) {
            if (stop.levelId !== levelId) continue;
            const ref: ElementRef = { kind: 'stop', id: connection.id, levelId };
            const { position, size } = layoutStopIcon(stop.shape, theme);
            if (size * zoom < theme.minLabelPx) continue;
            items.push({
                type: 'icon',
                ref,
                kind: connection.kind,
                svg: theme.connectionIcons[connection.kind],
                position,
                size,
                style: style(ref, connection, theme.connectionIcon),
            });
        }
    }

    for (const zone of level.zones)
        items.push(
            ...zoneLabel(zone, levelId, theme, zoom, options.measure, options.labelResolver),
        );

    return items;
}

/** A Zone's name and category icon as scene items, leaving out either one too small at this zoom. */
/**
 * A Zone's name and picture (category icon or host logo) as scene items, leaving out either one
 * too small at this zoom.
 */
function zoneLabel(
    zone: Zone,
    levelId: Id,
    theme: Theme,
    zoom: number,
    measure?: LabelMeasure,
    resolver?: LabelResolver,
): SceneItem[] {
    const override = resolver?.(zone);
    const layout = layoutZoneLabel(zone, theme, measure, override);
    if (!layout) return [];
    const ref: ElementRef = { kind: 'zone', id: zone.id, levelId };
    const colour = zone.labelColor ?? theme.label.fill;
    const items: SceneItem[] = [];
    const { name, icon } = layout;
    if (icon && icon.size * zoom >= theme.minLabelPx) {
        items.push(
            icon.logo
                ? {
                      type: 'logo',
                      ref,
                      svg: icon.svg,
                      position: icon.position,
                      width: icon.width,
                      height: icon.size,
                  }
                : {
                      type: 'icon',
                      ref,
                      svg: icon.svg,
                      position: icon.position,
                      size: icon.size,
                      style: colour !== undefined ? { stroke: colour } : {},
                  },
        );
    }
    if (name && name.size * zoom >= theme.minLabelPx) {
        items.push({
            type: 'label',
            ref,
            text: name.text,
            lines: name.lines,
            position: name.position,
            size: name.size,
            style: {
                ...theme.label,
                ...(zone.labelColor && { fill: zone.labelColor }),
                ...(override?.opacity !== undefined && { opacity: override.opacity }),
            },
        });
    }
    return items;
}

/**
 * The plan area each Zone name and picture drawn at this zoom covers, e.g. so editor labels and
 * handles can stay clear of it.
 */
export function zoneLabelBoxes(
    level: Level,
    zoom: number,
    theme: Theme = defaultTheme,
    measure?: LabelMeasure,
    resolver?: LabelResolver,
): Box[] {
    return level.zones.flatMap((zone) =>
        zoneLabel(zone, level.id, theme, zoom, measure, resolver).flatMap((item): Box[] => {
            let half: Vec2;
            if (item.type === 'label') {
                const { name } = layoutZoneLabel(zone, theme, measure, resolver?.(zone))!;
                half = [(name!.width * name!.size) / 2, (name!.height * name!.size) / 2];
            } else if (item.type === 'logo') half = [item.width / 2, item.height / 2];
            else if (item.type === 'icon') half = [item.size / 2, item.size / 2];
            else return [];
            const [x, y] = item.position;
            return [{ minX: x - half[0], minY: y - half[1], maxX: x + half[0], maxY: y + half[1] }];
        }),
    );
}

/** Largest side of a shape's bounding box, metres. */
function extent(shape: Shape): number {
    const xs = shape.outer.map((p) => p[0]);
    const ys = shape.outer.map((p) => p[1]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** Which side of an Opening is inside the Outline, probing just past each face of the gap. */
function insideSide(
    level: Level,
    [x, y]: Vec2,
    angle: number,
    depth: number,
): { inside?: 'left' | 'right' } {
    const reach = depth / 2 + 0.05;
    const [nx, ny] = [-Math.sin(angle) * reach, Math.cos(angle) * reach];
    const left = containsPoint(level.outline, [x + nx, y + ny]);
    const right = containsPoint(level.outline, [x - nx, y - ny]);
    if (left === right) return {};
    return { inside: left ? 'left' : 'right' };
}
