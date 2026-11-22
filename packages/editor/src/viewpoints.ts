// The Editor's side of Viewpoints (ADR-0025): where each one's camera stands, drawn on the 2D plan
// as a numbered mark with a wedge towards what it looks at, so the tour can be checked from above.
import { viewpointSpot, type Level, type Vec2 } from '@areaform/core';
import type { OverlayItem, Style } from '@areaform/render-2d';

const RAD = Math.PI / 180;
/** Half the wedge's opening, degrees: about half a camera's view across. */
const WEDGE_HALF_ANGLE = 25;

const LINE: Style = { stroke: '#1f6fc9', strokeWidth: 1.5, opacity: 0.7 };
const WEDGE: Style = { fill: '#1f6fc9', opacity: 0.35, stroke: '#1f6fc9', strokeWidth: 1 };

/**
 * The overlay for a Level's Viewpoints: for each, a line from its camera to its target, a wedge
 * opening from the camera along its bearing, and its number in the tour. `size` is the wedge's
 * length in metres.
 */
export function viewpointMarks(level: Level, size: number): OverlayItem[] {
    return (level.viewpoints ?? []).flatMap((viewpoint, i): OverlayItem[] => {
        const spot = viewpointSpot(viewpoint);
        const side = (turn: number): Vec2 => {
            const angle = (viewpoint.bearing + turn) * RAD;
            return [spot[0] + size * Math.sin(angle), spot[1] + size * Math.cos(angle)];
        };
        return [
            { type: 'line', points: [spot, viewpoint.target], style: LINE },
            {
                type: 'polygon',
                shape: { outer: [spot, side(WEDGE_HALF_ANGLE), side(-WEDGE_HALF_ANGLE)].reverse() },
                style: WEDGE,
            },
            { type: 'label', position: spot, text: String(i + 1) },
        ];
    });
}

/** "Viewpoint 3" for the third, in the interface's words. */
export function nextViewpointName(level: Level, name: (number: number) => string): string {
    return name((level.viewpoints?.length ?? 0) + 1);
}
