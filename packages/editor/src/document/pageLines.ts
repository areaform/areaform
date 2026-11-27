// What the Editor copies for a client's page that drives the plan's camera (ADR-0030): ready lines
// for `element.areaform`, by id, with the name in a comment, since names repeat and change.
import type { Id, Level, Vec2, Viewpoint, Zone } from '@areaform/core';

/** The page's handle on the plan, as the docs name it: `const el = …` on the snippet's element. */
const PLAN = 'el.areaform';

/** A name as a comment at the end of a line, on one line; nothing without a name. */
function comment(name: string | undefined): string {
    const text = name?.replace(/\s+/g, ' ').trim();
    return text ? ` // ${text}` : '';
}

/** Metres to the centimetre, without a trailing `.0` or a `-0`. */
function metres(value: number): string {
    return String(Math.round(value * 100) / 100 + 0);
}

/** A line that flies the camera to this Viewpoint. */
export function flyToLine(viewpoint: Pick<Viewpoint, 'id' | 'name'>): string {
    return `${PLAN}.flyTo('${viewpoint.id}');${comment(viewpoint.name)}`;
}

/** A line that shows this Level. */
export function setLevelLine(level: Pick<Level, 'id' | 'name'>): string {
    return `${PLAN}.setLevel('${level.id}');${comment(level.name)}`;
}

/** A line that turns the camera to this Zone, coming closer if it is small. */
export function lookAtZoneLine(zone: Pick<Zone, 'id' | 'label'>): string {
    return `${PLAN}.lookAt('${zone.id}');${comment(zone.label)}`;
}

/** A line that turns the camera to a plan point, metres, on the Level shown. */
export function lookAtPointLine(point: Vec2): string {
    return `${PLAN}.lookAt([${metres(point[0])}, ${metres(point[1])}]);`;
}

/** The 3D view as it is now, for `flyTo`: to the centimetre, with its Level. */
export function cameraLiteral(camera: {
    position: readonly number[];
    target: readonly number[];
    levelId: Id;
}): string {
    const list = (values: readonly number[]) => `[${values.map(metres).join(', ')}]`;
    return `{ position: ${list(camera.position)}, target: ${list(camera.target)}, levelId: '${camera.levelId}' }`;
}
