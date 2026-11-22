import type { Id, Vec2 } from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import { previewLine, snapMarker } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';

/**
 * Two clicks mark two points on an Underlay (unsnapped: they follow the image, not the plan);
 * the controller then asks for the real distance between them.
 */
export function createCalibrateTool(ctx: ToolContext, underlayId: Id): Tool {
    let points: Vec2[] = [];

    const show = (pointer?: Vec2) => {
        const overlay: OverlayItem[] = points.map((position) => ({
            type: 'marker',
            position,
            kind: 'vertex',
            style: snapMarker,
        }));
        const line =
            pointer && points.length === 1
                ? [points[0]!, pointer]
                : points.length === 2
                  ? points
                  : null;
        if (line) overlay.push({ type: 'line', points: line, style: previewLine });
        ctx.setOverlay(overlay);
    };

    return {
        pointerDown({ point }) {
            if (points.length >= 2) return;
            points = [...points, point];
            ctx.setCalibration({ underlayId, points });
            show();
        },
        pointerMove({ point }) {
            show(point);
        },
        pointerUp() {},
        keyDown({ key }) {
            if (key !== 'Escape') return false;
            ctx.endTool();
            return true;
        },
        cancel() {
            points = [];
            ctx.setCalibration(null);
            ctx.setOverlay([]);
        },
    };
}
