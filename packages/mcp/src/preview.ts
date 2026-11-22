import {
    resolveOpening,
    underlayCorners,
    viewpointSpot,
    wallOutlines,
    type Level,
    type Ring,
    type Shape,
    type Underlay,
    type Vec2,
} from '@areaform/core';

// Colours after render-2d's default Theme, which can't be imported here: it brings in PixiJS.
const COLOURS = {
    background: '#ffffff',
    outline: { fill: '#f7f6f2', stroke: '#9a9a96' },
    zone: { fill: '#dbe7f5', stroke: '#7d99bd' },
    restricted: { fill: '#f6dcdc', stroke: '#c46a6a' },
    obstacle: { fill: '#8f8f8a', stroke: '#6b6b67' },
    wall: '#3b3b38',
    opening: '#f7f6f2',
    emergencyExit: '#1f8a4c',
    grid: '#8a8a84',
    label: '#2b2b29',
    id: '#7a4fb3',
    stop: { fill: '#ffd27a', stroke: '#b07a00' },
    viewpoint: '#1f6fc9',
};

/** A Viewpoint's wedge on the preview: how long, in pixels, and half its opening, in degrees. */
const WEDGE_PX = 22;
const WEDGE_HALF_ANGLE = 25;

/** Where a Connection (stairs, a lift, a ramp) stops on the Level drawn. */
export interface PreviewStop {
    /** The Connection's name, or its kind when it has none. */
    name: string;
    shape: Shape;
}

export interface PreviewOptions {
    /** Width of the picture in pixels; the height follows the plan. */
    width: number;
    /** An image to draw under the plan, with the Underlay that places it. */
    source?: { underlay: Underlay; href: string };
    /** Write each Zone's and Obstacle's id, so the agent can refer to them. */
    ids: boolean;
    /** The Stops of Connections on this Level, drawn over the Zones with their name. */
    stops?: PreviewStop[];
}

export interface Preview {
    svg: string;
    /** Plan point at the picture's top-left corner, and pixels per metre. */
    origin: Vec2;
    pixelsPerMetre: number;
    /** One grid square, in metres. */
    gridStep: number;
}

const PADDING = 24;
/** Grid lines closer than this many pixels are skipped for a coarser step. */
const MIN_GRID_PX = 20;
const GRID_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** Draws a Level as SVG for an agent to compare with its Source: plain, labelled, Y up. */
export function renderPreview(
    level: Level,
    { width, source, ids, stops = [] }: PreviewOptions,
): Preview {
    const outlines = wallOutlines(level);
    const rings: Ring[] = [
        level.outline.outer,
        ...level.zones.map((z) => z.shape.outer),
        ...level.obstacles.map((o) => o.shape.outer),
        // A Stop can stand outside the Outline (a ramp down from a courtyard).
        ...stops.map((s) => s.shape.outer),
        ...[...outlines.values()].map((s) => s.outer),
        ...(source ? [underlayCorners(source.underlay)] : []),
    ].filter((ring): ring is Ring => ring !== undefined && ring.length > 0);
    const xs = rings.flatMap((ring) => ring.map((p) => p[0]));
    const ys = rings.flatMap((ring) => ring.map((p) => p[1]));
    const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
    ];
    const ppm = (width - 2 * PADDING) / Math.max(maxX - minX, 1e-6);
    const height = Math.ceil((maxY - minY) * ppm + 2 * PADDING);
    const px = ([x, y]: Vec2): Vec2 => [(x - minX) * ppm + PADDING, (maxY - y) * ppm + PADDING];
    const fmt = (n: number) => String(Math.round(n * 10) / 10);
    const points = (ring: Ring) => ring.map((p) => px(p).map(fmt).join(' ')).join(' L ');
    const path = (shape: Shape) =>
        [shape.outer, ...(shape.holes ?? [])].map((ring) => `M ${points(ring)} Z`).join(' ');

    const parts: string[] = [`<rect width="100%" height="100%" fill="${COLOURS.background}"/>`];

    parts.push(
        `<path d="${path(level.outline)}" fill="${COLOURS.outline.fill}" stroke="${COLOURS.outline.stroke}" fill-rule="evenodd"/>`,
    );

    if (source) {
        const { underlay, href } = source;
        const [w, h] = underlay.size ?? [0, 0];
        const [x, y] = px(underlay.position);
        const degrees = (-underlay.rotation * 180) / Math.PI;
        parts.push(
            `<image href="${href}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w * underlay.scale * ppm)}" ` +
                `height="${fmt(h * underlay.scale * ppm)}" opacity="${underlay.opacity}" ` +
                `transform="rotate(${fmt(degrees)} ${fmt(x)} ${fmt(y)})" preserveAspectRatio="none"/>`,
        );
    }

    const gridStep = GRID_STEPS.find((step) => step * ppm >= MIN_GRID_PX) ?? 1000;
    const grid: string[] = [];
    for (let x = Math.ceil(minX / gridStep) * gridStep; x <= maxX; x += gridStep) {
        const [sx] = px([x, 0]);
        grid.push(`M ${fmt(sx)} ${PADDING} V ${fmt(height - PADDING)}`);
    }
    for (let y = Math.ceil(minY / gridStep) * gridStep; y <= maxY; y += gridStep) {
        const [, sy] = px([0, y]);
        grid.push(`M ${PADDING} ${fmt(sy)} H ${fmt(width - PADDING)}`);
    }
    parts.push(
        `<path d="${grid.join(' ')}" stroke="${COLOURS.grid}" stroke-opacity="0.25" stroke-width="1"/>`,
    );

    for (const zone of level.zones) {
        const colours = zone.restricted ? COLOURS.restricted : COLOURS.zone;
        const fill = zone.style?.fill ?? colours.fill;
        const stroke = zone.style?.stroke ?? colours.stroke;
        parts.push(
            `<path d="${path(zone.shape)}" fill="${fill}" fill-opacity="0.75" stroke="${stroke}" fill-rule="evenodd"/>`,
        );
    }
    for (const obstacle of level.obstacles) {
        parts.push(
            `<path d="${path(obstacle.shape)}" fill="${COLOURS.obstacle.fill}" stroke="${COLOURS.obstacle.stroke}" fill-rule="evenodd"/>`,
        );
    }
    for (const stop of stops) {
        parts.push(
            `<path d="${path(stop.shape)}" fill="${COLOURS.stop.fill}" fill-opacity="0.8" stroke="${COLOURS.stop.stroke}" stroke-dasharray="4 2" fill-rule="evenodd"/>`,
        );
    }
    for (const shape of outlines.values()) {
        parts.push(`<path d="${path(shape)}" fill="${COLOURS.wall}"/>`);
    }

    for (const opening of level.openings) {
        const placement = resolveOpening(level, opening);
        if (!placement) continue;
        // `position` is the Opening's centre.
        const { position, angle } = placement;
        const half: Vec2 = [
            (Math.cos(angle) * opening.width) / 2,
            (Math.sin(angle) * opening.width) / 2,
        ];
        const start: Vec2 = [position[0] - half[0], position[1] - half[1]];
        const end: Vec2 = [position[0] + half[0], position[1] + half[1]];
        const wall =
            opening.host === 'wall' ? level.walls.find((w) => w.id === opening.wallId) : undefined;
        const depth = Math.max((wall?.thickness ?? 0.3) * ppm + 2, 3);
        const [a, b] = [px(start), px(end)];
        const colour = opening.kind === 'emergency-exit' ? COLOURS.emergencyExit : COLOURS.wall;
        parts.push(
            `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="${COLOURS.opening}" stroke-width="${fmt(depth)}"/>`,
            `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="${colour}" stroke-width="1.5" stroke-dasharray="4 2"/>`,
        );
    }

    const fontSize = Math.max(9, Math.min(14, 0.6 * ppm));
    const text = (at: Vec2, lines: { text: string; colour: string }[]) => {
        const [x, y] = px(at);
        const top = y - ((lines.length - 1) * fontSize * 1.1) / 2;
        return lines
            .map(
                (line, i) =>
                    `<text x="${fmt(x)}" y="${fmt(top + i * fontSize * 1.1)}" font-size="${fmt(fontSize)}" ` +
                    `font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" ` +
                    `fill="${line.colour}">${escape(line.text)}</text>`,
            )
            .join('');
    };
    for (const zone of level.zones) {
        const lines = [
            ...(zone.label ? [{ text: zone.label, colour: COLOURS.label }] : []),
            ...(ids ? [{ text: zone.id, colour: COLOURS.id }] : []),
        ];
        if (lines.length > 0) parts.push(text(zone.labelAnchor ?? centre(zone.shape.outer), lines));
    }
    for (const stop of stops) {
        parts.push(text(centre(stop.shape.outer), [{ text: stop.name, colour: COLOURS.label }]));
    }
    if (ids) {
        for (const obstacle of level.obstacles) {
            parts.push(
                text(centre(obstacle.shape.outer), [{ text: obstacle.id, colour: COLOURS.id }]),
            );
        }
    }

    // Viewpoints (ADR-0025): the target crossed, and the camera, numbered in tour order, with a wedge
    // towards what it looks at. A camera standing beyond the drawing is pulled in along its line
    // of sight to the edge, so a far one does not shrink the plan.
    const inside = (p: Vec2): Vec2 => pullInside(p, { minX, maxX, minY, maxY });
    for (const [i, viewpoint] of (level.viewpoints ?? []).entries()) {
        const target = px(viewpoint.target);
        const spot = px(alongInto(viewpoint.target, viewpointSpot(viewpoint), inside));
        const away = [target[0] - spot[0], target[1] - spot[1]];
        const length = Math.hypot(away[0]!, away[1]!);
        // Straight down, the camera is over its target: the wedge points along the bearing.
        const angle =
            length > 1
                ? Math.atan2(away[1]!, away[0]!)
                : ((viewpoint.bearing - 90) * Math.PI) / 180;
        const side = (turn: number): Vec2 => {
            const a = angle + (turn * Math.PI) / 180;
            return [spot[0] + WEDGE_PX * Math.cos(a), spot[1] + WEDGE_PX * Math.sin(a)];
        };
        const c = COLOURS.viewpoint;
        const f = (p: Vec2) => `${fmt(p[0])} ${fmt(p[1])}`;
        parts.push(
            `<line x1="${fmt(spot[0])}" y1="${fmt(spot[1])}" x2="${fmt(target[0])}" y2="${fmt(target[1])}" stroke="${c}" stroke-width="1.5" stroke-dasharray="5 3"/>`,
            `<path d="M ${fmt(target[0] - 5)} ${fmt(target[1] - 5)} L ${fmt(target[0] + 5)} ${fmt(target[1] + 5)} M ${fmt(target[0] - 5)} ${fmt(target[1] + 5)} L ${fmt(target[0] + 5)} ${fmt(target[1] - 5)}" stroke="${c}" stroke-width="2"/>`,
            `<path d="M ${f(spot)} L ${f(side(WEDGE_HALF_ANGLE))} L ${f(side(-WEDGE_HALF_ANGLE))} Z" fill="${c}" fill-opacity="0.35" stroke="${c}"/>`,
            `<circle cx="${fmt(spot[0])}" cy="${fmt(spot[1])}" r="9" fill="${c}"/>`,
            `<text x="${fmt(spot[0])}" y="${fmt(spot[1])}" font-size="11" font-family="sans-serif" font-weight="bold" ` +
                `text-anchor="middle" dominant-baseline="central" fill="#ffffff">${i + 1}</text>`,
        );
    }

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
    return {
        svg,
        origin: [minX - PADDING / ppm, maxY + PADDING / ppm],
        pixelsPerMetre: ppm,
        gridStep,
    };
}

/** `point` moved into the box, if it is outside: the nearest point of the box. */
function pullInside(
    [x, y]: Vec2,
    box: { minX: number; maxX: number; minY: number; maxY: number },
): Vec2 {
    return [Math.min(Math.max(x, box.minX), box.maxX), Math.min(Math.max(y, box.minY), box.maxY)];
}

/**
 * The point on the line from `from` to `to` nearest `to` that `inside` keeps where it is: `to`
 * itself when it is inside, else where the line leaves the box.
 */
function alongInto(from: Vec2, to: Vec2, inside: (p: Vec2) => Vec2): Vec2 {
    const same = (p: Vec2) => {
        const q = inside(p);
        return q[0] === p[0] && q[1] === p[1];
    };
    if (same(to)) return to;
    if (!same(from)) return inside(to);
    let [lo, hi] = [0, 1];
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (same([from[0] + (to[0] - from[0]) * mid, from[1] + (to[1] - from[1]) * mid])) lo = mid;
        else hi = mid;
    }
    return [from[0] + (to[0] - from[0]) * lo, from[1] + (to[1] - from[1]) * lo];
}

/** The centre of a ring's bounding box; good enough for a label on a preview. */
function centre(ring: Ring): Vec2 {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function escape(value: string): string {
    return value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
