import { underlayCorners, underlayToWorld } from '@areaform/core';
import type {
    ElementRef,
    AreaformDocument,
    Level,
    Shape,
    Transaction,
    Underlay,
    Vec2,
} from '@areaform/core';
import type { OverlayItem } from '@areaform/render-2d';
import { hitTest, zoneLabelBoxes } from '@areaform/render-2d';
import type { PointerInput } from '../interaction/controller.ts';
import type { SnapResult } from '../interaction/snap.ts';
import { boxesOverlap, dimensionLabels, overlayLabelBox } from '../interaction/dimensions.ts';
import { formatSize } from '../interaction/units.ts';
import {
    flipDoorCommands,
    moveCommand,
    refsInBox,
    wallAt,
    rotateCommand,
    sameRef,
    selectionPoints,
} from '../interaction/elements.ts';
import {
    dragRectangleCorner,
    dragRectangleSide,
    holesValid,
    insertCorner,
    isShaped,
    midpoints,
    moveCorner,
    rectangleSides,
    removeCorner,
    reshapeCommand,
    ringsOf,
    shapeOf,
    withRing,
    type Corner,
    type ShapedRef,
} from '../interaction/shapeEdit.ts';
import { previewFill, previewLine, snapMarker } from './overlayStyles.ts';
import type { Tool, ToolContext } from './tool.ts';

type Gesture =
    | { kind: 'pending'; start: Vec2; hit: ElementRef | null; wasSelected: boolean; shift: boolean }
    | {
          kind: 'move';
          start: Vec2;
          tx: Transaction;
          applied: Vec2;
          node: ElementRef | null;
          /** Where a dragged Wall Node last snapped to. */
          target?: SnapResult;
      }
    | { kind: 'box'; start: Vec2 }
    | { kind: 'rotate'; pivot: Vec2; startAngle: number; tx: Transaction; applied: number }
    | {
          kind: 'reshape';
          ref: ShapedRef;
          /** The shape when the drag began; every step is worked out from it. */
          start: Shape;
          handle: { type: 'corner'; corner: Corner } | { type: 'side'; ring: number; edge: number };
          tx: Transaction;
      }
    | {
          kind: 'scale';
          /** The Underlay when the drag began; every step is worked out from it. */
          start: Underlay;
          /** Which corner, counter-clockwise from the image's bottom-left, as `underlayCorners`. */
          corner: number;
          tx: Transaction;
      };

/** How far (screen px) the pointer must travel before a press becomes a drag. */
const DRAG_PX = 3;
/** Distance of the rotation handle above the selection frame, screen px. */
const HANDLE_PX = 24;
const ROTATE_STEP = Math.PI / 12; // 15°
/** Edges shorter than this on screen (px) show no midpoint handle. */
const MIDPOINT_MIN_PX = 24;
/** The smallest an Underlay is resized to: its longer side, metres. */
const UNDERLAY_MIN_SIDE = 1;
/** How far (screen px) the size label sits below the pointer while an Underlay is resized. */
const SIZE_LABEL_PX = 20;

const activeHandle = { stroke: '#ff6a00', fill: '#ff6a00', strokeWidth: 1.5 };
const midpointHandle = { stroke: '#2f6fdb', fill: '#ffffff', strokeWidth: 1 };

/**
 * Click / Shift-click selection, drag to move (one undo step), drag on empty space to box-select.
 * The selection is framed with a rotation handle; R / Shift+R turn it a quarter (Q37).
 *
 * A lone Zone, Obstacle or Stop also shows a handle on every corner and side. Dragging a corner of
 * a rectangle keeps it square (Shift moves just that corner); dragging a side of a rectangle moves
 * the side (Shift adds a corner there). On other shapes a corner moves alone and a side handle
 * adds a corner. A clicked corner is highlighted, and Delete removes it.
 *
 * A lone Wall shows a handle on each end, and a lone Wall Node (an end picked, or a corner where
 * Walls meet) one in the highlight colour; pressing an end picks its node, and dragging it moves
 * every Wall joined there.
 *
 * A lone unlocked Underlay shows a handle on each corner: dragging one resizes the image, keeping
 * its proportions and the opposite corner in place (Alt: the centre), never below 1 m on its
 * longer side. Esc during any drag puts things back as they were.
 */
export function createSelectTool(ctx: ToolContext): Tool {
    let gesture: Gesture | null = null;
    /** The highlighted corner, of the element selected when it was clicked. */
    let active: { ref: ShapedRef; corner: Corner } | null = null;
    /**
     * The pivot of the last quarter turn, reused while nothing else has changed, so that R and
     * Shift+R undo each other and repeated turns do not drift from a grid-snapped pivot.
     */
    let lastTurn: { doc: AreaformDocument; selection: ElementRef[]; pivot: Vec2 } | null = null;

    const bounds = () => {
        const points = selectionPoints(ctx.editor.getDocument(), ctx.levelId(), ctx.selection());
        if (points.length === 0) return null;
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        return {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
        };
    };
    const center = (b: NonNullable<ReturnType<typeof bounds>>): Vec2 => [
        (b.minX + b.maxX) / 2,
        (b.minY + b.maxY) / 2,
    ];
    /** Selection dimensions shown with the frame (unless always-on dimensions cover them). */
    const selectionLabels = () =>
        ctx.dimensionsOn()
            ? []
            : dimensionLabels(
                  ctx.editor.getDocument(),
                  ctx.levelId(),
                  ctx.selection(),
                  ctx.zoom(),
                  ctx.units(),
                  ctx.i18n(),
              );
    /**
     * The rotation handle and the point on the frame it hangs from: above the frame, or the first
     * of right, left and below that covers no Zone name or selection dimension.
     */
    const handlePosition = (b: NonNullable<ReturnType<typeof bounds>>): [Vec2, Vec2] => {
        const zoom = ctx.zoom();
        const gap = HANDLE_PX / zoom;
        const [cx, cy] = center(b);
        const sides: [Vec2, Vec2][] = [
            [
                [cx, b.maxY + gap],
                [cx, b.maxY],
            ],
            [
                [b.maxX + gap, cy],
                [b.maxX, cy],
            ],
            [
                [b.minX - gap, cy],
                [b.minX, cy],
            ],
            [
                [cx, b.minY - gap],
                [cx, b.minY],
            ],
        ];
        const taken = [
            ...zoneLabelBoxes(ctx.level(), zoom, ctx.theme(), undefined, ctx.labelResolver()),
            ...selectionLabels().flatMap((l) =>
                l.type === 'label' ? [overlayLabelBox(l, zoom)] : [],
            ),
        ];
        const r = ctx.hitTolerance() * 1.5;
        const free = sides.find(([[x, y]]) => {
            const footprint = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
            return !taken.some((box) => boxesOverlap(footprint, box));
        });
        return (free ?? sides[0])!;
    };

    /** The lone selected element whose shape can be edited, and that shape. */
    const editable = (): { ref: ShapedRef; shape: Shape } | null => {
        const selection = ctx.selection();
        const ref = selection.length === 1 ? selection[0]! : null;
        if (!ref || !isShaped(ref)) return null;
        const shaped = { kind: ref.kind, id: ref.id, levelId: ref.levelId } as ShapedRef;
        const shape = shapeOf(ctx.editor.getDocument(), shaped);
        return shape ? { ref: shaped, shape } : null;
    };
    /** The lone selected Underlay that can be resized (unlocked, of known size), and its corners. */
    const resizable = () => {
        const selection = ctx.selection();
        const ref = selection.length === 1 ? selection[0]! : null;
        if (ref?.kind !== 'underlay') return null;
        const underlay = ctx.level().underlays.find((u) => u.id === ref.id);
        const corners = underlay && !underlay.locked ? underlayCorners(underlay) : undefined;
        return underlay && corners ? { underlay, corners } : null;
    };
    /** The ends to show: both of a lone Wall, or a lone Wall Node itself (highlighted). */
    const wallEnds = (): { id: string; position: Vec2; picked: boolean }[] => {
        const selection = ctx.selection();
        const ref = selection.length === 1 ? selection[0]! : null;
        const level = ctx.level();
        const node = (id: string, picked: boolean) => {
            const found = level.wallNodes.find((n) => n.id === id);
            return found ? [{ id, position: found.position, picked }] : [];
        };
        if (ref?.kind === 'wallNode') return node(ref.id, true);
        if (ref?.kind !== 'wall') return [];
        const wall = level.walls.find((w) => w.id === ref.id);
        return wall ? [...node(wall.a, false), ...node(wall.b, false)] : [];
    };
    const wallEndHandles = (): OverlayItem[] =>
        wallEnds().map(({ position, picked }) => ({
            type: 'marker',
            position,
            kind: 'vertex',
            style: picked ? activeHandle : snapMarker,
        }));
    const wallEndAt = (point: Vec2) =>
        wallEnds().some(
            ({ position }) =>
                Math.hypot(position[0] - point[0], position[1] - point[1]) <= ctx.hitTolerance(),
        );
    const underlayHandles = (): OverlayItem[] =>
        (resizable()?.corners ?? []).map((position) => ({
            type: 'marker',
            position,
            kind: 'vertex',
            style: snapMarker,
        }));
    /** The resizable Underlay's corner under `point`, the nearest within reach. */
    const underlayCornerAt = (point: Vec2) => {
        const target = resizable();
        if (!target) return null;
        const reach = target.corners
            .map((p, corner) => ({
                corner,
                distance: Math.hypot(p[0] - point[0], p[1] - point[1]),
            }))
            .filter(({ distance }) => distance <= ctx.hitTolerance())
            .sort((a, b) => a.distance - b.distance)[0];
        return reach
            ? { underlay: target.underlay, corner: reach.corner, corners: target.corners }
            : null;
    };
    /** A diagonal resize cursor along the line from the image's centre to its corner, on screen. */
    const resizeCursor = (corners: Vec2[], corner: number) => {
        const [cx, cy] = [
            (corners[0]![0] + corners[2]![0]) / 2,
            (corners[0]![1] + corners[2]![1]) / 2,
        ];
        const [dx, dy] = [corners[corner]![0] - cx, corners[corner]![1] - cy];
        // Plan Y goes up and screen Y down: up-right on screen is +x, +y here.
        return dx * dy > 0 ? 'nesw-resize' : 'nwse-resize';
    };
    const scaleTo = (scale: Extract<Gesture, { kind: 'scale' }>, input: PointerInput) => {
        const { start, corner, tx } = scale;
        const [w, h] = start.size!;
        const pixels: Vec2[] = [
            [0, h],
            [w, h],
            [w, 0],
            [0, 0],
        ];
        const fixed: Vec2 = input.alt ? [w / 2, h / 2] : pixels[(corner + 2) % 4]!;
        const anchor = underlayToWorld(start, fixed);
        const from = underlayToWorld(start, pixels[corner]!);
        // Only the pointer's progress along the diagonal counts, so the proportions hold.
        const d: Vec2 = [from[0] - anchor[0], from[1] - anchor[1]];
        const along =
            ((input.point[0] - anchor[0]) * d[0] + (input.point[1] - anchor[1]) * d[1]) /
            (d[0] * d[0] + d[1] * d[1]);
        const factor = Math.max(along, UNDERLAY_MIN_SIDE / (Math.max(w, h) * start.scale));
        const next = start.scale * factor;
        // The image's top-left pixel, placed so that the fixed point stays where it was.
        const [x, y] = [fixed[0] * next, -fixed[1] * next];
        const [cos, sin] = [Math.cos(start.rotation), Math.sin(start.rotation)];
        const position: Vec2 = [anchor[0] - (x * cos - y * sin), anchor[1] - (x * sin + y * cos)];
        tx.exec({
            type: 'underlay.update',
            levelId: ctx.levelId(),
            underlayId: start.id,
            changes: { scale: next, position },
        });
        ctx.setOverlay([
            ...frame(),
            {
                type: 'label',
                position: [input.point[0], input.point[1] - SIZE_LABEL_PX / ctx.zoom()],
                text: formatSize(w * next, h * next, ctx.units(), ctx.i18n()),
            },
        ]);
    };

    const activeCorner = (ref: ShapedRef) =>
        active && sameRef(active.ref, ref) ? active.corner : null;
    /** The side handles worth showing: on edges long enough on screen. */
    const sideHandles = (shape: Shape) =>
        ringsOf(shape).flatMap((ring, r) =>
            midpoints(ring).flatMap((position, edge) => {
                const [p, q] = [ring[edge]!, ring[(edge + 1) % ring.length]!];
                const long = Math.hypot(q[0] - p[0], q[1] - p[1]) * ctx.zoom() >= MIDPOINT_MIN_PX;
                return long ? [{ ring: r, edge, position }] : [];
            }),
        );
    const shapeHandles = (): OverlayItem[] => {
        const target = editable();
        if (!target) return [];
        const highlighted = activeCorner(target.ref);
        return [
            ...ringsOf(target.shape).flatMap((ring, r) =>
                ring.map((position, index): OverlayItem => ({
                    type: 'marker',
                    position,
                    kind: 'vertex',
                    style:
                        highlighted?.ring === r && highlighted.index === index
                            ? activeHandle
                            : snapMarker,
                })),
            ),
            ...sideHandles(target.shape).map(({ position }): OverlayItem => ({
                type: 'marker',
                position,
                kind: 'edge',
                style: midpointHandle,
            })),
        ];
    };
    /** The corner, else the side handle, of the editable element under `point`. */
    const handleAt = (point: Vec2) => {
        const target = editable();
        if (!target) return null;
        const near = (p: Vec2) => Math.hypot(p[0] - point[0], p[1] - point[1]);
        let corner: { corner: Corner; distance: number } | null = null;
        ringsOf(target.shape).forEach((ring, r) =>
            ring.forEach((p, index) => {
                const distance = near(p);
                if (distance <= ctx.hitTolerance() && (!corner || distance < corner.distance))
                    corner = { corner: { ring: r, index }, distance };
            }),
        );
        if (corner) return { ...target, corner: (corner as { corner: Corner }).corner };
        const side = sideHandles(target.shape)
            .filter((h) => near(h.position) <= ctx.hitTolerance())
            .sort((a, b) => near(a.position) - near(b.position))[0];
        return side ? { ...target, side } : null;
    };

    /**
     * The Level to snap a reshape against: without the dragged corner, or without the whole
     * element while a side moves, so the shape cannot stick to itself.
     */
    const snapLevel = (ref: ShapedRef, shape: Shape | null): Level => {
        const level = ctx.level();
        if (ref.kind === 'stop') return level;
        const list = ref.kind === 'zone' ? 'zones' : 'obstacles';
        const others = (level[list] as { id: string; shape: Shape }[]).filter(
            (e) => e.id !== ref.id,
        );
        const own = (level[list] as { id: string; shape: Shape }[]).find((e) => e.id === ref.id);
        return {
            ...level,
            [list]: shape && own ? [...others, { ...own, shape }] : others,
        };
    };

    const reshapeTo = (reshape: Extract<Gesture, { kind: 'reshape' }>, input: PointerInput) => {
        const { ref, start, handle, tx } = reshape;
        let next: Shape | undefined;
        let target;
        if (handle.type === 'corner') {
            const { ring, index } = handle.corner;
            const r = ringsOf(start)[ring]!;
            const withoutCorner = withRing(
                start,
                ring,
                r.filter((_, i) => i !== index),
            );
            target = ctx.snap(input, { level: snapLevel(ref, withoutCorner) });
            const square = rectangleSides(r) !== undefined && !input.shift;
            const moved = square
                ? dragRectangleCorner(r, index, target.point)
                : moveCorner(r, index, target.point);
            next = moved && withRing(start, ring, moved);
        } else {
            target = ctx.snap(input, { level: snapLevel(ref, null) });
            const r = ringsOf(start)[handle.ring]!;
            const moved = dragRectangleSide(r, handle.edge, target.point);
            next = moved && withRing(start, handle.ring, moved);
        }
        if (next && holesValid(next)) {
            const command = reshapeCommand(ctx.editor.getDocument(), ref, next);
            if (command) tx.exec(command);
        }
        ctx.setOverlay([
            ...shapeHandles(),
            ...(target.kind === 'none'
                ? []
                : [
                      {
                          type: 'marker' as const,
                          position: target.point,
                          kind: target.kind,
                          style: snapMarker,
                      },
                  ]),
        ]);
    };

    /** Starts reshaping at a handle; a side handle on a non-rectangle, or with Shift, adds a corner. */
    const startReshape = (
        hit: NonNullable<ReturnType<typeof handleAt>>,
        input: PointerInput,
    ): Gesture => {
        const tx = ctx.editor.begin();
        const { ref } = hit;
        if ('corner' in hit) {
            active = { ref, corner: hit.corner };
            return {
                kind: 'reshape',
                ref,
                start: hit.shape,
                handle: { type: 'corner', corner: hit.corner },
                tx,
            };
        }
        const { ring, edge } = hit.side;
        const r = ringsOf(hit.shape)[ring]!;
        if (rectangleSides(r) !== undefined && !input.shift) {
            active = null;
            return {
                kind: 'reshape',
                ref,
                start: hit.shape,
                handle: { type: 'side', ring, edge },
                tx,
            };
        }
        const start = withRing(hit.shape, ring, insertCorner(r, edge));
        const command = reshapeCommand(ctx.editor.getDocument(), ref, start);
        if (command) tx.exec(command);
        const corner = { ring, index: edge + 1 };
        active = { ref, corner };
        return { kind: 'reshape', ref, start, handle: { type: 'corner', corner }, tx };
    };

    /** The selection frame and its rotation handle. */
    const frame = (): OverlayItem[] => {
        const b = bounds();
        if (!b) return [];
        const [handle, foot] = handlePosition(b);
        return [
            {
                type: 'line',
                closed: true,
                points: [
                    [b.minX, b.minY],
                    [b.maxX, b.minY],
                    [b.maxX, b.maxY],
                    [b.minX, b.maxY],
                ],
                style: { ...previewLine, strokeWidth: 1 },
            },
            {
                type: 'line',
                points: [foot, handle],
                style: { ...previewLine, strokeWidth: 1 },
            },
            { type: 'marker', position: handle, kind: 'node', style: snapMarker },
            ...selectionLabels(),
            ...shapeHandles(),
            ...wallEndHandles(),
            ...underlayHandles(),
        ];
    };
    const showFrame = () => ctx.setOverlay(frame());

    const rotate = (pivot: Vec2, angle: number, tx?: Transaction) => {
        const command = rotateCommand(
            ctx.editor.getDocument(),
            ctx.levelId(),
            ctx.selection(),
            pivot,
            angle,
        );
        return command ? (tx ?? ctx.editor).exec(command).ok : false;
    };

    const hitAt = (point: Vec2) =>
        hitTest(ctx.editor.getDocument(), ctx.levelId(), point, ctx.hitTolerance());

    const isSelected = (ref: ElementRef) => ctx.selection().some((s) => sameRef(s, ref));

    const startDrag = (pending: Extract<Gesture, { kind: 'pending' }>, input: PointerInput) => {
        if (!pending.hit) {
            gesture = { kind: 'box', start: pending.start };
            return;
        }
        // A lone Wall Node snaps to where it is dropped; anything else moves by grid steps.
        const node =
            pending.hit.kind === 'wallNode' && ctx.selection().length === 1 ? pending.hit : null;
        gesture = {
            kind: 'move',
            start: pending.start,
            tx: ctx.editor.begin(),
            applied: [0, 0],
            node,
        };
        moveTo(input);
    };

    const moveTo = (input: PointerInput) => {
        const move = gesture;
        if (move?.kind !== 'move') return;
        let total: Vec2;
        if (move.node) {
            const nodeId = move.node.id;
            const node = ctx.level().wallNodes.find((n) => n.id === nodeId);
            if (!node) return;
            const target = ctx.snap(input, { exclude: new Set([node.id]) });
            move.target = target;
            const origin: Vec2 = [
                node.position[0] - move.applied[0],
                node.position[1] - move.applied[1],
            ];
            total = [target.point[0] - origin[0], target.point[1] - origin[1]];
            ctx.setOverlay(
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
        } else {
            total = ctx.gridDelta(
                [input.point[0] - move.start[0], input.point[1] - move.start[1]],
                input.alt ?? false,
            );
        }
        const step: Vec2 = [total[0] - move.applied[0], total[1] - move.applied[1]];
        if (step[0] === 0 && step[1] === 0) return;
        const command = moveCommand(ctx.editor.getDocument(), ctx.levelId(), ctx.selection(), step);
        if (command && move.tx.exec(command).ok) move.applied = total;
    };

    /**
     * A Wall Node dropped on another joins it; one dropped on a Wall splits it there and joins
     * the new node. Part of the drag's transaction, so one undo step.
     */
    const joinDropped = (move: Extract<Gesture, { kind: 'move' }>) => {
        const { node, target, tx } = move;
        if (!node || !target) return;
        const levelId = ctx.levelId();
        let into: string | undefined;
        if (target.kind === 'node' && target.ref?.kind === 'wallNode') {
            into = target.ref.id;
        } else {
            const level = ctx.level();
            const position = level.wallNodes.find((n) => n.id === node.id)?.position;
            const host =
                position &&
                wallAt(level, position, (wall) => wall.a === node.id || wall.b === node.id);
            if (!host || host.offset < 1e-6 || host.offset > host.length - 1e-6) return;
            into = crypto.randomUUID();
            const split = tx.exec({
                type: 'wall.split',
                levelId,
                wallId: host.wallId,
                offset: host.offset,
                nodeId: into,
            });
            if (!split.ok) return;
        }
        if (into === node.id) return;
        if (tx.exec({ type: 'wallNode.merge', levelId, nodeId: node.id, into }).ok) {
            ctx.select([{ kind: 'wallNode', id: into, levelId }]);
        }
    };

    return {
        pointerDown(input) {
            const b = bounds();
            if (b) {
                const [handle] = handlePosition(b);
                const nearHandle =
                    Math.hypot(input.point[0] - handle[0], input.point[1] - handle[1]) <=
                    ctx.hitTolerance() * 1.5;
                if (nearHandle) {
                    const pivot = center(b);
                    const startAngle = Math.atan2(
                        input.point[1] - pivot[1],
                        input.point[0] - pivot[0],
                    );
                    gesture = {
                        kind: 'rotate',
                        pivot,
                        startAngle,
                        tx: ctx.editor.begin(),
                        applied: 0,
                    };
                    return;
                }
            }
            // Above everything, so a corner under a Zone is still the Underlay's.
            const corner = underlayCornerAt(input.point);
            if (corner) {
                gesture = {
                    kind: 'scale',
                    start: corner.underlay,
                    corner: corner.corner,
                    tx: ctx.editor.begin(),
                };
                return;
            }
            const handle = handleAt(input.point);
            if (handle) {
                gesture = startReshape(handle, input);
                showFrame();
                return;
            }
            active = null;
            const hit = hitAt(input.point);
            const wasSelected = hit !== null && isSelected(hit);
            if (hit && input.shift) {
                ctx.select(
                    wasSelected
                        ? ctx.selection().filter((s) => !sameRef(s, hit))
                        : [...ctx.selection(), hit],
                );
            } else if (hit && !wasSelected) {
                ctx.select([hit]);
            }
            gesture = {
                kind: 'pending',
                start: input.point,
                hit,
                wasSelected,
                shift: input.shift ?? false,
            };
        },
        pointerMove(input) {
            if (!gesture) {
                const corner = underlayCornerAt(input.point);
                ctx.setCursor(
                    corner
                        ? resizeCursor(corner.corners, corner.corner)
                        : wallEndAt(input.point)
                          ? 'move'
                          : null,
                );
                ctx.setHover(corner ? null : hitAt(input.point));
                return;
            }
            if (gesture.kind === 'scale') {
                scaleTo(gesture, input);
                return;
            }
            if (gesture.kind === 'reshape') {
                reshapeTo(gesture, input);
                return;
            }
            if (gesture.kind === 'rotate') {
                const { pivot, startAngle } = gesture;
                const raw =
                    Math.atan2(input.point[1] - pivot[1], input.point[0] - pivot[0]) - startAngle;
                const angle = input.alt ? raw : Math.round(raw / ROTATE_STEP) * ROTATE_STEP;
                if (
                    angle !== gesture.applied &&
                    rotate(pivot, angle - gesture.applied, gesture.tx)
                ) {
                    gesture.applied = angle;
                }
                return;
            }
            if (gesture.kind === 'pending') {
                const moved = Math.hypot(
                    input.point[0] - gesture.start[0],
                    input.point[1] - gesture.start[1],
                );
                if (moved < DRAG_PX / ctx.zoom()) return;
                if (gesture.shift && gesture.hit) return; // Shift-press toggles; it does not drag.
                startDrag(gesture, input);
            }
            if (gesture.kind === 'move') moveTo(input);
            if (gesture.kind === 'box') {
                const [a, b] = [gesture.start, input.point];
                ctx.setOverlay([
                    {
                        type: 'polygon',
                        shape: { outer: [a, [b[0], a[1]], b, [a[0], b[1]]] },
                        style: previewFill,
                    },
                ]);
            }
        },
        pointerUp(input) {
            const done = gesture;
            gesture = null;
            if (!done) return;
            if (
                done.kind === 'move' ||
                done.kind === 'rotate' ||
                done.kind === 'reshape' ||
                done.kind === 'scale'
            ) {
                if (done.kind === 'move') joinDropped(done);
                done.tx.commit();
                showFrame();
            } else if (done.kind === 'box') {
                const inBox = refsInBox(ctx.level(), done.start, input.point);
                ctx.select(
                    input.shift
                        ? [...ctx.selection(), ...inBox.filter((r) => !isSelected(r))]
                        : inBox,
                );
                showFrame();
            } else if (!done.hit && !done.shift) {
                ctx.select([]);
            } else if (done.hit && done.wasSelected && !done.shift) {
                ctx.select([done.hit]);
            }
        },
        keyDown({ key }) {
            if (key === 'Escape' && gesture && 'tx' in gesture) {
                // Mid-drag: back to where things were, still selected, and nothing to undo.
                gesture.tx.cancel();
                gesture = null;
                showFrame();
                return true;
            }
            const target = editable();
            const corner = target && activeCorner(target.ref);
            if ((key === 'Delete' || key === 'Backspace') && target && corner) {
                const next = removeCorner(target.shape, corner);
                if (!next) {
                    ctx.setMessage('A shape needs at least three corners.');
                    return true;
                }
                const command = reshapeCommand(ctx.editor.getDocument(), target.ref, next);
                if (command && ctx.editor.exec(command).ok) {
                    active = null;
                    showFrame();
                }
                return true;
            }
            if (key === 'Escape' && corner) {
                active = null;
                showFrame();
                return true;
            }
            if (key === 'Delete' || key === 'Backspace') {
                if (ctx.selection().length === 0) return false;
                ctx.requestDelete();
                return true;
            }
            if (key === 'Escape' && ctx.selection().length > 0) {
                ctx.select([]);
                return true;
            }
            if (key === 'f' || key === 'F') {
                const part = key === 'F' ? 'hinge' : 'swing';
                const commands = flipDoorCommands(ctx.level(), ctx.selection(), part);
                if (commands.length === 0) return false;
                const tx = ctx.editor.begin();
                for (const command of commands) tx.exec(command);
                tx.commit();
                return true;
            }
            if (key === 'r' || key === 'R') {
                const b = bounds();
                if (!b) return false;
                const selection = ctx.selection();
                const continuing =
                    lastTurn !== null &&
                    lastTurn.doc === ctx.editor.getDocument() &&
                    lastTurn.selection === selection;
                const pivot = continuing
                    ? lastTurn!.pivot
                    : quarterTurnPivot(center(b), ctx.editor.getDocument().grid);
                if (rotate(pivot, key === 'R' ? -Math.PI / 2 : Math.PI / 2)) {
                    lastTurn = { doc: ctx.editor.getDocument(), selection, pivot };
                }
                return true;
            }
            return false;
        },
        refresh() {
            if (!gesture) showFrame();
        },
        cancel() {
            if (gesture && 'tx' in gesture) gesture.tx.cancel();
            gesture = null;
            ctx.setOverlay([]);
            ctx.setCursor(null);
        },
    };
}

/**
 * A pivot about which a quarter turn maps grid points to grid points: both coordinates whole
 * grid steps, or both half steps. The exact centre is kept when it already qualifies (so a
 * square booth turns in place); otherwise its half coordinate is rounded to a grid line.
 */
function quarterTurnPivot(center: Vec2, grid: { step: number; snap: boolean }): Vec2 {
    if (!grid.snap || grid.step <= 0) return center;
    const halves = center.map((v) => Math.round((v / grid.step) * 2)) as [number, number];
    const [hx, hy] = halves;
    const sameKind = hx % 2 === hy % 2 || (hx % 2 !== 0 && hy % 2 !== 0);
    const units: Vec2 = sameKind
        ? [hx / 2, hy / 2]
        : [hx % 2 === 0 ? hx / 2 : Math.round(hx / 2), hy % 2 === 0 ? hy / 2 : Math.round(hy / 2)];
    return [Number((units[0] * grid.step).toFixed(9)), Number((units[1] * grid.step).toFixed(9))];
}
