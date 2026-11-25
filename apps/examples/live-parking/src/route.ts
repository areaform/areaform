// The trip drawn over the plan: the drive from the gate as a solid line, the walk to the lift as a
// dashed one, each on its own Level. Over the 2D plan they are SVG paths; in 3D, lines on the floor.
// A View Plugin, because a Plugin is given a layer over the plan to draw in; the View's own
// Wayfinding Plugin draws its routes the same way, with a place card and directions around them.
import type { Id, Vec2 } from '@areaform/core';
import type { FloorLine } from '@areaform/render-3d';
import type { View, ViewPlugin } from '@areaform/view';

/** A line on one Level. */
export interface Path {
    levelId: Id;
    points: Vec2[];
}

export interface Drawn {
    /** The drive, one Path per Level it crosses. */
    drive: Path[];
    walk: Path;
}

const SVG = 'http://www.w3.org/2000/svg';
const DRIVE = { color: '#1f6feb', width: 5 };
const WALK = { color: '#0f7b4a', width: 4 };
const CASING = { color: '#ffffff', width: 9 };

export function routeLayer(): { plugin: ViewPlugin; show(drawn: Drawn | null): void } {
    let drawn: Drawn | null = null;
    let redraw = () => {};

    const plugin: ViewPlugin = ({ view, overlay }) => {
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'trip');
        svg.setAttribute('aria-hidden', 'true');
        const drive = document.createElementNS(SVG, 'path');
        drive.setAttribute('class', 'trip__drive');
        const walk = document.createElementNS(SVG, 'path');
        walk.setAttribute('class', 'trip__walk');
        svg.append(drive, walk);
        overlay.append(svg);

        redraw = () => {
            const here = (path: Path) => path.levelId === view.getLevelId();
            const drives = drawn?.drive.filter(here) ?? [];
            const walks = drawn && here(drawn.walk) ? [drawn.walk] : [];
            const flat = view.getView() === '2d';
            drive.setAttribute('d', flat ? drives.map((p) => pathOf(view, p)).join('') : '');
            walk.setAttribute('d', flat ? walks.map((p) => pathOf(view, p)).join('') : '');
            const lines: FloorLine[] = [
                ...(drawn?.drive ?? []).map((p) => ({ ...p, ...DRIVE, casing: CASING })),
                ...(drawn
                    ? [{ ...drawn.walk, ...WALK, dash: [0.8, 0.5] as [number, number] }]
                    : []),
            ];
            // In 3D each line is drawn only while its Level is shown.
            view.renderer3d()?.setLines(lines);
        };

        const off = [
            view.on('camera2dChange', () => redraw()),
            view.on('levelChange', () => redraw()),
            view.on('viewChange', () => redraw()),
            view.on('ready3d', () => redraw()),
        ];
        redraw();
        return () => {
            off.forEach((unsubscribe) => unsubscribe());
            svg.remove();
        };
    };

    return {
        plugin,
        show(next) {
            drawn = next;
            redraw();
        },
    };
}

/** A Path in screen pixels; empty until the plan is on screen. */
function pathOf(view: View, path: Path): string {
    const screen = path.points.map((p) => view.toScreen(p));
    if (screen.length < 2 || screen.some((p) => p === null)) return '';
    return screen.map((p, i) => `${i ? 'L' : 'M'}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join('');
}
