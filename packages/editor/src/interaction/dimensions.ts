// Dimension labels for the Overlay: lengths, sizes and areas, in the editor's display units.
import type { ElementRef, AreaformDocument, Id, Level, Shape, Vec2, Wall } from '@areaform/core';
import {
    defaultTheme,
    zoneLabelBoxes,
    type Box,
    type LabelResolver,
    type OverlayItem,
    type Theme,
} from '@areaform/render-2d';
import { findLevel } from './elements.ts';
import { rectangleSides, shapeArea } from './shapeEdit.ts';
import { english, type Translator } from '../i18n/index.ts';
import { formatArea, formatLength, formatSize, type DisplayUnits } from './units.ts';

/** Gap between a measured thing and its label, screen px. */
const LABEL_GAP_PX = 16;
/** In always-on mode, the shortest Wall that gets a label, screen px. */
const MIN_WALL_PX = 80;
/** In always-on mode, the narrowest Zone or Obstacle that gets a label, screen px. */
const MIN_SHAPE_PX = 120;
/**
 * In always-on mode, shape labels sit inside, this far above the bottom edge (label centre), px:
 * clear of a label on a Wall along that edge.
 */
const INSET_PX = 24;
/** …so the shape must be at least this tall on screen to hold one. */
const MIN_SHAPE_HEIGHT_PX = 48;
/** Rough on-screen size of a dimension label (12 px text, 3 px padding), to keep it in view. */
const CHAR_PX = 6;
const LABEL_HALF_HEIGHT_PX = 9;
const LABEL_PADDING_PX = 3;
/** Gap kept between a label and the edge of the view, px. */
const EDGE_PX = 4;

type LabelItem = Extract<OverlayItem, { type: 'label' }>;

/** Where along the visible part of a Wall its label may go, in order of preference. */
const WALL_LABEL_SPOTS = [0.5, 0.3, 0.7, 0.15, 0.85];

/** The plan area an overlay label covers at this zoom (estimated from its text length). */
export function overlayLabelBox(label: LabelItem, zoom: number): Box {
    const [x, y] = label.position;
    const halfWidth = ((label.text.length * CHAR_PX) / 2 + LABEL_PADDING_PX) / zoom;
    const halfHeight = LABEL_HALF_HEIGHT_PX / zoom;
    return { minX: x - halfWidth, minY: y - halfHeight, maxX: x + halfWidth, maxY: y + halfHeight };
}

export function boxesOverlap(a: Box, b: Box): boolean {
    return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** A label beside segment a–b, on its left, offset by a fixed screen distance. */
export function segmentLabel(a: Vec2, b: Vec2, text: string, zoom: number): LabelItem {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const offset = LABEL_GAP_PX / zoom;
    const normal: Vec2 = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
    return {
        type: 'label',
        position: [(a[0] + b[0]) / 2 + normal[0] * offset, (a[1] + b[1]) / 2 + normal[1] * offset],
        text,
    };
}

/** Dimensions of a single selected Wall, Zone or Obstacle; nothing for other selections. */
export function dimensionLabels(
    doc: AreaformDocument,
    levelId: Id,
    selection: ElementRef[],
    zoom: number,
    units: DisplayUnits = 'metric',
    i18n: Translator = english,
): OverlayItem[] {
    const level = findLevel(doc, levelId);
    const ref = selection.length === 1 ? selection[0] : undefined;
    if (!level || !ref) return [];
    if (ref.kind === 'wall') {
        const wall = level.walls.find((w) => w.id === ref.id);
        return wall ? wallLabel(wallIndex(level), wall, zoom, units, i18n) : [];
    }
    const shape =
        ref.kind === 'zone'
            ? level.zones.find((z) => z.id === ref.id)?.shape
            : ref.kind === 'obstacle'
              ? level.obstacles.find((o) => o.id === ref.id)?.shape
              : undefined;
    return shape ? [shapeLabel(shape, zoom, units, i18n)] : [];
}

/**
 * Always-on mode: dimensions of every Wall, Zone and Obstacle on the Level that is big enough on
 * screen to read and, when `visible` is given, overlaps it. Wall labels sit on the Wall and shape
 * labels inside the shape, so neither spills onto neighbours or off the plan.
 */
export function levelDimensionLabels(
    level: Level,
    zoom: number,
    visible?: Box,
    units: DisplayUnits = 'metric',
    i18n: Translator = english,
    theme: Theme = defaultTheme,
    labelResolver?: LabelResolver,
): OverlayItem[] {
    const index = wallIndex(level);
    const inView = (box: Box) =>
        !visible ||
        (box.maxX >= visible.minX &&
            box.minX <= visible.maxX &&
            box.maxY >= visible.minY &&
            box.minY <= visible.maxY);
    /** Moves a label's centre so the whole label stays inside the view. */
    const keepInView = ([x, y]: Vec2, text: string): Vec2 => {
        if (!visible) return [x, y];
        const halfWidth = ((text.length * CHAR_PX) / 2 + LABEL_PADDING_PX + EDGE_PX) / zoom;
        const halfHeight = (LABEL_HALF_HEIGHT_PX + EDGE_PX) / zoom;
        return [
            clamp(x, visible.minX + halfWidth, visible.maxX - halfWidth),
            clamp(y, visible.minY + halfHeight, visible.maxY - halfHeight),
        ];
    };
    // Labels go where they cover neither a Zone name nor a label already placed; one with no
    // free spot is left out. Longer Walls are placed first.
    const taken: Box[] = zoneLabelBoxes(level, zoom, theme, undefined, labelResolver).filter(
        inView,
    );
    const place = (label: LabelItem, spots: Vec2[]): LabelItem | undefined => {
        for (const spot of spots) {
            const placed = { ...label, position: keepInView(spot, label.text) };
            const box = overlayLabelBox(placed, zoom);
            if (taken.some((other) => boxesOverlap(box, other))) continue;
            taken.push(box);
            return placed;
        }
        return undefined;
    };
    const items: OverlayItem[] = [];
    const walls = level.walls.flatMap((wall) => {
        const a = index.positions.get(wall.a);
        const b = index.positions.get(wall.b);
        const length = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
        return a && b && length * zoom >= MIN_WALL_PX ? [{ wall, a, b, length }] : [];
    });
    for (const { wall, a, b } of walls.sort((x, y) => y.length - x.length)) {
        // Label the part of the Wall in view, so a long Wall's label stays on screen.
        const shown: [Vec2, Vec2] | null = visible ? clipSegment(a, b, visible) : [a, b];
        if (!shown) continue;
        const [p, q] = shown;
        const spots = WALL_LABEL_SPOTS.map((t): Vec2 => [
            p[0] + (q[0] - p[0]) * t,
            p[1] + (q[1] - p[1]) * t,
        ]);
        for (const label of wallLabel(index, wall, zoom, units, i18n)) {
            const placed = place(label, spots);
            if (placed) items.push(placed);
        }
    }
    for (const { shape } of [...level.zones, ...level.obstacles]) {
        const box = boxOf(shape.outer);
        const fits =
            (box.maxX - box.minX) * zoom >= MIN_SHAPE_PX &&
            (box.maxY - box.minY) * zoom >= MIN_SHAPE_HEIGHT_PX;
        if (!fits || !inView(box)) continue;
        // Centred on the part of the shape in view, above its (visible) bottom edge, or else
        // below its top edge.
        const shown = visible ? intersect(box, visible) : box;
        const middle = (shown.minX + shown.maxX) / 2;
        const placed = place(shapeLabel(shape, zoom, units, i18n), [
            [middle, shown.minY + INSET_PX / zoom],
            [middle, shown.maxY - INSET_PX / zoom],
        ]);
        if (placed) items.push(placed);
    }
    return items;
}

/** `v` within [min, max]; the middle of the range when the range is empty. */
function clamp(v: number, min: number, max: number): number {
    return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, v));
}

function intersect(a: Box, b: Box): Box {
    return {
        minX: Math.max(a.minX, b.minX),
        minY: Math.max(a.minY, b.minY),
        maxX: Math.min(a.maxX, b.maxX),
        maxY: Math.min(a.maxY, b.maxY),
    };
}

/** The part of segment a–b inside `box` (Liang–Barsky), or null when it misses the box. */
function clipSegment(a: Vec2, b: Vec2, box: Box): [Vec2, Vec2] | null {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [
        [-dx, a[0] - box.minX],
        [dx, box.maxX - a[0]],
        [-dy, a[1] - box.minY],
        [dy, box.maxY - a[1]],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null;
        } else {
            const t = q / p;
            if (p < 0) t0 = Math.max(t0, t);
            else t1 = Math.min(t1, t);
        }
    }
    if (t0 > t1) return null;
    return [
        [a[0] + dx * t0, a[1] + dy * t0],
        [a[0] + dx * t1, a[1] + dy * t1],
    ];
}

interface WallIndex {
    positions: Map<Id, Vec2>;
    /** The Walls meeting at each Wall Node. */
    wallsAt: Map<Id, Wall[]>;
}

function wallIndex(level: Level): WallIndex {
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const wallsAt = new Map<Id, Wall[]>();
    for (const wall of level.walls) {
        for (const node of [wall.a, wall.b]) {
            const list = wallsAt.get(node);
            if (list) list.push(wall);
            else wallsAt.set(node, [wall]);
        }
    }
    return { positions, wallsAt };
}

function boxOf(points: Vec2[]): Box {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
    };
}

/**
 * Centre-line length, plus the clear length when other Walls meet its ends at an angle: half of
 * the thickest such wall is taken off at each end (Q35).
 */
function wallLabel(
    { positions, wallsAt }: WallIndex,
    wall: Wall,
    zoom: number,
    units: DisplayUnits,
    i18n: Translator,
): LabelItem[] {
    const a = positions.get(wall.a);
    const b = positions.get(wall.b);
    if (!a || !b) return [];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const direction: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];

    const allowance = (nodeId: Id) => {
        let half = 0;
        for (const other of wallsAt.get(nodeId) ?? []) {
            if (other.id === wall.id) continue;
            const p = positions.get(other.a);
            const q = positions.get(other.b);
            if (!p || !q) continue;
            const otherLength = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
            const cross =
                (direction[0] * (q[1] - p[1]) - direction[1] * (q[0] - p[0])) / otherLength;
            if (Math.abs(cross) > 1e-6) half = Math.max(half, other.thickness / 2);
        }
        return half;
    };
    const clear = length - allowance(wall.a) - allowance(wall.b);
    const text =
        Math.abs(clear - length) < 0.005
            ? formatLength(length, units, i18n)
            : i18n.t('dimension.clear', {
                  length: formatLength(length, units, i18n),
                  clear: formatLength(clear, units, i18n),
              });
    return [segmentLabel(a, b, text, zoom)];
}

/** "W × D m · A m²" for a rectangle at any angle, otherwise just the area; below the shape. */
function shapeLabel(shape: Shape, zoom: number, units: DisplayUnits, i18n: Translator): LabelItem {
    const { minX, maxX, minY } = boxOf(shape.outer);
    const area = shapeArea(shape);
    const sides = rectangleSides(shape.outer);
    const text = sides
        ? `${formatSize(sides[0], sides[1], units, i18n)} · ${formatArea(area, units, i18n)}`
        : formatArea(area, units, i18n);
    return { type: 'label', position: [(minX + maxX) / 2, minY - LABEL_GAP_PX / zoom], text };
}
