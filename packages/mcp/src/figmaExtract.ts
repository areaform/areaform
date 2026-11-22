import type { Command, Id, Obstacle, OpeningKind, Preset, Ring, Vec2 } from '@areaform/core';
import type { FigmaNode } from './figma.ts';
import { sourceToPlan, type Calibration } from './source.ts';

// Reads a Figma frame by the layer-naming convention in docs/guides/mcp.md. Names are matched at their
// start, ignoring case: "Wall", "Door", "Emergency exit", "Column", "Booth A1", "Dimension 60 m".
// Anything else is walked into (groups, frames) or reported as skipped for the agent to handle.

/** A 2D affine transform, Figma's `relativeTransform`: the top two rows. */
type Matrix = [[number, number, number], [number, number, number]];

const IDENTITY: Matrix = [
    [1, 0, 0],
    [0, 1, 0],
];

/** What a layer is by its name. */
export type Role =
    | { role: 'outline' }
    | { role: 'wall' }
    | { role: 'opening'; kind: OpeningKind }
    | { role: 'obstacle'; kind: Obstacle['kind'] }
    | { role: 'dimension'; metres: number }
    | {
          role: 'zone';
          category?: string;
          restricted?: boolean;
          walkAround?: boolean;
          label?: string;
      };

/** A recognised layer in Source units (the frame's own pixels, Y down). */
export interface Found {
    node: FigmaNode;
    role: Role;
    /** The shape's outline: a polygon from its path, or its transformed rectangle. */
    ring: Vec2[];
    /** The transformed rectangle's corners in order, for Walls, Openings and dimensions. */
    box: Vec2[];
    /** For a LINE, the stroke weight stands in for the missing height. */
    lineWeight?: number;
}

export interface Skipped {
    nodeId: string;
    name: string;
    type: string;
    reason: string;
}

/** A frame read in Source units, before calibration. */
export interface Scan {
    size: Vec2;
    found: Found[];
    texts: { node: FigmaNode; centre: Vec2; text: string }[];
    skipped: Skipped[];
    notes: string[];
    /** The first "Dimension <n> m" layer: its long axis is `metres` long. */
    dimension?: { p1: Vec2; p2: Vec2; metres: number };
}

export interface Extraction {
    /** Ready for `apply_commands`; the agent may change them first. */
    commands: Command[];
    /** Element id → Figma node id, for every Element the Commands add. */
    sourceRefs: Record<Id, string>;
    counts: { outline: number; walls: number; openings: number; zones: number; obstacles: number };
    skipped: Skipped[];
    notes: string[];
    /** Text layers that labelled no Zone, e.g. titles and annotations. */
    unusedTexts: string[];
}

const CONTAINERS = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);
/** Nodes that have no space of their own: their children are placed in the parent's. */
const GROUPS = new Set(['GROUP', 'BOOLEAN_OPERATION']);

export function scanFrame(frame: FigmaNode, preset: Preset): Scan {
    const size: Vec2 = [frame.size?.x ?? 0, frame.size?.y ?? 0];
    const scan: Scan = { size, found: [], texts: [], skipped: [], notes: [] };
    if (!frame.size) scan.notes.push('The frame has no size: was it fetched with geometry=paths?');

    const visit = (node: FigmaNode, parent: Matrix, inMatch: boolean) => {
        if (node.visible === false) return;
        const matrix = multiply(parent, node.relativeTransform ?? IDENTITY);
        if (node.type === 'TEXT') {
            const box = boxOf(node, matrix);
            if (box)
                scan.texts.push({
                    node,
                    centre: centroid(box),
                    text: node.characters ?? node.name,
                });
            return;
        }
        const role = inMatch ? undefined : roleOf(node.name, preset);
        if (role) {
            const box = boxOf(node, matrix);
            if (!box) {
                scan.skipped.push(skip(node, 'no size; fetch with geometry=paths'));
                return;
            }
            const { ring, curved } = ringOf(node, matrix, box);
            if (curved) scan.notes.push(`"${node.name}" is curved; its bounding box is used`);
            const lineWeight = node.type === 'LINE' ? (node.strokeWeight ?? 1) : undefined;
            scan.found.push({
                node,
                role,
                ring,
                box,
                ...(lineWeight !== undefined && { lineWeight }),
            });
            if (role.role === 'dimension' && !scan.dimension) {
                const [p1, p2] = axis(box, lineWeight).ends;
                scan.dimension = { p1, p2, metres: role.metres };
            }
        } else if (!inMatch && !CONTAINERS.has(node.type)) {
            scan.skipped.push(skip(node, 'its name matches no convention'));
        }
        // Inside a recognised layer only labels are read; elsewhere groups are walked into.
        const space = GROUPS.has(node.type) ? groupSpace(node, matrix, parent) : matrix;
        for (const child of node.children ?? []) visit(child, space, inMatch || role !== undefined);
    };

    // The Plugin API places a group's children in the space of the group's parent, and the REST
    // API is documented as placing every node relative to its parent. A child's bounds on the
    // canvas tell which holds; without them, the Plugin API's rule.
    const groupSpace = (group: FigmaNode, own: Matrix, parent: Matrix): Matrix => {
        const origin = frame.absoluteBoundingBox;
        const child = group.children?.find((c) => c.size && c.absoluteBoundingBox);
        if (!origin || !child?.absoluteBoundingBox) return parent;
        const { x, y } = child.absoluteBoundingBox;
        const miss = (space: Matrix) => {
            const box = boxOf(child, multiply(space, child.relativeTransform ?? IDENTITY))!;
            const left = Math.min(...box.map((p) => p[0]));
            const top = Math.min(...box.map((p) => p[1]));
            return Math.hypot(left - (x - origin.x), top - (y - origin.y));
        };
        return miss(own) < miss(parent) ? own : parent;
    };
    for (const child of frame.children ?? []) visit(child, IDENTITY, false);
    return scan;
}

/** Turns a Scan into Commands for one Level, in metres through the calibration. */
export function buildCommands(scan: Scan, calibration: Calibration, levelId: Id): Extraction {
    // Rounded to a tenth of a millimetre, so ends meant to meet are equal and share a Wall Node.
    const toPlan = (p: Vec2): Vec2 =>
        sourceToPlan(calibration, p).map((v) => Math.round(v * 1e4) / 1e4) as Vec2;
    const scale = calibration.scale;
    const commands: Command[] = [];
    const sourceRefs: Record<Id, string> = {};
    const notes = [...scan.notes];
    const skipped = [...scan.skipped];
    const idOf = (node: FigmaNode) => `fig-${node.id.replace(/[:;]/g, '-')}`;
    const of = <R extends Role['role']>(role: R) =>
        scan.found.filter(
            (f): f is Found & { role: Extract<Role, { role: R }> } => f.role.role === role,
        );

    // Outline: the largest layer called Outline or Floor.
    const outlines = of('outline').sort((a, b) => area(b.ring) - area(a.ring));
    for (const extra of outlines.slice(1)) skipped.push(skip(extra.node, 'a second Outline'));
    if (outlines[0]) {
        commands.push({
            type: 'level.setOutline',
            levelId,
            outline: { outer: outlines[0].ring.map(toPlan) },
        });
    } else {
        notes.push(
            'No layer called Outline or Floor: the placeholder Outline stays; set it yourself',
        );
    }

    // Walls: the centre line of each bar, with ends that stop short of or overrun a crossing
    // Wall moved onto it, so corners and T-junctions share a Wall Node.
    const walls = of('wall').map((f) => {
        const { ends, thickness } = axis(f.box, f.lineWeight);
        return {
            f,
            id: idOf(f.node),
            a: toPlan(ends[0]),
            b: toPlan(ends[1]),
            thickness: thickness * scale,
        };
    });
    for (const wall of walls) {
        for (const end of ['a', 'b'] as const) {
            for (const other of walls) {
                if (other === wall) continue;
                const reach = Math.max(wall.thickness, other.thickness);
                if (distanceToSegment(wall[end], other.a, other.b) > reach) continue;
                const meet = intersection(wall.a, wall.b, other.a, other.b);
                if (meet && Math.hypot(meet[0] - wall[end][0], meet[1] - wall[end][1]) <= reach) {
                    wall[end] = meet.map((v) => Math.round(v * 1e4) / 1e4) as Vec2;
                }
            }
        }
    }
    for (const wall of walls) {
        commands.push({
            type: 'wall.add',
            levelId,
            id: wall.id,
            a: wall.a,
            b: wall.b,
            thickness: round(wall.thickness),
        });
        sourceRefs[wall.id] = wall.f.node.id;
    }

    // Openings: hosted on the nearest Wall they lie along, else free.
    for (const f of of('opening')) {
        const id = idOf(f.node);
        const corners = f.box.map(toPlan);
        const centre = centroid(corners);
        const host = walls
            .map((w) => ({ w, d: distanceToSegment(centre, w.a, w.b) }))
            .filter(({ w, d }) => d <= w.thickness / 2 + shortSide(corners) / 2 + 0.05)
            .sort((x, y) => x.d - y.d)[0]?.w;
        if (host) {
            const length = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]);
            const dir: Vec2 = [(host.b[0] - host.a[0]) / length, (host.b[1] - host.a[1]) / length];
            const along = corners.map(
                (p) => (p[0] - host.a[0]) * dir[0] + (p[1] - host.a[1]) * dir[1],
            );
            // An Opening's offset is to its centre (core's HostedOpening), within the Wall.
            const start = Math.max(0, Math.min(...along));
            const end = Math.min(Math.max(...along), length);
            const width = end - start;
            const offset = (start + end) / 2;
            commands.push({
                type: 'opening.add',
                levelId,
                opening: {
                    id,
                    kind: f.role.kind,
                    width: round(width),
                    host: 'wall',
                    wallId: host.id,
                    offset: round(offset),
                },
            });
        } else {
            const { ends } = axis(f.box);
            const [p, q] = ends.map(toPlan) as [Vec2, Vec2];
            commands.push({
                type: 'opening.add',
                levelId,
                opening: {
                    id,
                    kind: f.role.kind,
                    width: round(Math.hypot(q[0] - p[0], q[1] - p[1])),
                    host: 'free',
                    position: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
                    angle: Math.atan2(q[1] - p[1], q[0] - p[0]),
                },
            });
            notes.push(`"${f.node.name}" is on no Wall, so it is a free Opening`);
        }
        sourceRefs[id] = f.node.id;
    }

    // Zones, labelled by their name or else by the text inside them (each text used once).
    const used = new Set<FigmaNode>();
    const zones = of('zone').sort((a, b) => area(a.ring) - area(b.ring));
    for (const f of zones) {
        const id = idOf(f.node);
        let label = f.role.label;
        if (!label) {
            const text = scan.texts.find((t) => !used.has(t.node) && inside(t.centre, f.ring));
            if (text) {
                used.add(text.node);
                label = text.text.trim();
            }
        } else {
            // The text repeating the name's label is not left over.
            const twin = scan.texts.find(
                (t) => !used.has(t.node) && t.text.trim() === label && inside(t.centre, f.ring),
            );
            if (twin) used.add(twin.node);
        }
        const { category, restricted, walkAround } = f.role;
        commands.push({
            type: 'zone.add',
            levelId,
            zone: {
                id,
                shape: { outer: f.ring.map(toPlan) },
                ...(label && { label }),
                ...(category && { category }),
                ...(restricted && { restricted }),
                ...(walkAround && { walkAround }),
            },
        });
        sourceRefs[id] = f.node.id;
    }

    for (const f of of('obstacle')) {
        const id = idOf(f.node);
        commands.push({
            type: 'obstacle.add',
            levelId,
            obstacle: { id, kind: f.role.kind, shape: { outer: f.ring.map(toPlan) } },
        });
        sourceRefs[id] = f.node.id;
    }

    return {
        commands,
        sourceRefs,
        counts: {
            outline: outlines.length > 0 ? 1 : 0,
            walls: walls.length,
            openings: of('opening').length,
            zones: zones.length,
            obstacles: of('obstacle').length,
        },
        skipped,
        notes,
        unusedTexts: scan.texts.filter((t) => !used.has(t.node)).map((t) => t.text),
    };
}

/** The role a layer's name gives it, or undefined. */
export function roleOf(name: string, preset: Preset): Role | undefined {
    const n = name.trim();
    const rest = (prefix: RegExp) =>
        n
            .replace(prefix, '')
            .replace(/^[\s:–—-]+/, '')
            .trim() || undefined;
    let m: RegExpMatchArray | null;
    if ((m = n.match(/^dimension\s+(\d+(?:[.,]\d+)?)\s*m\b/i))) {
        return { role: 'dimension', metres: Number(m[1]!.replace(',', '.')) };
    }
    if (/^(outline|floor)\b/i.test(n)) return { role: 'outline' };
    if (/^walls?\b/i.test(n)) return { role: 'wall' };
    if ((m = n.match(/^(emergency[\s_-]*exit|exit|door|entrance|passage)\b/i))) {
        const word = m[1]!.toLowerCase();
        const kind: OpeningKind = word.includes('exit') ? 'emergency-exit' : (word as OpeningKind);
        return { role: 'opening', kind };
    }
    if ((m = n.match(/^(column|pillar|shaft|void|obstacle)\b/i))) {
        const word = m[1]!.toLowerCase();
        const kind: Obstacle['kind'] =
            word === 'pillar'
                ? 'column'
                : word === 'obstacle'
                  ? 'other'
                  : (word as Obstacle['kind']);
        return { role: 'obstacle', kind };
    }
    if (/^restricted\b/i.test(n)) {
        const label = rest(/^restricted\b/i);
        return { role: 'zone', restricted: true, ...(label && { label }) };
    }
    if (/^zone\b/i.test(n)) {
        const label = rest(/^zone\b/i);
        return { role: 'zone', ...(label && { label }) };
    }
    // A Preset category by id or label, longest first: "Meeting room 4", "booth A1".
    const words = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ');
    const candidates = preset.categories
        .flatMap((c) => [c.id, c.label].map((term) => ({ c, term: words(term) })))
        .sort((a, b) => b.term.length - a.term.length);
    const lower = words(n);
    for (const { c, term } of candidates) {
        if (lower === term || lower.startsWith(term + ' ') || lower.startsWith(term + ':')) {
            const label =
                n
                    .slice(term.length)
                    .replace(/^[\s:–—-]+/, '')
                    .trim() || undefined;
            return {
                role: 'zone',
                category: c.id,
                ...(c.restricted && { restricted: true }),
                ...(c.walkAround && { walkAround: true }),
                ...(label && { label }),
            };
        }
    }
    return undefined;
}

// --- Geometry --------------------------------------------------------------------------------

function multiply(p: Matrix, c: Matrix): Matrix {
    return [
        [
            p[0][0] * c[0][0] + p[0][1] * c[1][0],
            p[0][0] * c[0][1] + p[0][1] * c[1][1],
            p[0][0] * c[0][2] + p[0][1] * c[1][2] + p[0][2],
        ],
        [
            p[1][0] * c[0][0] + p[1][1] * c[1][0],
            p[1][0] * c[0][1] + p[1][1] * c[1][1],
            p[1][0] * c[0][2] + p[1][1] * c[1][2] + p[1][2],
        ],
    ];
}

function transform(m: Matrix, [x, y]: Vec2): Vec2 {
    return [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]];
}

/** The node's own rectangle (or a LINE's two ends, twice) in frame units. */
function boxOf(node: FigmaNode, m: Matrix): Vec2[] | undefined {
    if (!node.size) return undefined;
    const { x: w, y: h } = node.size;
    return (
        [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
        ] as Vec2[]
    ).map((p) => transform(m, p));
}

/** A polygon from the fill path when it has straight edges only, else the rectangle. */
function ringOf(node: FigmaNode, m: Matrix, box: Vec2[]): { ring: Vec2[]; curved: boolean } {
    const rectangular =
        node.type === 'RECTANGLE' || CONTAINERS.has(node.type) || node.type === 'LINE';
    const path = node.fillGeometry?.[0]?.path;
    if (rectangular || !path) return { ring: box, curved: false };
    const points = straightPath(path);
    if (!points || points.length < 3) return { ring: box, curved: true };
    return { ring: points.map((p) => transform(m, p)), curved: false };
}

/** The first sub-path of an SVG path made of M, L, H, V and Z only, or undefined. */
function straightPath(path: string): Vec2[] | undefined {
    const tokens = path.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    const points: Vec2[] = [];
    let i = 0;
    let command = '';
    let at: Vec2 = [0, 0];
    while (i < tokens.length) {
        const token = tokens[i]!;
        if (/[a-zA-Z]/.test(token)) {
            command = token;
            i++;
            if (command === 'Z' || command === 'z') {
                if (points.length > 0) break; // only the outer sub-path
                continue;
            }
            if (!'MLHVmlhv'.includes(command)) return undefined;
            continue;
        }
        const num = (k: number) => Number(tokens[i + k]);
        const relative = command === command.toLowerCase();
        if (command === 'M' || command === 'L' || command === 'm' || command === 'l') {
            at = relative ? [at[0] + num(0), at[1] + num(1)] : [num(0), num(1)];
            i += 2;
        } else if (command === 'H' || command === 'h') {
            at = [relative ? at[0] + num(0) : num(0), at[1]];
            i += 1;
        } else {
            at = [at[0], relative ? at[1] + num(0) : num(0)];
            i += 1;
        }
        points.push(at);
    }
    const [first] = points;
    const last = points.at(-1);
    if (first && last && points.length > 1 && first[0] === last[0] && first[1] === last[1])
        points.pop();
    return points;
}

/** The long axis of a box: its two ends (mid-points of the short sides) and the box's width across. */
function axis(box: Vec2[], lineWeight?: number): { ends: [Vec2, Vec2]; thickness: number } {
    const [p0, p1, p2, p3] = box as [Vec2, Vec2, Vec2, Vec2];
    const along = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const across = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (lineWeight !== undefined) return { ends: [p0, p1], thickness: lineWeight };
    return along >= across
        ? { ends: [mid(p0, p3), mid(p1, p2)], thickness: across }
        : { ends: [mid(p0, p1), mid(p3, p2)], thickness: along };
}

function shortSide(corners: Vec2[]): number {
    const [p0, p1, , p3] = corners as [Vec2, Vec2, Vec2, Vec2];
    return Math.min(
        Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
        Math.hypot(p3[0] - p0[0], p3[1] - p0[1]),
    );
}

function centroid(points: Vec2[]): Vec2 {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

function area(ring: Ring): number {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
}

/** Even-odd point-in-polygon. */
function inside([x, y]: Vec2, ring: Vec2[]): boolean {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
    }
    return result;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const lengthSq = dx * dx + dy * dy;
    const t =
        lengthSq === 0
            ? 0
            : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Where the lines through a–b and c–d cross, or undefined if they are parallel. */
function intersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | undefined {
    const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
    const denominator = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(denominator) < 1e-9) return undefined;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denominator;
    return [a[0] + t * r[0], a[1] + t * r[1]];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function skip(node: FigmaNode, reason: string): Skipped {
    return { nodeId: node.id, name: node.name, type: node.type, reason };
}
