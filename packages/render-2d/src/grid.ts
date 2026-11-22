// Where to draw grid lines for the part of the plan in view, thinned out when zoomed far out.
import type { Box } from './camera.ts';

/** Closest grid lines may get on screen before they are thinned out, px. */
export const MIN_GRID_PX = 8;
/** Every this many lines, one is drawn stronger. */
export const MAJOR_EVERY = 5;

export interface GridLines {
    /** Metres between drawn lines: the grid step, or a multiple of it when zoomed out. */
    spacing: number;
    minor: { xs: number[]; ys: number[] };
    /** Every fifth line (counting from the origin), drawn stronger. */
    major: { xs: number[]; ys: number[] };
}

/** Metres between drawn grid lines: `step`, or 5, 10, 50, … times it when zoomed out. */
export function gridSpacing(step: number, zoom: number): number {
    let spacing = step;
    for (let factor = 5; spacing * zoom < MIN_GRID_PX; factor = factor === 5 ? 2 : 5) {
        spacing *= factor;
    }
    return spacing;
}

/**
 * The vertical (`xs`) and horizontal (`ys`) grid lines inside `box`, at multiples of `step` from
 * the origin, so they match grid snapping. When lines would be closer than `MIN_GRID_PX` apart
 * at `zoom`, only every 5th, 10th, 50th, … is drawn.
 */
export function gridLines(box: Box, step: number, zoom: number): GridLines {
    const none: GridLines = { spacing: 0, minor: { xs: [], ys: [] }, major: { xs: [], ys: [] } };
    if (!(step > 0) || !(zoom > 0)) return none;
    const spacing = gridSpacing(step, zoom);
    const along = (min: number, max: number) => {
        const minor: number[] = [];
        const major: number[] = [];
        for (let k = Math.ceil(min / spacing - 1e-9); k * spacing <= max + 1e-9; k++) {
            const at = Number((k * spacing).toFixed(9));
            (k % MAJOR_EVERY === 0 ? major : minor).push(at);
        }
        return { minor, major };
    };
    const x = along(box.minX, box.maxX);
    const y = along(box.minY, box.maxY);
    return { spacing, minor: { xs: x.minor, ys: y.minor }, major: { xs: x.major, ys: y.major } };
}
