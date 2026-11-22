import type { Id, Level, Vec2, Wall } from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import { previewFill, previewLine } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';

const DOOR_WIDTH = 0.9;
/** Segments in the previewed swing arc. */
const SWING_STEPS = 12;

interface Placement {
    wall: Wall;
    /** Metres from the Wall's `a` node to the door's centre, kept clear of both ends. */
    offset: number;
    center: Vec2;
    angle: number;
    /** The side of the Wall the pointer is on, which the door opens to. */
    swing: 'left' | 'right';
}

/** Places hosted doors on Walls: hover previews, click adds and selects. */
export function createDoorTool(ctx: ToolContext): Tool {
    const placementAt = (point: Vec2): Placement | null => {
        const level = ctx.level();
        const tolerance = ctx.tolerance();
        let best: { placement: Placement; distance: number } | null = null;
        for (const wall of level.walls) {
            const ends = wallEnds(level, wall);
            if (!ends) continue;
            const [a, b] = ends;
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (length < DOOR_WIDTH) continue;
            const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const along = (point[0] - a[0]) * Math.cos(angle) + (point[1] - a[1]) * Math.sin(angle);
            const signed =
                -(point[0] - a[0]) * Math.sin(angle) + (point[1] - a[1]) * Math.cos(angle);
            const across = Math.abs(signed);
            if (along < 0 || along > length || across > wall.thickness / 2 + tolerance) continue;
            if (best && across >= best.distance) continue;
            const swing = signed >= 0 ? 'left' : 'right';
            const offset = Math.min(length - DOOR_WIDTH / 2, Math.max(DOOR_WIDTH / 2, along));
            const center: Vec2 = [a[0] + Math.cos(angle) * offset, a[1] + Math.sin(angle) * offset];
            best = { placement: { wall, offset, center, angle, swing }, distance: across };
        }
        return best?.placement ?? null;
    };

    /** The gap across the Wall, and the leaf with its swing on the side it will open to. */
    const ghost = (p: Placement): OverlayItem[] => {
        const cos = Math.cos(p.angle);
        const sin = Math.sin(p.angle);
        const hw = DOOR_WIDTH / 2;
        const hd = p.wall.thickness / 2 + 0.05;
        const corner = (u: number, v: number): Vec2 => [
            p.center[0] + u * cos - v * sin,
            p.center[1] + u * sin + v * cos,
        ];
        const side = p.swing === 'left' ? 1 : -1;
        const face = (side * p.wall.thickness) / 2;
        const arc = Array.from({ length: SWING_STEPS + 1 }, (_, i) => {
            const t = ((i / SWING_STEPS) * Math.PI) / 2;
            return corner(-hw + DOOR_WIDTH * Math.sin(t), face + side * DOOR_WIDTH * Math.cos(t));
        });
        return [
            {
                type: 'polygon',
                shape: {
                    outer: [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)],
                },
                style: previewFill,
            },
            { type: 'line', points: [corner(-hw, face), ...arc], style: previewLine },
        ];
    };

    return {
        pointerDown() {},
        pointerMove(input) {
            const placement = placementAt(input.point);
            ctx.setOverlay(placement ? ghost(placement) : []);
        },
        pointerUp(input) {
            const placement = placementAt(input.point);
            if (!placement) return;
            const id: Id = crypto.randomUUID();
            const levelId = ctx.levelId();
            const result = ctx.editor.exec({
                type: 'opening.add',
                levelId,
                opening: {
                    id,
                    kind: 'door',
                    width: DOOR_WIDTH,
                    host: 'wall',
                    wallId: placement.wall.id,
                    offset: placement.offset,
                    ...(placement.swing === 'right' && { swing: 'right' }),
                },
            });
            if (result.ok) ctx.select([{ kind: 'opening', id, levelId }]);
        },
        keyDown: () => false,
        cancel() {
            ctx.setOverlay([]);
        },
    };
}

function wallEnds(level: Level, wall: Wall): [Vec2, Vec2] | null {
    const a = level.wallNodes.find((n) => n.id === wall.a)?.position;
    const b = level.wallNodes.find((n) => n.id === wall.b)?.position;
    return a && b ? [a, b] : null;
}
