// Copy and paste: a selection as position-independent data, pasted back as one undo step.
import type {
    Editor,
    ElementRef,
    AreaformDocument,
    FreeOpening,
    HostedOpening,
    Id,
    Input,
    Obstacle,
    Shape,
    Underlay,
    Vec2,
    Zone,
} from '@areaform/core';
import { findLevel, onSegment, wallAt } from './elements.ts';

/** What was copied, with plan coordinates as they were; ids are left out. */
export interface Clip {
    levelId: Id;
    zones: Input<Zone>[];
    obstacles: Input<Obstacle>[];
    /** Walls by their end points, each with the doors and other Openings it hosts. */
    walls: {
        a: Vec2;
        b: Vec2;
        thickness: number;
        height?: number;
        openings: Pick<HostedOpening, 'kind' | 'width' | 'offset' | 'hinge' | 'swing'>[];
    }[];
    /** Free-standing Openings (hosted ones travel with their Wall). */
    openings: Input<FreeOpening>[];
    underlays: Input<Underlay>[];
}

/**
 * The copyable part of a selection: Zones, Obstacles, Walls (with the Openings they host), free
 * Openings and Underlays. Null when none of the selection can be copied.
 */
export function copyElements(doc: AreaformDocument, levelId: Id, refs: ElementRef[]): Clip | null {
    const level = findLevel(doc, levelId);
    if (!level) return null;
    const picked = (kind: ElementRef['kind']) =>
        new Set(refs.filter((r) => r.kind === kind).map((r) => r.id));
    const [zoneIds, obstacleIds, wallIds, openingIds, underlayIds] = (
        ['zone', 'obstacle', 'wall', 'opening', 'underlay'] as const
    ).map(picked) as [Set<Id>, Set<Id>, Set<Id>, Set<Id>, Set<Id>];
    const positions = new Map(level.wallNodes.map((n) => [n.id, n.position]));

    const clip: Clip = {
        levelId,
        zones: level.zones.filter((z) => zoneIds.has(z.id)).map(withoutId),
        obstacles: level.obstacles.filter((o) => obstacleIds.has(o.id)).map(withoutId),
        walls: level.walls.flatMap((wall) => {
            const a = positions.get(wall.a);
            const b = positions.get(wall.b);
            if (!wallIds.has(wall.id) || !a || !b) return [];
            const openings = level.openings.flatMap((o) =>
                o.host === 'wall' && o.wallId === wall.id
                    ? [
                          {
                              kind: o.kind,
                              width: o.width,
                              offset: o.offset,
                              ...(o.hinge && { hinge: o.hinge }),
                              ...(o.swing && { swing: o.swing }),
                          },
                      ]
                    : [],
            );
            return [
                {
                    a,
                    b,
                    thickness: wall.thickness,
                    ...(wall.height !== undefined && { height: wall.height }),
                    openings,
                },
            ];
        }),
        openings: level.openings.flatMap((o) =>
            o.host === 'free' && openingIds.has(o.id) ? [withoutId(o)] : [],
        ),
        underlays: level.underlays.filter((u) => underlayIds.has(u.id)).map(withoutId),
    };
    const count =
        clip.zones.length +
        clip.obstacles.length +
        clip.walls.length +
        clip.openings.length +
        clip.underlays.length;
    return count > 0 ? clip : null;
}

/**
 * Adds the clip to a Level, moved by `offset`, in one transaction (one undo step). Returns the
 * new Elements, or null (and changes nothing) if the Document refuses any of them.
 */
export function pasteElements(
    editor: Editor,
    levelId: Id,
    clip: Clip,
    offset: Vec2,
): ElementRef[] | null {
    const before = findLevel(editor.getDocument(), levelId);
    if (!before) return null;
    const move = ([x, y]: Vec2): Vec2 => [round(x + offset[0]), round(y + offset[1])];
    const moveShape = (shape: Shape): Shape => ({
        outer: shape.outer.map(move),
        ...(shape.holes && { holes: shape.holes.map((h) => h.map(move)) }),
    });

    const tx = editor.begin();
    let ok = true;
    const run = (command: Parameters<Editor['exec']>[0]) => {
        if (ok) ok = tx.exec(command).ok;
    };
    for (const zone of clip.zones) {
        run({
            type: 'zone.add',
            levelId,
            zone: {
                ...zone,
                shape: moveShape(zone.shape),
                ...(zone.labelAnchor && { labelAnchor: move(zone.labelAnchor) }),
            },
        });
    }
    for (const obstacle of clip.obstacles) {
        run({
            type: 'obstacle.add',
            levelId,
            obstacle: { ...obstacle, shape: moveShape(obstacle.shape) },
        });
    }
    const segments: [Vec2, Vec2][] = [];
    for (const { a, b, openings, ...props } of clip.walls) {
        const [pa, pb] = [move(a), move(b)];
        segments.push([pa, pb]);
        run({ type: 'wall.add', levelId, a: pa, b: pb, ...props });
        // The new Wall may have been split where it crosses others: host each Opening on the
        // piece that holds its centre.
        const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        for (const opening of openings) {
            const t = opening.offset / length;
            const centre: Vec2 = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
            const host = ok ? wallAt(findLevel(editor.getDocument(), levelId)!, centre) : null;
            if (!host) {
                ok = false;
                break;
            }
            run({
                type: 'opening.add',
                levelId,
                opening: {
                    ...opening,
                    host: 'wall',
                    wallId: host.wallId,
                    offset: host.offset,
                },
            });
        }
    }
    for (const opening of clip.openings) {
        run({
            type: 'opening.add',
            levelId,
            opening: { ...opening, position: move(opening.position) },
        });
    }
    for (const underlay of clip.underlays) {
        run({
            type: 'underlay.add',
            levelId,
            underlay: { ...underlay, position: move(underlay.position) },
        });
    }
    if (!ok) {
        tx.cancel();
        return null;
    }
    tx.commit();

    const after = findLevel(editor.getDocument(), levelId)!;
    const added = <T extends { id: Id }>(now: T[], then: T[]) => {
        const old = new Set(then.map((e) => e.id));
        return now.filter((e) => !old.has(e.id));
    };
    const positions = new Map(after.wallNodes.map((n) => [n.id, n.position]));
    const pasted = (p: Vec2 | undefined, q: Vec2 | undefined) =>
        p !== undefined &&
        q !== undefined &&
        segments.some(([a, b]) => onSegment(p, a, b) && onSegment(q, a, b));
    return [
        ...added(after.zones, before.zones).map((z) => ref('zone', z.id, levelId)),
        ...added(after.obstacles, before.obstacles).map((o) => ref('obstacle', o.id, levelId)),
        // Pieces of pasted Walls, wherever later Walls of the paste split them.
        ...after.walls
            .filter((w) => pasted(positions.get(w.a), positions.get(w.b)))
            .map((w) => ref('wall', w.id, levelId)),
        ...added(after.openings, before.openings).map((o) => ref('opening', o.id, levelId)),
        ...added(after.underlays, before.underlays).map((u) => ref('underlay', u.id, levelId)),
    ];
}

const ref = (kind: ElementRef['kind'], id: Id, levelId: Id): ElementRef => ({ kind, id, levelId });
const round = (v: number) => Number(v.toFixed(9));

function withoutId<T extends { id: Id }>(element: T): Omit<T, 'id'> {
    const copy: Partial<T> = { ...element };
    delete copy.id;
    return copy as Omit<T, 'id'>;
}

const FORMAT = 'areaform/clip';

/** A clip as text for the system clipboard: JSON with a format marker and version. */
export function serializeClip(clip: Clip): string {
    return JSON.stringify({ format: FORMAT, version: 1, ...clip });
}

/**
 * A clip read back from clipboard text, or null for anything else (other text, other versions,
 * or JSON missing what a paste needs). The Document's Invariants check the rest on paste.
 */
export function parseClip(text: string): Clip | null {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isRecord(data) || data.format !== FORMAT || data.version !== 1) return null;
    const { levelId, zones, obstacles, walls, openings, underlays } = data;
    if (typeof levelId !== 'string') return null;
    const lists = [zones, obstacles, walls, openings, underlays];
    if (!lists.every(Array.isArray)) return null;
    const shaped = (items: unknown[]) =>
        items.every((i) => isRecord(i) && isRecord(i.shape) && isRing(i.shape.outer));
    const placed = (items: unknown[]) => items.every((i) => isRecord(i) && isVec2(i.position));
    const wallsOk = (walls as unknown[]).every(
        (w) =>
            isRecord(w) &&
            isVec2(w.a) &&
            isVec2(w.b) &&
            typeof w.thickness === 'number' &&
            Array.isArray(w.openings) &&
            w.openings.every((o) => isRecord(o) && typeof o.offset === 'number'),
    );
    if (
        !shaped(zones as unknown[]) ||
        !shaped(obstacles as unknown[]) ||
        !wallsOk ||
        !placed(openings as unknown[]) ||
        !placed(underlays as unknown[])
    )
        return null;
    if (lists.every((list) => (list as unknown[]).length === 0)) return null;
    return data as unknown as Clip;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVec2(value: unknown): value is Vec2 {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((v) => typeof v === 'number' && Number.isFinite(v))
    );
}

function isRing(value: unknown): boolean {
    return Array.isArray(value) && value.length >= 3 && value.every(isVec2);
}
