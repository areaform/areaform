import type { Vec2 } from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import { segmentLabel } from '../dimensions.ts';
import { formatLength } from '../units.ts';
import { previewLine, snapMarker } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';

/**
 * Measures the distance between two snapped points by dragging. The measurement stays on screen
 * until the next one or Escape; it never touches the Document.
 */
export function createRulerTool(ctx: ToolContext): Tool {
    let start: Vec2 | null = null;
    let measured = false;
    /** The finished measurement, redrawn when the display units change. */
    let last: [Vec2, Vec2] | null = null;

    const show = (a: Vec2, b: Vec2, marker?: OverlayItem) => {
        const overlay: OverlayItem[] = [
            { type: 'line', points: [a, b], style: previewLine },
            { type: 'marker', position: a, kind: 'vertex', style: snapMarker },
            segmentLabel(
                a,
                b,
                formatLength(Math.hypot(b[0] - a[0], b[1] - a[1]), ctx.units(), ctx.i18n()),
                ctx.zoom(),
            ),
        ];
        if (marker) overlay.push(marker);
        ctx.setOverlay(overlay);
    };

    return {
        pointerDown(input) {
            start = ctx.snap(input).point;
            measured = false;
            show(start, start);
        },
        pointerMove(input) {
            if (!start) return;
            const target = ctx.snap(input);
            show(
                start,
                target.point,
                target.kind === 'none'
                    ? undefined
                    : {
                          type: 'marker',
                          position: target.point,
                          kind: target.kind,
                          style: snapMarker,
                      },
            );
        },
        pointerUp(input) {
            if (!start) return;
            last = [start, ctx.snap(input).point];
            show(...last);
            start = null;
            measured = true;
        },
        keyDown({ key }) {
            if (key !== 'Escape' || (!measured && !start)) return false;
            start = null;
            measured = false;
            ctx.setOverlay([]);
            return true;
        },
        refresh() {
            if (measured && last) show(...last);
        },
        cancel() {
            start = null;
            measured = false;
            ctx.setOverlay([]);
        },
    };
}
