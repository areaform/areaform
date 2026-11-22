// Generates a large exhibition Space for performance checks: a grid of booths with walls
// between rows. Built directly as data (not through Commands) so generation itself is fast.
import type { AreaformDocument, Level, Wall, WallNode, Zone } from '../src/index.ts';
import { createSpace } from '../src/index.ts';

export interface StressOptions {
    booths: number;
    walls: number;
}

export function stressSpace({ booths, walls }: StressOptions): AreaformDocument {
    const perRow = Math.ceil(Math.sqrt(booths));
    const pitch = 4; // 3 m booth + 1 m aisle
    const size = perRow * pitch + 10;
    const doc = createSpace({ name: 'Stress', kind: 'exhibition', size: [size, size] });
    const base = doc.levels[0]!;

    const zones: Zone[] = [];
    for (let i = 0; i < booths; i++) {
        const x = 5 + (i % perRow) * pitch;
        const y = 5 + Math.floor(i / perRow) * pitch;
        zones.push({
            id: `booth-${i}`,
            category: 'booth',
            label: `B-${i}`,
            shape: {
                outer: [
                    [x, y],
                    [x + 3, y],
                    [x + 3, y + 3],
                    [x, y + 3],
                ],
            },
        });
    }

    // Short, non-touching wall segments in rows along the aisles.
    const wallNodes: WallNode[] = [];
    const wallList: Wall[] = [];
    const perWallRow = Math.ceil(walls / perRow);
    for (let i = 0; i < walls; i++) {
        const row = Math.floor(i / perWallRow);
        const col = i % perWallRow;
        const y = 4.5 + (row % perRow) * pitch;
        const x = 5 + col * ((size - 10) / perWallRow);
        wallNodes.push(
            { id: `n-${i}-a`, position: [x, y] },
            { id: `n-${i}-b`, position: [x + 0.5 * ((size - 10) / perWallRow), y] },
        );
        wallList.push({ id: `w-${i}`, a: `n-${i}-a`, b: `n-${i}-b`, thickness: 0.1 });
    }

    const level: Level = { ...base, zones, wallNodes, walls: wallList };
    return { ...doc, levels: [level] };
}
