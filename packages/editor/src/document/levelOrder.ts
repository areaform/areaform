// Ordering Levels in the Levels list: highest first, and what a drag-and-drop means as moves.
import type { AreaformDocument, Id, Level } from '@areaform/core';

/** Levels from the highest down, as a building section reads. */
export function levelsTopDown(levels: Level[]): Level[] {
    return [...levels].sort((a, b) => b.ordinal - a.ordinal);
}

/**
 * The `level.move` steps that put `levelId` just above or below `targetId`, within its Level
 * Group. Null when the drop changes nothing or the target is in another group.
 */
export function levelDropMove(
    doc: AreaformDocument,
    levelId: Id,
    targetId: Id,
    place: 'above' | 'below',
): { direction: 'up' | 'down'; steps: number } | null {
    const level = doc.levels.find((l) => l.id === levelId);
    const target = doc.levels.find((l) => l.id === targetId);
    if (!level || !target || level === target || level.group !== target.group) return null;
    // Bottom to top, so a higher index is higher up.
    const stack = [...doc.levels.filter((l) => l.group === level.group)].sort(
        (a, b) => a.ordinal - b.ordinal,
    );
    const from = stack.indexOf(level);
    const at = stack.indexOf(target);
    // Where the Level ends up once it is taken out and put back next to the target.
    const to = place === 'above' ? (at > from ? at : at + 1) : at < from ? at : at - 1;
    const steps = to - from;
    if (steps === 0) return null;
    return { direction: steps > 0 ? 'up' : 'down', steps: Math.abs(steps) };
}
