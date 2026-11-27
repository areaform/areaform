import type { Vec2 } from '@areaform/core';
import { isInside } from '@areaform/wayfinding/place';
import { snapMarker } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';

/** Here is given to a tenth of a metre: finer than anyone stands, short enough for a QR code. */
const round = (v: number) => Math.round(v * 10) / 10 + 0;

/**
 * A click marks Here for visitors (ADR-0017), snapped like other tools; another click moves it.
 * Visitors stand inside the building: a click outside the Level's Outline marks nothing and says
 * so. The controller shows the value for `?here=` until Esc or another tool. Picked for a page
 * that moves the camera (ADR-0030), any point will do: a camera may turn to the car park outside.
 */
export function createHereTool(ctx: ToolContext): Tool {
    let marked: Vec2 | null = null;
    const show = (pointer?: Vec2) => {
        const points = [marked, pointer].filter((p): p is Vec2 => p !== undefined && p !== null);
        ctx.setOverlay(
            points.map((position) => ({
                type: 'marker',
                position,
                kind: 'vertex',
                style: snapMarker,
            })),
        );
    };
    return {
        pointerDown(input) {
            const { point } = ctx.snap(input);
            const at: Vec2 = [round(point[0]), round(point[1])];
            const purpose = ctx.herePick()?.for ?? 'visitors';
            const inside = isInside(ctx.editor.getDocument(), {
                levelId: ctx.levelId(),
                point: at,
            });
            if (purpose === 'visitors' && !inside) {
                ctx.setMessage(ctx.i18n().t('here.outside'));
                return;
            }
            marked = at;
            ctx.setHerePick({ point: marked, for: purpose });
            show();
        },
        pointerMove(input) {
            show(ctx.snap(input).point);
        },
        pointerUp() {},
        keyDown({ key }) {
            if (key !== 'Escape') return false;
            ctx.endTool();
            return true;
        },
        cancel() {
            marked = null;
            ctx.setHerePick(null);
            ctx.setOverlay([]);
        },
    };
}
