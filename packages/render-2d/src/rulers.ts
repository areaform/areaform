// Which numbers the rulers along the screen's top and left edges show, and where.
import { screenToWorld, worldToScreen, type Camera } from './camera.ts';
import { gridSpacing, MAJOR_EVERY } from './grid.ts';

/** Closest ruler numbers may get on screen, px. */
export const MIN_RULER_PX = 48;
/** Strong grid lines further apart than this get every grid line numbered, px. */
const MAX_RULER_PX = 160;

export interface RulerTick {
    /** Ruler units from the origin, e.g. metres or feet. */
    value: number;
    /** Where on the edge, CSS pixels from the canvas's left (X) or top (Y). */
    at: number;
}

export interface RulerTicks {
    /** Ruler units between ticks. */
    step: number;
    /** Along the top edge, left to right. */
    xs: RulerTick[];
    /** Along the left edge, top to bottom (Y grows upwards, so values fall). */
    ys: RulerTick[];
}

/** The smallest of …, 0.5, 1, 2, 5, 10, 20, … that lands at least `minPx` apart. */
export function roundStep(pxPerUnit: number, minPx = MIN_RULER_PX): number {
    if (!(pxPerUnit > 0)) return 1;
    const wanted = minPx / pxPerUnit;
    const power = 10 ** Math.floor(Math.log10(wanted));
    const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= wanted - 1e-12)!;
    return Number(step.toPrecision(12));
}

/**
 * Ruler units between numbers. In metres (`unit` 1) the strong grid lines are numbered, or every
 * grid line when zoomed in far; any other unit (`0.3048` m for feet) counts in its own round
 * steps, since grid lines fall on odd numbers of it.
 */
export function rulerStep(gridStep: number, zoom: number, unit = 1): number {
    if (unit !== 1 || !(gridStep > 0)) return roundStep(zoom * unit);
    const spacing = gridSpacing(gridStep, zoom);
    const major = spacing * MAJOR_EVERY;
    return major * zoom > MAX_RULER_PX ? spacing : Number(major.toFixed(9));
}

/** The ticks every `step` ruler units (`unit` metres each) that are on screen. */
export function rulerTicks(camera: Camera, step: number, unit = 1): RulerTicks {
    const { width, height } = camera.viewport;
    const [minX, maxY] = screenToWorld(camera, [0, 0]);
    const [maxX, minY] = screenToWorld(camera, [width, height]);
    const along = (min: number, max: number, at: (value: number) => number) => {
        const ticks: RulerTick[] = [];
        if (!(step > 0)) return ticks;
        const size = step * unit;
        for (let k = Math.ceil(min / size - 1e-9); k * size <= max + 1e-9; k++) {
            // `+ 0` turns −0 into 0, so the origin never reads "-0".
            ticks.push({ value: Number((k * step).toFixed(9)) + 0, at: at(k * size) });
        }
        return ticks;
    };
    return {
        step,
        xs: along(minX, maxX, (x) => worldToScreen(camera, [x, 0])[0]),
        ys: along(minY, maxY, (y) => worldToScreen(camera, [0, y])[1]).reverse(),
    };
}
