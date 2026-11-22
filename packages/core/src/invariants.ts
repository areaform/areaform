import { isValidShape, samePoint } from './geometry.ts';
import { validLanguages } from './languages.ts';
import {
    MAX_VIEWPOINT_TILT,
    type AreaformDocument,
    type Connection,
    type Id,
    type Level,
    type Underlay,
    type Viewpoint,
} from './model.ts';

export type InvariantError =
    | { code: 'duplicate-id'; id: Id }
    | { code: 'unknown-level'; levelId: Id }
    | { code: 'unknown-element'; id: Id }
    | { code: 'dangling-reference'; id: Id; ref: Id }
    | { code: 'degenerate-wall'; id: Id }
    | { code: 'no-levels' }
    /** A Grid Step that is not a positive number. */
    | { code: 'invalid-grid' }
    /** Non-finite elevation, or a ceiling height that is not positive. */
    | { code: 'invalid-level'; id: Id }
    | { code: 'invalid-underlay'; id: Id }
    /**
     * A Viewpoint with a non-finite number, a tilt outside 0 to `MAX_VIEWPOINT_TILT`°, a distance
     * of 0 or less, or a negative time; also an `index` outside its Level's list.
     */
    | { code: 'invalid-viewpoint'; id: Id }
    | { code: 'too-few-stops'; id: Id }
    | { code: 'duplicate-stop'; id: Id; levelId: Id }
    /** A self-intersecting, degenerate or non-finite ring in an Outline, Zone, Obstacle or Stop. */
    | { code: 'invalid-shape'; id: Id }
    /** Content Languages with a malformed tag, or a language listed twice (the default included). */
    | { code: 'invalid-languages' }
    /** A text set in a language the Space does not offer, or with its default unknown. */
    | { code: 'unknown-language'; language: string }
    /** A text removed where one is required, such as a Level's name in the default language. */
    | { code: 'required-text'; id: Id };

/** Thrown by a Command that cannot even be applied; the Editor turns it into a rejection. */
export class Rejection extends Error {
    readonly errors: InvariantError[];

    constructor(errors: InvariantError[]) {
        super(errors.map((e) => e.code).join(', '));
        this.errors = errors;
    }
}

/** Every rule a Document must always satisfy. An empty list means the Document is valid. */
export function checkInvariants(doc: AreaformDocument): InvariantError[] {
    const errors: InvariantError[] = [];
    const seen = new Set<Id>([doc.id]);
    const claim = (id: Id) => {
        if (seen.has(id)) errors.push({ code: 'duplicate-id', id });
        seen.add(id);
    };

    for (const level of doc.levels) {
        claim(level.id);
        if (!Number.isFinite(level.elevation) || !(level.height > 0)) {
            errors.push({ code: 'invalid-level', id: level.id });
        }
        for (const list of [
            level.wallNodes,
            level.walls,
            level.openings,
            level.zones,
            level.obstacles,
            level.underlays,
        ]) {
            for (const element of list) claim(element.id);
        }
        errors.push(...checkWalls(level), ...checkOpenings(level), ...checkShapes(level));
        for (const underlay of level.underlays) {
            if (!isValidUnderlay(underlay))
                errors.push({ code: 'invalid-underlay', id: underlay.id });
        }
        for (const viewpoint of level.viewpoints ?? []) {
            claim(viewpoint.id);
            if (!isValidViewpoint(viewpoint))
                errors.push({ code: 'invalid-viewpoint', id: viewpoint.id });
        }
    }
    if (doc.levels.length === 0) errors.push({ code: 'no-levels' });
    if (!(doc.grid.step > 0) || !Number.isFinite(doc.grid.step))
        errors.push({ code: 'invalid-grid' });
    if (doc.languages && !validLanguages(doc.languages)) errors.push({ code: 'invalid-languages' });
    for (const connection of doc.connections) {
        claim(connection.id);
        errors.push(...checkConnection(connection, doc));
    }

    return errors;
}

function checkWalls(level: Level): InvariantError[] {
    const errors: InvariantError[] = [];
    const nodes = new Map(level.wallNodes.map((node) => [node.id, node.position]));

    for (const wall of level.walls) {
        const a = nodes.get(wall.a);
        const b = nodes.get(wall.b);
        if (!a) errors.push({ code: 'dangling-reference', id: wall.id, ref: wall.a });
        if (!b) errors.push({ code: 'dangling-reference', id: wall.id, ref: wall.b });
        if (a && b && samePoint(a, b)) {
            errors.push({ code: 'degenerate-wall', id: wall.id });
        }
    }
    return errors;
}

function checkOpenings(level: Level): InvariantError[] {
    const walls = new Set(level.walls.map((wall) => wall.id));
    return level.openings.flatMap((opening): InvariantError[] =>
        opening.host === 'wall' && !walls.has(opening.wallId)
            ? [{ code: 'dangling-reference', id: opening.id, ref: opening.wallId }]
            : [],
    );
}

function checkShapes(level: Level): InvariantError[] {
    const errors: InvariantError[] = [];
    if (!isValidShape(level.outline)) errors.push({ code: 'invalid-shape', id: level.id });
    for (const element of [...level.zones, ...level.obstacles]) {
        if (!isValidShape(element.shape)) errors.push({ code: 'invalid-shape', id: element.id });
    }
    return errors;
}

function checkConnection(connection: Connection, doc: AreaformDocument): InvariantError[] {
    const errors: InvariantError[] = [];
    const id = connection.id;
    if (connection.stops.length < 2) errors.push({ code: 'too-few-stops', id });

    const levels = new Set(doc.levels.map((level) => level.id));
    const served = new Set<Id>();
    for (const { levelId } of connection.stops) {
        if (!levels.has(levelId)) errors.push({ code: 'dangling-reference', id, ref: levelId });
        if (served.has(levelId)) errors.push({ code: 'duplicate-stop', id, levelId });
        served.add(levelId);
    }
    if (!connection.stops.every((stop) => isValidShape(stop.shape))) {
        errors.push({ code: 'invalid-shape', id });
    }
    return errors;
}

function isValidViewpoint({ target, bearing, tilt, distance, flight, pause }: Viewpoint): boolean {
    const time = (seconds: number | undefined) =>
        seconds === undefined || (Number.isFinite(seconds) && seconds >= 0);
    return (
        target.every(Number.isFinite) &&
        Number.isFinite(bearing) &&
        isViewpointTilt(tilt) &&
        Number.isFinite(distance) &&
        distance > 0 &&
        time(flight) &&
        time(pause)
    );
}

/** Whether `degrees` is a tilt a Viewpoint may have: from straight down to `MAX_VIEWPOINT_TILT`. */
export function isViewpointTilt(degrees: number): boolean {
    return Number.isFinite(degrees) && degrees >= 0 && degrees <= MAX_VIEWPOINT_TILT;
}

function isValidUnderlay({ position, scale, rotation, opacity, size }: Underlay): boolean {
    return (
        (size === undefined || size.every((v) => Number.isFinite(v) && v > 0)) &&
        position.every(Number.isFinite) &&
        Number.isFinite(scale) &&
        scale > 0 &&
        Number.isFinite(rotation) &&
        opacity >= 0 &&
        opacity <= 1
    );
}
