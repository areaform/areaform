import type { ElementRef } from '../elements.ts';
import {
    boundingBox,
    collinearOverlap,
    distance,
    EPSILON,
    locateInShape,
    overlappingBoxPairs,
    ringsOverlap,
    ringWithinShape,
} from '../geometry/geometry.ts';
import type { AreaformDocument, Level, Shape, Vec2 } from '../model.ts';
import { exclusiveCategories, presetFor, type Preset } from '../presets.ts';
import { holesOverlap } from '../geometry/queries.ts';

/** A non-blocking problem; the Document stays valid and can always be saved. */
export type Diagnostic =
    | { code: 'outside-outline'; ref: ElementRef }
    | { code: 'opening-off-wall'; ref: ElementRef }
    | { code: 'zones-overlap'; ref: ElementRef; other: ElementRef }
    | { code: 'walls-overlap'; ref: ElementRef; other: ElementRef }
    | { code: 'hole-outside-outer'; ref: ElementRef }
    /** An Outline, Zone or Obstacle with two holes that overlap. */
    | { code: 'holes-overlap'; ref: ElementRef }
    /** A Stop that does not overlap the Stop of the same Connection on the Level below. */
    | { code: 'stop-misaligned'; ref: ElementRef; other: ElementRef };

export interface DiagnoseOptions {
    /** The Presets to look the Space Kind up in; the built-in `defaultPresets` when absent. */
    presets?: Record<string, Preset>;
}

export function diagnose(doc: AreaformDocument, { presets }: DiagnoseOptions = {}): Diagnostic[] {
    const exclusive = new Set(exclusiveCategories(presetFor(doc.kind, presets)));
    const diagnostics = doc.levels.flatMap((level) => [
        ...outsideOutline(level),
        ...openingsOffWall(level),
        ...zonesOverlap(level, exclusive),
        ...wallsOverlap(level),
        ...holesOutsideOuter(level),
        ...holesOverlapping(level),
    ]);
    return [...diagnostics, ...stopsMisaligned(doc)];
}

function outsideOutline(level: Level): Diagnostic[] {
    const levelId = level.id;
    const nodes = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const outside = (ref: ElementRef): Diagnostic => ({ code: 'outside-outline', ref });
    const diagnostics: Diagnostic[] = [];

    for (const wall of level.walls) {
        const a = nodes.get(wall.a);
        const b = nodes.get(wall.b);
        if (a && b && !ringWithinShape([a, b], level.outline)) {
            diagnostics.push(outside({ kind: 'wall', id: wall.id, levelId }));
        }
    }
    for (const opening of level.openings) {
        if (
            opening.host === 'free' &&
            locateInShape(opening.position, level.outline) === 'outside'
        ) {
            diagnostics.push(outside({ kind: 'opening', id: opening.id, levelId }));
        }
    }
    for (const zone of level.zones) {
        if (!ringWithinShape(zone.shape.outer, level.outline)) {
            diagnostics.push(outside({ kind: 'zone', id: zone.id, levelId }));
        }
    }
    for (const obstacle of level.obstacles) {
        if (!ringWithinShape(obstacle.shape.outer, level.outline)) {
            diagnostics.push(outside({ kind: 'obstacle', id: obstacle.id, levelId }));
        }
    }
    return diagnostics;
}

function openingsOffWall(level: Level): Diagnostic[] {
    const nodes = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const lengths = new Map(
        level.walls.map((w) => [w.id, distance(nodes.get(w.a)!, nodes.get(w.b)!)]),
    );
    return level.openings.flatMap((opening): Diagnostic[] => {
        if (opening.host !== 'wall') return [];
        const length = lengths.get(opening.wallId) ?? 0;
        const half = opening.width / 2;
        const fits = opening.offset - half >= -EPSILON && opening.offset + half <= length + EPSILON;
        return fits
            ? []
            : [
                  {
                      code: 'opening-off-wall',
                      ref: { kind: 'opening', id: opening.id, levelId: level.id },
                  },
              ];
    });
}

function zonesOverlap(level: Level, exclusive: Set<string>): Diagnostic[] {
    const zones = level.zones.filter((z) => z.category !== undefined && exclusive.has(z.category));
    const pairs = overlappingBoxPairs(zones.map((z) => boundingBox(z.shape.outer)));
    return pairs.flatMap(([i, j]): Diagnostic[] => {
        const a = zones[i]!;
        const b = zones[j]!;
        if (!ringsOverlap(a.shape.outer, b.shape.outer)) return [];
        return [
            {
                code: 'zones-overlap',
                ref: { kind: 'zone', id: a.id, levelId: level.id },
                other: { kind: 'zone', id: b.id, levelId: level.id },
            },
        ];
    });
}

function wallsOverlap(level: Level): Diagnostic[] {
    const nodes = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    const segments = level.walls.map((w) => [nodes.get(w.a)!, nodes.get(w.b)!] as [Vec2, Vec2]);
    const pairs = overlappingBoxPairs(segments.map((s) => boundingBox(s)));
    return pairs.flatMap(([i, j]): Diagnostic[] => {
        const [a1, a2] = segments[i]!;
        const [b1, b2] = segments[j]!;
        if (collinearOverlap(a1, a2, b1, b2) <= EPSILON) return [];
        return [
            {
                code: 'walls-overlap',
                ref: { kind: 'wall', id: level.walls[i]!.id, levelId: level.id },
                other: { kind: 'wall', id: level.walls[j]!.id, levelId: level.id },
            },
        ];
    });
}

function holesOutsideOuter(level: Level): Diagnostic[] {
    const misplaced = (shape: Shape) =>
        (shape.holes ?? []).some((hole) => !ringWithinShape(hole, { outer: shape.outer }));
    return shapesWhere(level, misplaced).map((ref) => ({ code: 'hole-outside-outer', ref }));
}

function holesOverlapping(level: Level): Diagnostic[] {
    return shapesWhere(level, holesOverlap).map((ref) => ({ code: 'holes-overlap', ref }));
}

/** The Outline, Zones and Obstacles of a Level whose shape fails `test`. */
function shapesWhere(level: Level, test: (shape: Shape) => boolean): ElementRef[] {
    const levelId = level.id;
    return [
        ...(test(level.outline) ? [{ kind: 'level' as const, id: levelId }] : []),
        ...level.zones
            .filter((z) => test(z.shape))
            .map((z) => ({ kind: 'zone' as const, id: z.id, levelId })),
        ...level.obstacles
            .filter((o) => test(o.shape))
            .map((o) => ({ kind: 'obstacle' as const, id: o.id, levelId })),
    ];
}

function stopsMisaligned(doc: AreaformDocument): Diagnostic[] {
    const elevation = new Map(doc.levels.map((l) => [l.id, l.elevation]));
    return doc.connections.flatMap((connection) => {
        const stops = [...connection.stops].sort(
            (a, b) => (elevation.get(a.levelId) ?? 0) - (elevation.get(b.levelId) ?? 0),
        );
        return stops.slice(1).flatMap((stop, i): Diagnostic[] => {
            const below = stops[i]!;
            if (ringsOverlap(stop.shape.outer, below.shape.outer)) return [];
            return [
                {
                    code: 'stop-misaligned',
                    ref: { kind: 'stop', id: connection.id, levelId: stop.levelId },
                    other: { kind: 'stop', id: connection.id, levelId: below.levelId },
                },
            ];
        });
    });
}
