// The Wayfinding Plugin's decisions, without the DOM: where Here is, what a Zone's point is, what
// the route panel says (ADR-0017).
import {
    containsPoint,
    textIn,
    type AreaformDocument,
    type Id,
    type Ring,
    type Vec2,
    type Zone,
} from '@areaform/core';
import type { Camera } from '@areaform/render-2d';
import type { Translator } from '../i18n/translator.ts';

/** A point on one Level: Here, or where a route goes. */
export interface PlanPoint {
    levelId: Id;
    point: Vec2;
}

/** Walking speed for the time shown, metres per second. */
export const WALKING_SPEED = 1.2;

/**
 * The point a route uses for a Zone: its label anchor, else the middle of its shape when that is
 * inside it, else its first corner. A route to a Walk-around Zone ends at its nearest edge instead.
 */
export function zonePoint(zone: Zone): Vec2 {
    if (zone.labelAnchor) return zone.labelAnchor;
    const middle = areaCentroid(zone.shape.outer);
    return containsPoint(zone.shape, middle) ? middle : zone.shape.outer[0]!;
}

/** The centre of a ring's area; the average of its corners when it has none. */
function areaCentroid(ring: Ring): Vec2 {
    let area = 0;
    let x = 0;
    let y = 0;
    ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        const f = p[0] * q[1] - q[0] * p[1];
        area += f;
        x += (p[0] + q[0]) * f;
        y += (p[1] + q[1]) * f;
    });
    if (area === 0) {
        const n = ring.length;
        return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
    }
    return [x / (3 * area), y / (3 * area)];
}

/**
 * The place a `?to=` value or the `to` option names: a Zone's id. Null when no Zone has it; a
 * point is no place to show a card for.
 */
export function parseTo(
    text: string | undefined,
    doc: AreaformDocument,
): { levelId: Id; zone: Zone } | null {
    const value = text?.trim();
    if (!value) return null;
    for (const level of doc.levels) {
        const zone = level.zones.find((z) => z.id === value);
        if (zone) return { levelId: level.id, zone };
    }
    return null;
}

/**
 * Here from a `?here=` value or the `here` option: a Zone's id (that Zone, on its Level), or
 * `<levelId>:<x>,<y>` in metres. Null when it names nothing in the Space.
 */
export function parseHere(text: string | undefined, doc: AreaformDocument): PlanPoint | null {
    const value = text?.trim();
    if (!value) return null;
    for (const level of doc.levels) {
        const zone = level.zones.find((z) => z.id === value);
        if (zone) return { levelId: level.id, point: zonePoint(zone) };
    }
    const match = /^(.+):(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
    if (!match) return null;
    const [, levelId, x, y] = match;
    if (!doc.levels.some((l) => l.id === levelId)) return null;
    return { levelId: levelId!, point: [Number(x), Number(y)] };
}

/**
 * What the route panel says about a route: `120 m · 2 min`, in the interface language. `seconds`
 * includes the rides of a route between Levels; by default the walk's own time.
 */
export function walkSummary(
    length: number,
    i18n: Translator,
    seconds = length / WALKING_SPEED,
): string {
    const metres = Math.max(1, Math.round(length));
    const minutes = Math.max(1, Math.round(seconds / 60));
    return i18n.t('wayfinding.walk', {
        distance: `${i18n.fixed(metres, 0)} ${i18n.t('unit.m')}`,
        minutes: i18n.fixed(minutes, 0),
    });
}

/** A Level's name in the language shown. */
export function levelName(doc: AreaformDocument, levelId: Id, language?: string): string {
    const level = doc.levels.find((l) => l.id === levelId);
    if (!level) return '';
    return textIn(level.name, level.names, doc.languages, language) ?? level.name;
}

/** One Connection taken on a route: which, up or down, and the Level it goes to. */
export interface RideStep {
    connectionId: Id;
    kind: 'stairs' | 'elevator' | 'escalator' | 'ramp';
    toLevelId: Id;
    up: boolean;
}

/**
 * A step of a route between Levels, e.g. "Take the stairs up to Gallery", or with the Connection's
 * name, "Take Main stairs up to Gallery".
 */
export function rideText(
    doc: AreaformDocument,
    ride: RideStep,
    i18n: Translator,
    language?: string,
): string {
    const connection = doc.connections.find((c) => c.id === ride.connectionId);
    const name = connection && textIn(connection.name, connection.names, doc.languages, language);
    const level = levelName(doc, ride.toLevelId, language);
    const way = ride.up ? 'Up' : 'Down';
    return name
        ? i18n.t(`wayfinding.rideNamed${way}`, { name, level })
        : i18n.t(`wayfinding.ride.${ride.kind}.${ride.up ? 'up' : 'down'}`, { level });
}

/** A part of the View, screen pixels from its top-left corner. */
export interface ScreenArea {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * A 2D camera that shows every one of `points` (plan metres) inside `area`, e.g. above the route
 * panel; null when they are all there already. It pans to centre them there, and zooms out only
 * when they do not fit, never in, so the visitor's zoom stays when it can.
 */
export function framed(camera: Camera, points: Vec2[], area: ScreenArea): Camera | null {
    if (points.length === 0) return null;
    const { viewport, center, zoom } = camera;
    const screen = ([x, y]: Vec2): Vec2 => [
        viewport.width / 2 + (x - center[0]) * zoom,
        viewport.height / 2 - (y - center[1]) * zoom,
    ];
    const shown = points.every((p) => {
        const [sx, sy] = screen(p);
        return sx >= area.left && sx <= area.right && sy >= area.top && sy <= area.bottom;
    });
    if (shown) return null;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
    ];
    const [width, height] = [area.right - area.left, area.bottom - area.top];
    const fits = Math.min(
        width / Math.max(maxX - minX, 1e-6),
        height / Math.max(maxY - minY, 1e-6),
    );
    const next = Math.max(camera.minZoom, Math.min(zoom, fits));
    // The middle of the points at the middle of the area.
    const [ax, ay] = [(area.left + area.right) / 2, (area.top + area.bottom) / 2];
    const [bx, by] = [(minX + maxX) / 2, (minY + maxY) / 2];
    return {
        ...camera,
        zoom: next,
        center: [bx - (ax - viewport.width / 2) / next, by + (ay - viewport.height / 2) / next],
    };
}
