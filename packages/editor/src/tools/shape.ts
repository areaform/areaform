import type { Connection, Ring, Vec2, Zone } from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import type { PointerInput } from '../interaction/controller.ts';
import { previewFill, previewLine, snapMarker } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';
import { startsAccessible } from '../document/connectionDefaults.ts';

/** How the Zone, Obstacle and Connection tools draw: drag a rectangle, or click a polygon. */
export type ShapeMode = 'rectangle' | 'polygon';

/** Draws a closed ring (Q44) and hands it to `complete`. */
export function createShapeTool(
    ctx: ToolContext,
    mode: ShapeMode,
    complete: (ring: Ring) => void,
): Tool {
    return mode === 'rectangle' ? rectangleTool(ctx, complete) : polygonTool(ctx, complete);
}

/** Draws Zones, each given the fields `fields` returns as it is added (category and its flags). */
export function zoneTool(
    ctx: ToolContext,
    mode: ShapeMode,
    fields: () => Pick<Zone, 'category' | 'restricted' | 'walkAround'>,
): Tool {
    return createShapeTool(ctx, mode, (outer) => {
        const id = crypto.randomUUID();
        const levelId = ctx.levelId();
        const result = ctx.editor.exec({
            type: 'zone.add',
            levelId,
            zone: { id, shape: { outer }, ...fields() },
        });
        if (result.ok) ctx.select([{ kind: 'zone', id, levelId }]);
    });
}

export function obstacleTool(ctx: ToolContext, mode: ShapeMode): Tool {
    return createShapeTool(ctx, mode, (outer) => {
        const id = crypto.randomUUID();
        const levelId = ctx.levelId();
        const result = ctx.editor.exec({
            type: 'obstacle.add',
            levelId,
            obstacle: { id, kind: 'column', shape: { outer } },
        });
        if (result.ok) ctx.select([{ kind: 'obstacle', id, levelId }]);
    });
}

/**
 * Draws a Connection's footprint and stops it on this Level and the next one up (or down, from
 * the top Level), with the same footprint (Q38); more Levels are ticked in the properties panel.
 */
export function connectionTool(
    ctx: ToolContext,
    mode: ShapeMode,
    kind: () => Connection['kind'],
): Tool {
    return createShapeTool(ctx, mode, (outer) => {
        const levels = [...ctx.editor.getDocument().levels].sort((a, b) => a.ordinal - b.ordinal);
        const index = levels.findIndex((l) => l.id === ctx.levelId());
        const other = levels[index + 1] ?? levels[index - 1];
        if (!other) {
            ctx.setMessage('A Connection needs at least two Levels — add a Level first.');
            return;
        }
        const id = crypto.randomUUID();
        const levelId = ctx.levelId();
        const shape = { outer };
        const result = ctx.editor.exec({
            type: 'connection.add',
            connection: {
                id,
                kind: kind(),
                stops: [
                    { levelId, shape },
                    { levelId: other.id, shape },
                ],
                bidirectional: kind() !== 'escalator',
                ...(startsAccessible(kind()) && { accessible: true }),
            },
        });
        if (result.ok) ctx.select([{ kind: 'stop', id, levelId }]);
    });
}

function rectangleTool(ctx: ToolContext, complete: (ring: Ring) => void): Tool {
    let start: Vec2 | null = null;

    const rectangle = (a: Vec2, b: Vec2): Ring => {
        const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
        const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
        return [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
        ];
    };
    const reset = () => {
        start = null;
        ctx.setOverlay([]);
    };

    return {
        pointerDown(input) {
            start = ctx.snap(input).point;
        },
        pointerMove(input) {
            const target = ctx.snap(input);
            const overlay: OverlayItem[] = [];
            if (start)
                overlay.push({
                    type: 'polygon',
                    shape: { outer: rectangle(start, target.point) },
                    style: previewFill,
                });
            const m = marker(target);
            if (m) overlay.push(m);
            ctx.setOverlay(overlay);
        },
        pointerUp(input) {
            if (!start) return;
            const ring = rectangle(start, ctx.snap(input).point);
            reset();
            if (ring[1]![0] - ring[0]![0] > 0 && ring[2]![1] - ring[1]![1] > 0) complete(ring);
        },
        keyDown({ key }) {
            if (key !== 'Escape' || !start) return false;
            reset();
            return true;
        },
        cancel: reset,
    };
}

function polygonTool(ctx: ToolContext, complete: (ring: Ring) => void): Tool {
    let points: Vec2[] = [];

    const reset = () => {
        points = [];
        ctx.setOverlay([]);
    };
    const close = () => {
        const ring = points;
        reset();
        complete(ring);
    };
    const snapNext = (input: PointerInput) =>
        ctx.snap(input, points.length > 0 ? { anchor: points.at(-1)! } : {});
    const preview = (input: PointerInput) => {
        const target = snapNext(input);
        const overlay: OverlayItem[] = [];
        if (points.length > 0)
            overlay.push({ type: 'line', points: [...points, target.point], style: previewLine });
        const m = marker(target);
        if (m) overlay.push(m);
        ctx.setOverlay(overlay);
    };

    return {
        pointerDown(input) {
            const target = snapNext(input);
            const first = points[0];
            const closesOnFirst =
                first !== undefined &&
                points.length >= 3 &&
                (distance(target.point, first) < 1e-9 ||
                    distance(input.point, first) <= ctx.tolerance());
            if (closesOnFirst) return close();
            points = [...points, target.point];
            preview(input);
        },
        pointerMove: preview,
        pointerUp() {},
        keyDown({ key }) {
            if (key === 'Enter' && points.length >= 3) {
                close();
                return true;
            }
            if (key === 'Escape' && points.length > 0) {
                reset();
                return true;
            }
            return false;
        },
        cancel: reset,
    };
}

function marker(target: ReturnType<ToolContext['snap']>): OverlayItem | null {
    return target.kind === 'none'
        ? null
        : { type: 'marker', position: target.point, kind: target.kind, style: snapMarker };
}

function distance(p: Vec2, q: Vec2): number {
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
}
