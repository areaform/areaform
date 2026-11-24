// What the 3D view draws for one Level, as plain vertex arrays (ADR-0007). Pure: no Three.js, no
// WebGL, so it is tested like render-2d's scene. The Three.js adapter only uploads the arrays.
import {
    resolveOpening,
    wallOutlines,
    type AreaformDocument,
    type Level,
    type Opening,
    type Ring,
    type Shape,
    type Vec2,
} from '@areaform/core';
import { mergeStyles, type Theme } from '@areaform/render-2d';
import earcut from 'earcut';
import type { Theme3D } from './theme3d.ts';

/** A colour's red, green and blue, 0–1, in the space the vertex colours are drawn in. */
export type Rgb = [number, number, number];

/** Turns a CSS colour into vertex colour components. */
export type ColorParser = (css: string) => Rgb;

/**
 * Triangles in world space: x east, y up, z south (plan `[x, y]` at height `h` is `[x, h, −y]`),
 * so a Level seen from above reads like its plan. Every triangle has its own three vertices.
 */
export interface MeshData {
    /** x, y, z per vertex. */
    positions: Float32Array;
    /** x, y, z per vertex: the triangle's face normal, for flat shading. */
    normals: Float32Array;
    /** r, g, b, a per vertex. */
    colors: Float32Array;
    /** World x, z per vertex of the Element it belongs to, where a builder was given anchors. */
    anchors?: Float32Array;
}

export interface LevelMeshes {
    /**
     * Everything but Zones and Walls. Zones are drawn apart (`buildZoneLayer`) so a new look
     * rebuilds only them.
     */
    opaque: MeshData;
    /**
     * Strips that lie on the floor, a hair above it: each Opening's threshold. Drawn apart, with a
     * depth bias, so the floor never shows through them however far the camera is.
     */
    marks: MeshData;
    /**
     * Walls, each vertex anchored at the middle of its Wall, so the view can lower a whole Wall
     * that stands between the camera and the plan.
     */
    walls: Required<MeshData>;
    /** The Walls' solid parts the `walls` mesh was built from, e.g. for picking. */
    wallPieces: WallPiece[];
    /** World-space bounds of everything drawn, Zones included; empty (min > max) for an empty Level. */
    bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface MeshOptions {
    theme: Theme;
    theme3d: Theme3D;
    /** Height of the top of a door or passage, metres; the Wall above it is drawn as a lintel. */
    doorHeight: number;
    color: ColorParser;
}

/** How far the floor slab reaches below the floor, metres. */
export const SLAB_DEPTH = 0.15;
/** Zones and door thresholds float this far above the floor, so they never fight with it. */
export const ZONE_LIFT = 0.01;
export const THRESHOLD_LIFT = 0.012;

/** Every triangle for one Level but its Zones, standing on y = 0. */
export function buildLevelMeshes(
    doc: AreaformDocument,
    level: Level,
    options: MeshOptions,
): LevelMeshes {
    const { theme, theme3d, color } = options;
    const opaque = new MeshBuilder();
    const marks = new MeshBuilder();
    const walls = new MeshBuilder();
    const rgba = (css: string | undefined, fallback: string, alpha = 1): Rgba => [
        ...color(css ?? fallback),
        alpha,
    ];

    // The floor: a slab under the Outline, open where the Outline has holes or a void goes down.
    const voids = level.obstacles.filter((o) => o.kind === 'void').map((o) => o.shape.outer);
    if (level.outline.outer.length >= 3) {
        const floor: Shape = {
            outer: level.outline.outer,
            holes: [...(level.outline.holes ?? []), ...voids],
        };
        const top = rgba(theme3d.floor, theme.outline.fill ?? '#f7f6f2');
        opaque.prism(floor, -SLAB_DEPTH, 0, rgba(theme3d.slab, '#cfcfca'), top);
    }

    // Zones are drawn by buildZoneLayer; they count towards the bounds, so framing never depends
    // on their look.
    for (const zone of level.zones) opaque.include(zone.shape, ZONE_LIFT);

    for (const obstacle of level.obstacles) {
        if (obstacle.kind === 'void') continue;
        const fill = rgba(theme.obstacle.fill, '#8f8f8a');
        opaque.prism(obstacle.shape, 0, level.height, fill, fill);
    }

    for (const connection of doc.connections) {
        const look = theme3d.connections[connection.kind];
        const fill = rgba(look.color, '#e6dcf3');
        for (const stop of connection.stops) {
            if (stop.levelId !== level.id) continue;
            opaque.prism(stop.shape, 0, look.height ?? level.height, fill, fill);
        }
    }

    const side = rgba(theme3d.wall, '#d9d8d2');
    const top = rgba(theme3d.wallTop, theme.wall.fill ?? '#3b3b38');
    const pieces = wallPieces(level, options.doorHeight);
    for (const piece of pieces) {
        walls.anchor = piece.anchor;
        // A lintel's underside shows; a piece standing on the floor has none.
        const under = piece.bottom > 0 ? side : undefined;
        walls.prism({ outer: piece.shape }, piece.bottom, piece.top, side, top, under);
    }

    // A strip across the floor of every Opening: thresholds in Walls, and free Openings that have
    // no Wall to cut.
    const thickness = new Map(level.walls.map((w) => [w.id, w.thickness]));
    for (const opening of level.openings) {
        const placement = resolveOpening(level, opening);
        if (!placement) continue;
        const style = mergeStyles(
            theme.opening,
            opening.kind === 'emergency-exit' ? theme.emergencyExit : undefined,
        );
        const depth =
            opening.host === 'wall'
                ? (thickness.get(opening.wallId) ?? theme.freeOpeningDepth)
                : theme.freeOpeningDepth;
        const strip = rectangle(placement.position, placement.angle, opening.width, depth);
        const lift = THRESHOLD_LIFT;
        marks.cap({ outer: strip }, lift, rgba(style.stroke, '#3b3b38'), 'up');
    }

    const bounds = opaque.bounds();
    const wallBounds = walls.bounds();
    const markBounds = marks.bounds();
    for (let i = 0; i < 3; i++) {
        bounds.min[i] = Math.min(bounds.min[i]!, wallBounds.min[i]!, markBounds.min[i]!);
        bounds.max[i] = Math.max(bounds.max[i]!, wallBounds.max[i]!, markBounds.max[i]!);
    }
    const built = walls.build();
    return {
        opaque: opaque.build(),
        marks: marks.build(),
        walls: { ...built, anchors: built.anchors ?? new Float32Array() },
        wallPieces: pieces,
        bounds,
    };
}

/** A solid part of a Wall between its Openings, or a lintel above a door. */
export interface WallPiece {
    wallId: string;
    /** The middle of the whole Wall, plan metres: every piece of a Wall goes down together. */
    anchor: Vec2;
    shape: Ring;
    bottom: number;
    top: number;
}

/** Every solid part of the Level's Walls, as drawn: doors leave a lintel, entrances nothing. */
export function wallPieces(level: Level, doorHeight: number): WallPiece[] {
    const outlines = wallOutlines(level);
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const openingsOn = new Map<string, Opening[]>();
    for (const opening of level.openings) {
        if (opening.host !== 'wall') continue;
        const list = openingsOn.get(opening.wallId);
        if (list) list.push(opening);
        else openingsOn.set(opening.wallId, [opening]);
    }
    const pieces: WallPiece[] = [];
    for (const wall of level.walls) {
        const outline = outlines.get(wall.id);
        const a = positions.get(wall.a);
        const b = positions.get(wall.b);
        if (!outline || !a || !b) continue;
        const height = wall.height ?? level.height;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const along: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        const lintel = Math.min(doorHeight, height);
        const anchor: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        for (const run of wallRuns(openingsOn.get(wall.id) ?? [])) {
            const shape = clipBetween(outline.outer, a, along, run.from, run.to);
            if (shape.length < 3) continue;
            const bottom = run.gap === 'none' ? 0 : run.gap === 'door' ? lintel : height;
            if (bottom < height)
                pieces.push({ wallId: wall.id, anchor, shape, bottom, top: height });
        }
    }
    return pieces;
}

/** A stretch along a Wall, metres from its `a` node, and what kind of gap is cut there. */
export interface WallRun {
    from: number;
    to: number;
    /** `none`: solid Wall. `door`: open below the door height. `full`: open all the way up. */
    gap: 'none' | 'door' | 'full';
}

const GAP_RANK = { none: 0, door: 1, full: 2 } as const;

/**
 * A Wall split at the edges of its Openings, from −∞ to +∞. Doors and passages leave a lintel,
 * entrances and emergency exits are open to the top; where Openings overlap the more open one wins.
 */
export function wallRuns(openings: Opening[]): WallRun[] {
    const spans = openings.flatMap((o) =>
        o.host === 'wall'
            ? [
                  {
                      from: o.offset - o.width / 2,
                      to: o.offset + o.width / 2,
                      gap: o.kind === 'door' || o.kind === 'passage' ? 'door' : 'full',
                  } as const,
              ]
            : [],
    );
    const cuts = [...new Set(spans.flatMap((s) => [s.from, s.to]))].sort((x, y) => x - y);
    const edges = [-Infinity, ...cuts, Infinity];
    const runs: WallRun[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
        const from = edges[i]!;
        const to = edges[i + 1]!;
        const middle = Number.isFinite(from) && Number.isFinite(to) ? (from + to) / 2 : from;
        let gap: WallRun['gap'] = 'none';
        for (const span of spans) {
            const inside = Number.isFinite(middle) ? span.from < middle && middle < span.to : false;
            if (inside && GAP_RANK[span.gap] > GAP_RANK[gap]) gap = span.gap;
        }
        const last = runs.at(-1);
        if (last?.gap === gap) last.to = to;
        else runs.push({ from, to, gap });
    }
    return runs;
}

/** The part of a ring between two distances along a line through `origin` in direction `along`. */
function clipBetween(ring: Ring, origin: Vec2, along: Vec2, from: number, to: number): Ring {
    let piece = ring;
    if (Number.isFinite(from)) piece = clipHalf(piece, origin, along, from, 1);
    if (Number.isFinite(to)) piece = clipHalf(piece, origin, along, to, -1);
    return piece;
}

/** Sutherland–Hodgman against one line: keeps the side where `keep · (distance − at) ≥ 0`. */
function clipHalf(ring: Ring, origin: Vec2, along: Vec2, at: number, keep: 1 | -1): Ring {
    const side = (p: Vec2) =>
        keep * ((p[0] - origin[0]) * along[0] + (p[1] - origin[1]) * along[1] - at);
    const out: Ring = [];
    for (let i = 0; i < ring.length; i++) {
        const current = ring[i]!;
        const previous = ring[(i + ring.length - 1) % ring.length]!;
        const sc = side(current);
        const sp = side(previous);
        if (sc >= 0 !== sp >= 0) {
            const t = sp / (sp - sc);
            out.push([
                previous[0] + (current[0] - previous[0]) * t,
                previous[1] + (current[1] - previous[1]) * t,
            ]);
        }
        if (sc >= 0) out.push(current);
    }
    return Math.abs(area(out)) < 1e-9 ? [] : out;
}

/** A width × depth rectangle centred on `position`, its width along `angle`. */
function rectangle([x, y]: Vec2, angle: number, width: number, depth: number): Ring {
    const [ux, uy] = [Math.cos(angle) * (width / 2), Math.sin(angle) * (width / 2)];
    const [vx, vy] = [-Math.sin(angle) * (depth / 2), Math.cos(angle) * (depth / 2)];
    return [
        [x - ux - vx, y - uy - vy],
        [x + ux - vx, y + uy - vy],
        [x + ux + vx, y + uy + vy],
        [x - ux + vx, y - uy + vy],
    ];
}

/** Twice the signed area: positive for a counter-clockwise ring. */
function area(ring: Ring): number {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        sum += x1 * y2 - x2 * y1;
    }
    return sum;
}

const oriented = (ring: Ring, ccw: boolean): Ring =>
    area(ring) > 0 === ccw ? ring : [...ring].reverse();

export type Rgba = [number, number, number, number];
type Normal = [number, number, number];

const UP: Normal = [0, 1, 0];
const DOWN: Normal = [0, -1, 0];

/** A Float32Array that grows as values are added. */
class Floats {
    data = new Float32Array(3 * 1024);
    length = 0;

    reserve(count: number) {
        if (this.length + count <= this.data.length) return;
        const grown = new Float32Array(Math.max(this.data.length * 2, this.length + count));
        grown.set(this.data.subarray(0, this.length));
        this.data = grown;
    }

    toArray() {
        return this.data.slice(0, this.length);
    }
}

export class MeshBuilder {
    /** The plan point triangles added from now on are anchored at; none by default. */
    anchor: Vec2 | null = null;
    private positions = new Floats();
    private normals = new Floats();
    private colors = new Floats();
    private anchors = new Floats();
    private min: [number, number, number] = [Infinity, Infinity, Infinity];
    private max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

    /** A shape stood up from `bottom` to `top`: its sides, a top cap and optionally a bottom one. */
    prism(shape: Shape, bottom: number, top: number, side: Rgba, topColor: Rgba, under?: Rgba) {
        if (top <= bottom) return;
        // Outer ring counter-clockwise, holes clockwise: the solid is then always on the left.
        const rings = [
            oriented(shape.outer, true),
            ...(shape.holes ?? []).map((h) => oriented(h, false)),
        ];
        const normal: Normal = [0, 0, 0];
        for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
                const p = ring[i]!;
                const q = ring[(i + 1) % ring.length]!;
                const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
                if (length === 0) continue;
                // Outward is to the right of p → q; plan [nx, ny] is world [nx, 0, −ny].
                normal[0] = (q[1] - p[1]) / length;
                normal[2] = (q[0] - p[0]) / length;
                this.triangle(p, bottom, q, bottom, q, top, normal, side);
                this.triangle(p, bottom, q, top, p, top, normal, side);
            }
        }
        this.cap(shape, top, topColor, 'up');
        if (under) this.cap(shape, bottom, under, 'down');
    }

    /** A flat shape at height `y`, facing up or down. */
    cap(shape: Shape, y: number, color: Rgba, facing: 'up' | 'down') {
        if (shape.outer.length < 3) return;
        const up = facing === 'up';
        const normal = up ? UP : DOWN;
        if (!shape.holes?.length && convex(shape.outer)) {
            // A fan, wound counter-clockwise in the plan to face up.
            const ring = oriented(shape.outer, up);
            const first = ring[0]!;
            for (let i = 1; i < ring.length - 1; i++)
                this.triangle(first, y, ring[i]!, y, ring[i + 1]!, y, normal, color);
            return;
        }
        const points = [shape.outer, ...(shape.holes ?? [])].flat();
        const holes: number[] = [];
        let count = shape.outer.length;
        for (const hole of shape.holes ?? []) {
            holes.push(count);
            count += hole.length;
        }
        const indices = earcut(points.flat(), holes, 2);
        for (let i = 0; i < indices.length; i += 3) {
            const a = points[indices[i]!]!;
            let b = points[indices[i + 1]!]!;
            let c = points[indices[i + 2]!]!;
            // Counter-clockwise in the plan faces up in the world.
            const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
            if (ccw !== up) [b, c] = [c, b];
            this.triangle(a, y, b, y, c, y, normal, color);
        }
    }

    /** One triangle from three plan points, each at its own height. */
    private triangle(
        a: Vec2,
        ha: number,
        b: Vec2,
        hb: number,
        c: Vec2,
        hc: number,
        normal: Normal,
        color: Rgba,
    ) {
        const { positions, normals, colors } = this;
        positions.reserve(9);
        normals.reserve(9);
        colors.reserve(12);
        const p = positions.data;
        let i = positions.length;
        p[i++] = a[0];
        p[i++] = ha;
        p[i++] = -a[1];
        p[i++] = b[0];
        p[i++] = hb;
        p[i++] = -b[1];
        p[i++] = c[0];
        p[i++] = hc;
        p[i++] = -c[1];
        positions.length = i;
        const n = normals.data;
        let j = normals.length;
        for (let k = 0; k < 3; k++) {
            n[j++] = normal[0];
            n[j++] = normal[1];
            n[j++] = normal[2];
        }
        normals.length = j;
        const col = colors.data;
        let m = colors.length;
        for (let k = 0; k < 3; k++) {
            col[m++] = color[0];
            col[m++] = color[1];
            col[m++] = color[2];
            col[m++] = color[3];
        }
        colors.length = m;
        if (this.anchor) {
            const { anchors } = this;
            anchors.reserve(6);
            let k = anchors.length;
            for (let v = 0; v < 3; v++) {
                anchors.data[k++] = this.anchor[0];
                anchors.data[k++] = -this.anchor[1];
            }
            anchors.length = k;
        }
        this.extend(a, ha);
        this.extend(b, hb);
        this.extend(c, hc);
    }

    /** Counts a shape at height `y` towards the bounds without drawing it. */
    include(shape: Shape, y: number) {
        for (const point of shape.outer) this.extend(point, y);
    }

    private extend([x, y]: Vec2, h: number) {
        const { min, max } = this;
        if (x < min[0]) min[0] = x;
        if (x > max[0]) max[0] = x;
        if (h < min[1]) min[1] = h;
        if (h > max[1]) max[1] = h;
        if (-y < min[2]) min[2] = -y;
        if (-y > max[2]) max[2] = -y;
    }

    bounds(): { min: [number, number, number]; max: [number, number, number] } {
        return { min: [...this.min] as typeof this.min, max: [...this.max] as typeof this.max };
    }

    build(): MeshData {
        return {
            positions: this.positions.toArray(),
            normals: this.normals.toArray(),
            colors: this.colors.toArray(),
            ...(this.anchors.length > 0 && { anchors: this.anchors.toArray() }),
        };
    }
}

/** Whether a ring turns the same way at every corner (straight runs allowed). */
function convex(ring: Ring): boolean {
    let sign = 0;
    for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[(i + 1) % ring.length]!;
        const [cx, cy] = ring[(i + 2) % ring.length]!;
        const turn = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if (Math.abs(turn) < 1e-12) continue;
        if (sign === 0) sign = Math.sign(turn);
        else if (Math.sign(turn) !== sign) return false;
    }
    return sign !== 0;
}
