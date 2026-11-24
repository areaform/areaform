// Here for visitors (ADR-0017): the value a host puts in `?here=` or `data-here`.
import type { Id, Vec2 } from '@areaform/core';

/** `?here=` for a point on a Level: `<levelId>:<x>,<y>`, metres to a tenth. */
export function hereValue(levelId: Id, point: Vec2): string {
    const n = (v: number) => (Math.round(v * 10) / 10 + 0).toString();
    return `${levelId}:${n(point[0])},${n(point[1])}`;
}
