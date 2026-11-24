import type { Transaction, Vec2 } from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import type { PointerInput } from '../interaction/controller.ts';
import type { SnapResult } from '../interaction/snap.ts';
import { segmentLabel } from '../interaction/dimensions.ts';
import { formatLength, parseLength, unitLabel } from '../interaction/units.ts';
import { previewLine, snapMarker } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';

/**
 * Click-to-click Wall chains (Q43). Each click adds a Wall inside one transaction, so the chain
 * is a single undo step. It ends on Esc / Enter, a second click on the same point, or a click on
 * an existing Wall Node (closing a room or joining other walls).
 *
 * After the first click, typing a number (`4.5`, or `4,5`) and pressing Enter places the next
 * corner that far towards the pointer (metres; in imperial units feet, or `10'6"`); Backspace edits the number, Esc clears it.
 */
export function createWallTool(ctx: ToolContext): Tool {
    let tx: Transaction | null = null;
    let last: Vec2 | null = null;
    let added = 0;
    /** The pointer's latest snapped position, previewed while no length is typed. */
    let cursor: SnapResult | null = null;
    /** The raw pointer, for the direction of a typed length. */
    let pointer: PointerInput | null = null;
    let typed = '';

    const finish = () => {
        if (tx) {
            if (added > 0) tx.commit();
            else tx.cancel();
        }
        tx = null;
        last = null;
        added = 0;
        typed = '';
        ctx.setOverlay([]);
    };

    /** The corner a typed length points at, or null without a usable length or direction. */
    const typedPoint = (): Vec2 | null => {
        const length = parseLength(typed, ctx.units()) ?? Number.NaN;
        if (!last || !pointer || !(length > 0)) return null;
        // Grid points would skew the direction from an off-grid corner; snap to 15° angles (and
        // Wall Nodes, vertices and edges) instead.
        const toward = ctx.snap(pointer, { anchor: last, grid: { step: 0, snap: false } }).point;
        const [dx, dy] = [toward[0] - last[0], toward[1] - last[1]];
        const distance = Math.hypot(dx, dy);
        if (distance === 0) return null;
        const round = (v: number) => Number(v.toFixed(9));
        return [
            round(last[0] + (dx / distance) * length),
            round(last[1] + (dy / distance) * length),
        ];
    };

    const preview = (target: SnapResult) => {
        const overlay: OverlayItem[] = [];
        const end = typed ? typedPoint() : null;
        if (last && typed) {
            const towards = end ?? target.point;
            if (end) overlay.push({ type: 'line', points: [last, end], style: previewLine });
            const text = /['"]/.test(typed)
                ? typed
                : `${typed} ${unitLabel(ctx.units(), ctx.i18n())}`;
            overlay.push(segmentLabel(last, towards, text, ctx.zoom()));
        } else if (last) {
            overlay.push({ type: 'line', points: [last, target.point], style: previewLine });
            const length = Math.hypot(target.point[0] - last[0], target.point[1] - last[1]);
            if (length > 0)
                overlay.push(
                    segmentLabel(
                        last,
                        target.point,
                        formatLength(length, ctx.units(), ctx.i18n()),
                        ctx.zoom(),
                    ),
                );
        }
        if (target.kind !== 'none' && !typed) {
            overlay.push({
                type: 'marker',
                position: target.point,
                kind: target.kind,
                style: snapMarker,
            });
        }
        ctx.setOverlay(overlay);
    };

    const snapFor = (input: { point: Vec2; alt?: boolean }) =>
        ctx.snap(input, last ? { anchor: last } : {});

    /** Adds a Wall from the last corner to `point` and carries the chain on from there. */
    const addTo = (point: Vec2) => {
        const result = tx!.exec({
            type: 'wall.add',
            levelId: ctx.levelId(),
            a: last!,
            b: point,
            thickness: ctx.options.wallThickness,
        });
        if (result.ok) added++;
        last = point;
    };

    return {
        pointerDown(input) {
            const target = snapFor(input);
            cursor = target;
            pointer = input;
            if (!last) {
                tx = ctx.editor.begin();
                last = target.point;
                preview(target);
                return;
            }
            if (samePoint(target.point, last)) return finish();

            typed = '';
            addTo(target.point);
            if (target.kind === 'node') return finish();
            preview(target);
        },
        pointerMove(input) {
            pointer = input;
            cursor = snapFor(input);
            preview(cursor);
        },
        pointerUp() {},
        keyDown({ key }) {
            if (!last) return false;
            const feetOrInches =
                ctx.units() === 'imperial' && (key === "'" || key === '"') && !typed.includes(key);
            if (
                /^[0-9]$/.test(key) ||
                feetOrInches ||
                ((key === '.' || key === ',') && !typed.includes('.'))
            ) {
                typed += key === ',' ? '.' : key;
            } else if (key === 'Backspace' && typed) {
                typed = typed.slice(0, -1);
            } else if (key === 'Escape' && typed) {
                typed = '';
            } else if (key === 'Enter' && typed) {
                const end = typedPoint();
                typed = '';
                if (end) addTo(end);
            } else if (key === 'Escape' || key === 'Enter') {
                finish();
                return true;
            } else {
                return false;
            }
            if (cursor) preview(cursor);
            return true;
        },
        cancel: finish,
    };
}

function samePoint(p: Vec2, q: Vec2): boolean {
    return Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
}
