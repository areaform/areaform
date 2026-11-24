import {
    containsRing,
    holesOverlap,
    type Ring,
    type Shape,
    type Transaction,
    type Vec2,
} from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import { holesValid } from '../interaction/shapeEdit.ts';
import { snapMarker } from './overlayStyles.ts';
import { createShapeTool, type ShapeMode } from './shape.ts';
import type { Tool, ToolContext } from './tool.ts';

const activeHandle = { stroke: '#ff6a00', fill: '#ff6a00', strokeWidth: 1.5 };
const midpointHandle = { stroke: '#2f6fdb', fill: '#ffffff', strokeWidth: 1 };

/** `edit`: drag the handles of every ring. `hole`: draw a new hole, then back to `edit`. */
export type OutlineMode = 'edit' | 'hole';

/** A corner of the Outline: ring 0 is the outer ring, ring i > 0 is hole i − 1. */
interface Corner {
    ring: number;
    index: number;
}

/**
 * Edits the current Level's Outline, holes included: drag a corner handle to move it, drag an
 * edge midpoint to add a corner, click a corner then Delete to remove it (a hole left with three
 * corners is removed whole). Each drag is one undo step. Holes are kept inside the outer ring;
 * a drag that would break that, or make a ring invalid, keeps its last valid shape.
 */
export function createOutlineTool(
    ctx: ToolContext,
    mode: OutlineMode,
    shapeMode: ShapeMode,
    onHoleDone: () => void,
): Tool {
    if (mode === 'hole') {
        return createShapeTool(ctx, shapeMode, (hole) => {
            const outline = ctx.level().outline;
            if (!containsRing({ outer: outline.outer }, hole)) {
                ctx.setMessage('A hole must be inside the Outline.');
                return;
            }
            const next = { outer: outline.outer, holes: [...(outline.holes ?? []), hole] };
            if (holesOverlap(next)) {
                ctx.setMessage(ctx.i18n().t('message.holesOverlap'));
                return;
            }
            setOutline(ctx, next);
            onHoleDone();
        });
    }

    let active: Corner | null = null;
    let drag: { corner: Corner; tx: Transaction } | null = null;

    const rings = (): Ring[] => {
        const { outer, holes = [] } = ctx.level().outline;
        return [outer, ...holes];
    };
    const midpoints = (r: Ring): Vec2[] =>
        r.map((p, i) => {
            const q = r[(i + 1) % r.length]!;
            return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        });
    const nearest = (pointsOf: (r: Ring) => Vec2[], point: Vec2): Corner | null => {
        let best: { corner: Corner; distance: number } | null = null;
        rings().forEach((r, ring) =>
            pointsOf(r).forEach((p, index) => {
                const distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
                if (distance <= ctx.hitTolerance() && (!best || distance < best.distance)) {
                    best = { corner: { ring, index }, distance };
                }
            }),
        );
        return (best as { corner: Corner } | null)?.corner ?? null;
    };
    const withRing = (all: Ring[], ring: number, next: Ring): Shape => {
        const replaced = all.map((r, i) => (i === ring ? next : r));
        const [outer, ...holes] = replaced;
        return { outer: outer!, ...(holes.length > 0 && { holes }) };
    };

    const showHandles = (extra: OverlayItem[] = []) => {
        const overlay: OverlayItem[] = [];
        rings().forEach((r, ring) => {
            r.forEach((position, index) => {
                const isActive = active?.ring === ring && active.index === index;
                overlay.push({
                    type: 'marker',
                    position,
                    kind: 'vertex',
                    style: isActive ? activeHandle : snapMarker,
                });
            });
            for (const position of midpoints(r)) {
                overlay.push({ type: 'marker', position, kind: 'edge', style: midpointHandle });
            }
        });
        ctx.setOverlay([...overlay, ...extra]);
    };
    showHandles();

    return {
        pointerDown({ point }) {
            const tx = ctx.editor.begin();
            let corner = nearest((r) => r, point);
            if (!corner) {
                const edge = nearest(midpoints, point);
                if (!edge) {
                    tx.cancel();
                    active = null;
                    showHandles();
                    return;
                }
                const all = rings();
                const r = all[edge.ring]!;
                const index = edge.index + 1;
                setOutline(
                    ctx,
                    withRing(all, edge.ring, [
                        ...r.slice(0, index),
                        midpoints(r)[edge.index]!,
                        ...r.slice(index),
                    ]),
                    tx,
                );
                corner = { ring: edge.ring, index };
            }
            active = corner;
            drag = { corner, tx };
            showHandles();
        },
        pointerMove(input) {
            if (!drag) return;
            const { ring, index } = drag.corner;
            const all = rings();
            // Snap against the Outline without the dragged corner, so it cannot stick to itself.
            const without = withRing(
                all,
                ring,
                all[ring]!.filter((_, i) => i !== index),
            );
            const target = ctx.snap(input, { level: { ...ctx.level(), outline: without } });
            const next = withRing(
                all,
                ring,
                all[ring]!.map((p, i) => (i === index ? target.point : p)),
            );
            if (holesValid(next)) setOutline(ctx, next, drag.tx);
            showHandles(
                target.kind === 'none'
                    ? []
                    : [
                          {
                              type: 'marker',
                              position: target.point,
                              kind: target.kind,
                              style: snapMarker,
                          },
                      ],
            );
        },
        pointerUp() {
            drag?.tx.commit();
            drag = null;
            showHandles();
        },
        keyDown({ key }) {
            if ((key === 'Delete' || key === 'Backspace') && active !== null) {
                const all = rings();
                const ring = all[active.ring]!;
                let next: Shape;
                if (ring.length > 3) {
                    next = withRing(
                        all,
                        active.ring,
                        ring.filter((_, i) => i !== active!.index),
                    );
                } else if (active.ring > 0) {
                    const [outer, ...holes] = all.filter((_, i) => i !== active!.ring);
                    next = { outer: outer!, ...(holes.length > 0 && { holes }) };
                } else {
                    return false;
                }
                if (setOutline(ctx, next)) {
                    active = null;
                    showHandles();
                }
                return true;
            }
            if (key === 'Escape' && active !== null) {
                active = null;
                showHandles();
                return true;
            }
            return false;
        },
        refresh() {
            if (!drag) showHandles();
        },
        cancel() {
            drag?.tx.cancel();
            drag = null;
            ctx.setOverlay([]);
        },
    };
}

function setOutline(ctx: ToolContext, outline: Shape, tx?: Transaction): boolean {
    return (tx ?? ctx.editor).exec({ type: 'level.setOutline', levelId: ctx.levelId(), outline })
        .ok;
}
