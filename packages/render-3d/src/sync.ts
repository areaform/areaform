import type { Connection, AreaformDocument, Id, Level } from '@areaform/core';

/**
 * Keeps one built thing per shown Level (ADR-0005): it is rebuilt only when that Level object, or
 * the Connections list its Stops come from, is a different object than last time.
 */
export function createLevelSync<T>(
    build: (doc: AreaformDocument, level: Level) => T,
    dispose: (built: T) => void,
) {
    let current: { level: Level; connections: Connection[]; built: T } | null = null;
    return {
        /** The built thing for the Level; `rebuilt` is false when the last one still holds. */
        show(doc: AreaformDocument, levelId: Id): { built: T | null; rebuilt: boolean } {
            const level = doc.levels.find((l) => l.id === levelId);
            if (!level) {
                this.clear();
                return { built: null, rebuilt: true };
            }
            if (current?.level === level && current.connections === doc.connections)
                return { built: current.built, rebuilt: false };
            if (current) dispose(current.built);
            current = { level, connections: doc.connections, built: build(doc, level) };
            return { built: current.built, rebuilt: true };
        },
        clear() {
            if (current) dispose(current.built);
            current = null;
        },
    };
}
