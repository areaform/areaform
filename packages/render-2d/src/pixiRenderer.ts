// Thin PixiJS adapter (ADR-0004): draws the Scene from buildScene and turns pointer input into
// camera moves and Element events. Decisions about what to draw live in the tested pure layers
// (camera.ts, scene.ts, hitTest.ts); this file only translates them to Pixi. It is loaded on
// demand by createRenderer, so Pixi stays out of the bundle until a plan is drawn.
import type { ElementRef, AreaformDocument, Id, Shape, Vec2 } from '@areaform/core';
import {
    Application,
    Assets,
    BitmapText,
    CanvasSource,
    Container,
    Graphics,
    Sprite,
    Texture,
} from 'pixi.js';
import {
    applyWheel,
    createCamera,
    fit,
    panBy,
    screenToWorld,
    worldToScreen,
    type WheelMode,
    type Box,
    pinchBy,
} from './camera.ts';
import { cooperativeTouch, wheelGoesToPage, type Gestures } from './gestures.ts';
import { gridLines } from './grid.ts';
import { rulerStep, rulerTicks } from './rulers.ts';
import { hitTest } from './hitTest.ts';
import type { OverlayItem } from './overlay.ts';
import {
    contentLabelResolver,
    LABEL_FONT,
    LABEL_LINE_HEIGHT,
    type LabelResolver,
} from './labels.ts';
import { containIn, loadSvgImage } from './icons/svgImage.ts';
import { underlayAsset } from './underlayAsset.ts';
import { buildScene, type AssetResolver, type SceneItem, type StyleResolver } from './scene.ts';
import type {
    Interaction,
    PlanPointerEvent,
    Renderer,
    RendererEvents,
    RendererOptions,
    Rulers,
} from './renderer.ts';
import { defaultTheme, type Style } from './theme.ts';

const LABEL_FONT_PX = 48;
/** Entrance and exit arrows: at most this wide, metres, and left out when under this many px. */
const ARROW_MAX = 1.2;
const ARROW_MIN_PX = 6;
const DRAG_THRESHOLD_PX = 3;
/** A finger wobbles more than a mouse: a tap that moves less than this is still a tap. */
const TOUCH_THRESHOLD_PX = 10;
/** Thickness of the ruler strips, their numbers' size and their ticks' length, px. */
const RULER_PX = 18;
const RULER_FONT_PX = 10;
const RULER_TICK_PX = 4;
/** The origin mark: how far its cross reaches back, how long its X and Y arrows are, px. */
const ORIGIN_CROSS_PX = 6;
const ORIGIN_ARROW_PX = 28;
const ORIGIN_HEAD_PX = 4;

export async function createPixiRenderer(options: RendererOptions): Promise<Renderer> {
    const { container } = options;
    const theme = options.theme ?? defaultTheme;
    const hitTolerancePx = options.hitTolerancePx ?? 6;

    const app = new Application();
    await app.init({
        resizeTo: container,
        background: options.background ?? '#ffffff',
        antialias: true,
        autoDensity: true,
        resolution: globalThis.devicePixelRatio ?? 1,
    });
    container.appendChild(app.canvas);

    // Plan coordinates are Y-up; the world container flips Y so children use metres directly.
    const world = new Container();
    const overlayLayer = new Container();
    // Screen-space guides over everything else: the origin mark, then the rulers over it.
    const guides = new Container();
    const guideLines = new Graphics();
    const originColor = theme.origin.stroke ?? '#d0453a';
    const rulerInk = theme.ruler.stroke ?? '#5f5f5a';
    const originLabels = [guideText('X', originColor), guideText('Y', originColor)] as const;
    const rulerCorner = guideText('', rulerInk);
    /** Reused from one camera move to the next, so panning creates no objects. */
    const rulerLabels: BitmapText[] = [];
    guides.addChild(guideLines, ...originLabels, rulerCorner);
    app.stage.addChild(world, overlayLayer, guides);
    let overlay: OverlayItem[] = [];
    let interaction: Interaction = options.interaction ?? 'view';
    let wheelMode: WheelMode = options.wheel ?? 'auto';
    let gestures: Gestures = options.gestures ?? 'greedy';
    let inset = 0;
    let showGrid = options.grid ?? false;
    let rulers: Rulers | null = options.rulers ?? null;
    let showOrigin = options.origin ?? false;
    const gridLayer = new Graphics();

    let doc: AreaformDocument | null = null;
    let levelId: Id | null = null;
    let styleResolver: StyleResolver | undefined;
    let labelResolver: LabelResolver | undefined;
    let contentLanguage: string | undefined;
    let assetResolver: AssetResolver | undefined;
    let highlighted: ElementRef[] = [];
    let camera = createCamera({ viewport: viewportOf(container) });
    let drawnBand: number | null = null;
    const drawn = new Map<string, { signature: string; object: Container }>();
    const listeners = new Map<keyof RendererEvents, Set<(e: never) => void>>();

    const emit = <E extends keyof RendererEvents>(event: E, payload: RendererEvents[E]) => {
        for (const handler of listeners.get(event) ?? [])
            (handler as (e: RendererEvents[E]) => void)(payload);
    };

    const applyCamera = () => {
        world.position.set(
            camera.viewport.width / 2 - camera.center[0] * camera.zoom,
            camera.viewport.height / 2 + camera.center[1] * camera.zoom,
        );
        world.scale.set(camera.zoom, -camera.zoom);
        overlayLayer.position.copyFrom(world.position);
        overlayLayer.scale.copyFrom(world.scale);
        drawOverlay();
        drawGrid();
        drawGuides();
        // Line widths and level of detail follow the zoom in √2 steps, not on every frame.
        const band = Math.round(Math.log2(camera.zoom) * 2);
        if (band !== drawnBand) redraw();
        emit('cameraChange', camera);
    };

    const redraw = () => {
        if (!doc || !levelId) return;
        drawnBand = Math.round(Math.log2(camera.zoom) * 2);
        const bandZoom = 2 ** (drawnBand / 2);
        const labels = contentLabelResolver(labelResolver, doc.languages, contentLanguage);
        const scene = buildScene(doc, levelId, {
            zoom: bandZoom,
            theme,
            ...(styleResolver && { styleResolver }),
            ...(labels && { labelResolver: labels }),
            ...(assetResolver && { resolveAsset: assetResolver }),
            highlight: highlighted,
        });

        const seen = new Set<string>();
        const ordered: Container[] = [];
        for (const item of scene) {
            const key = `${item.type}:${item.ref.kind}:${item.ref.id}`;
            seen.add(key);
            const signature = JSON.stringify(item) + bandZoom;
            let entry = drawn.get(key);
            if (!entry || entry.signature !== signature) {
                entry?.object.destroy({ children: true });
                entry = { signature, object: draw(item, bandZoom) };
                drawn.set(key, entry);
            }
            ordered.push(entry.object);
        }
        for (const [key, entry] of drawn) {
            if (!seen.has(key)) {
                entry.object.destroy({ children: true });
                drawn.delete(key);
            }
        }
        world.removeChildren();
        // The grid goes over the floor (the Outline and Underlays, painted first) and under the rest.
        const floor = scene.findIndex((i) => i.ref.kind !== 'level' && i.ref.kind !== 'underlay');
        const split = floor === -1 ? ordered.length : floor;
        world.addChild(...ordered.slice(0, split), gridLayer, ...ordered.slice(split));
    };

    /** Grid lines over the part of the plan in view, at the current zoom. */
    const drawGrid = () => {
        gridLayer.clear();
        if (!showGrid || !doc) return;
        const [minX, maxY] = screenToWorld(camera, [0, 0]);
        const [maxX, minY] = screenToWorld(camera, [camera.viewport.width, camera.viewport.height]);
        const lines = gridLines({ minX, minY, maxX, maxY }, doc.grid.step, camera.zoom);
        const width = (theme.grid.strokeWidth ?? 1) / camera.zoom;
        const color = theme.grid.stroke ?? '#8a8a84';
        const alpha = theme.grid.opacity ?? 0.22;
        const stroke = (xs: number[], ys: number[], a: number) => {
            if (xs.length === 0 && ys.length === 0) return;
            for (const x of xs) gridLayer.moveTo(x, minY).lineTo(x, maxY);
            for (const y of ys) gridLayer.moveTo(minX, y).lineTo(maxX, y);
            gridLayer.stroke({ color, width, alpha: a });
        };
        stroke(lines.minor.xs, lines.minor.ys, alpha);
        stroke(lines.major.xs, lines.major.ys, Math.min(1, alpha * 2));
    };

    /** The origin mark and the rulers, in screen pixels. */
    const drawGuides = () => {
        guideLines.clear();
        const { width, height } = camera.viewport;
        const inset = rulers ? RULER_PX : 0;
        const [ox, oy] = worldToScreen(camera, [0, 0]).map((v) => Math.round(v) + 0.5) as [
            number,
            number,
        ];
        const [xLabel, yLabel] = originLabels;
        xLabel.visible = yLabel.visible = false;
        if (showOrigin && doc) {
            const [c, a, h] = [ORIGIN_CROSS_PX, ORIGIN_ARROW_PX, ORIGIN_HEAD_PX];
            guideLines
                .moveTo(ox - c, oy)
                .lineTo(ox + a, oy)
                .moveTo(ox + a - h, oy - h)
                .lineTo(ox + a, oy)
                .lineTo(ox + a - h, oy + h)
                .moveTo(ox, oy + c)
                .lineTo(ox, oy - a)
                .moveTo(ox - h, oy - a + h)
                .lineTo(ox, oy - a)
                .lineTo(ox + h, oy - a + h)
                .stroke({ color: originColor, width: theme.origin.strokeWidth ?? 1.5 });
            xLabel.anchor.set(0, 0.5);
            xLabel.position.set(ox + a + 3, oy);
            yLabel.anchor.set(0.5, 1);
            yLabel.position.set(ox, oy - a - 2);
            xLabel.visible = xLabel.x > inset && oy > inset;
            yLabel.visible = ox > inset && yLabel.y - yLabel.height > inset;
        }

        let used = 0;
        rulerCorner.visible = false;
        if (rulers) {
            const unit = rulers.unit ?? 1;
            const format = rulers.format ?? String;
            const ticks = rulerTicks(
                camera,
                rulerStep(doc?.grid.step ?? 0, camera.zoom, unit),
                unit,
            );
            guideLines
                .rect(0, 0, width, RULER_PX)
                .rect(0, RULER_PX, RULER_PX, height - RULER_PX)
                .fill({ color: theme.ruler.fill ?? '#ffffff', alpha: theme.ruler.opacity ?? 0.92 });
            const edge = RULER_PX - 0.5;
            guideLines.moveTo(0, edge).lineTo(width, edge).moveTo(edge, 0).lineTo(edge, height);
            const label = (text: string) => {
                let t = rulerLabels[used];
                if (!t) {
                    t = guideText('', rulerInk);
                    rulerLabels.push(t);
                    guides.addChild(t);
                }
                used++;
                t.text = text;
                t.visible = true;
                return t;
            };
            for (const tick of ticks.xs) {
                const at = Math.round(tick.at) + 0.5;
                if (at < RULER_PX) continue;
                guideLines.moveTo(at, RULER_PX - RULER_TICK_PX).lineTo(at, RULER_PX);
                const t = label(format(tick.value));
                t.anchor.set(0.5, 0);
                t.rotation = 0;
                t.position.set(at, 2);
                // Half a number over the corner or the far edge is left out.
                t.visible = at - t.width / 2 >= RULER_PX && at + t.width / 2 <= width;
            }
            for (const tick of ticks.ys) {
                const at = Math.round(tick.at) + 0.5;
                if (at < RULER_PX) continue;
                guideLines.moveTo(RULER_PX - RULER_TICK_PX, at).lineTo(RULER_PX, at);
                const t = label(format(tick.value));
                // Read bottom to top, as on a drawing's left edge.
                t.anchor.set(0.5, 0);
                t.rotation = -Math.PI / 2;
                t.position.set(2, at);
                t.visible = at - t.width / 2 >= RULER_PX && at + t.width / 2 <= height;
            }
            guideLines.stroke({ color: rulerInk, width: 1, alpha: 0.6 });
            if (rulers.unitLabel) {
                rulerCorner.text = rulers.unitLabel;
                rulerCorner.anchor.set(0.5);
                rulerCorner.position.set(RULER_PX / 2, RULER_PX / 2);
                rulerCorner.visible = true;
            }
        }
        for (const t of rulerLabels.slice(used)) t.visible = false;
    };

    const drawOverlay = () => {
        for (const child of overlayLayer.removeChildren()) child.destroy({ children: true });
        for (const item of overlay) overlayLayer.addChild(drawOverlayItem(item, camera.zoom));
    };

    // --- Pointer input -------------------------------------------------------------------------

    const canvas = app.canvas;
    const local = (e: PointerEvent | WheelEvent): Vec2 => {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
    };
    const hit = (screen: Vec2) =>
        doc && levelId
            ? hitTest(doc, levelId, screenToWorld(camera, screen), hitTolerancePx / camera.zoom)
            : null;

    let drag: { start: Vec2; last: Vec2; moved: boolean } | null = null;
    let editing = false;
    let hovered: string | null = null;
    let spaceHeld = false;

    const planEvent = (e: PointerEvent): PlanPointerEvent => ({
        point: screenToWorld(camera, local(e)),
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey || e.ctrlKey,
        originalEvent: e,
    });

    const onWheel = (e: WheelEvent) => {
        // Left alone, it scrolls the page the plan is on.
        if (wheelGoesToPage(gestures, e)) return emit('gestureHint', 'wheel');
        e.preventDefault();
        // `wheelDeltaY` is non-standard but present in Chrome and Safari.
        const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
        camera = applyWheel(
            camera,
            local(e),
            {
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                deltaMode: e.deltaMode,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                ...(legacy !== undefined && { wheelDeltaY: legacy }),
            },
            wheelMode,
        );
        applyCamera();
    };
    /** Fingers on the plan now, where each was last; two of them pinch and pan in the View. */
    const fingers = new Map<number, Vec2>();
    const pinching = () => interaction === 'view' && fingers.size >= 2;
    /** A pinch happened since the first finger went down: lifting the fingers clicks nothing. */
    let pinched = false;
    const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType === 'touch') {
            fingers.set(e.pointerId, local(e));
            // The second finger turns a pan or a tap into a pinch, which is never a click.
            if (pinching()) {
                drag = null;
                pinched = true;
                return;
            }
        }
        canvas.setPointerCapture(e.pointerId);
        const pans =
            interaction === 'view' ? e.button === 0 || e.button === 1 : e.button === 1 || spaceHeld;
        if (pans) {
            drag = { start: local(e), last: local(e), moved: false };
        } else if (interaction === 'edit' && e.button === 0) {
            editing = true;
            emit('pointerDown', planEvent(e));
        }
    };
    const onPointerMove = (e: PointerEvent) => {
        const screen = local(e);
        if (e.pointerType === 'touch' && fingers.has(e.pointerId)) {
            if (pinching()) {
                const [a, b] = [...fingers.keys()] as [number, number];
                const from: [Vec2, Vec2] = [fingers.get(a)!, fingers.get(b)!];
                fingers.set(e.pointerId, screen);
                if (e.pointerId === a || e.pointerId === b) {
                    camera = pinchBy(camera, from, [fingers.get(a)!, fingers.get(b)!]);
                    applyCamera();
                }
                return;
            }
            fingers.set(e.pointerId, screen);
        }
        if (drag) {
            const total = Math.hypot(screen[0] - drag.start[0], screen[1] - drag.start[1]);
            const slack = e.pointerType === 'touch' ? TOUCH_THRESHOLD_PX : DRAG_THRESHOLD_PX;
            if (total > slack) drag.moved = true;
            // Under cooperative gestures one finger is the page's: the browser scrolls it and
            // cancels this pointer, so the plan stays where it is.
            const pans = !(e.pointerType === 'touch' && gestures === 'cooperative');
            if (drag.moved && pans) {
                camera = panBy(camera, [screen[0] - drag.last[0], screen[1] - drag.last[1]]);
                drag.last = screen;
                applyCamera();
            }
            return;
        }
        if (interaction === 'edit') {
            emit('pointerMove', planEvent(e));
            return;
        }
        const ref = hit(screen);
        const key = ref ? `${ref.kind}:${ref.id}` : null;
        if (key !== hovered) {
            hovered = key;
            emit('elementHover', { ref, point: screenToWorld(camera, screen), screen });
        }
    };
    const onPointerUp = (e: PointerEvent) => {
        if (e.pointerType === 'touch') {
            fingers.delete(e.pointerId);
            if (pinched) {
                if (fingers.size === 0) pinched = false;
                drag = null;
                return;
            }
        }
        if (editing) {
            editing = false;
            emit('pointerUp', planEvent(e));
            return;
        }
        const wasDrag = drag?.moved ?? false;
        drag = null;
        if (wasDrag || interaction === 'edit') return;
        const screen = local(e);
        const point = screenToWorld(camera, screen);
        const ref = hit(screen);
        if (ref) emit('elementClick', { ref, point, screen, originalEvent: e });
        else emit('backgroundClick', { point, screen, originalEvent: e });
    };
    const onPointerCancel = (e: PointerEvent) => {
        fingers.delete(e.pointerId);
        if (fingers.size === 0) pinched = false;
        drag = null;
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== ' ') return;
        spaceHeld = e.type === 'keydown';
        canvas.style.cursor = spaceHeld && interaction === 'edit' ? 'grab' : '';
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    const touch = cooperativeTouch(
        canvas,
        () => gestures,
        (hint) => emit('gestureHint', hint),
    );
    globalThis.addEventListener('keydown', onKey);
    globalThis.addEventListener('keyup', onKey);

    const resizeObserver = new ResizeObserver(() => {
        camera = { ...camera, viewport: viewportOf(container) };
        applyCamera();
    });
    resizeObserver.observe(container);

    const levelBox = (): Box | null => {
        const level = doc?.levels.find((l) => l.id === levelId);
        if (!level) return null;
        const xs = level.outline.outer.map((p) => p[0]);
        const ys = level.outline.outer.map((p) => p[1]);
        return {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
        };
    };

    return {
        update(next) {
            doc = next;
            if (!levelId || !next.levels.some((l) => l.id === levelId))
                levelId = next.levels[0]?.id ?? null;
            redraw();
            // The Grid Step may have changed, and with it the grid and the ruler steps.
            drawGrid();
            drawGuides();
        },
        setLevel(id) {
            levelId = id;
            redraw();
        },
        setStyleResolver(resolver) {
            styleResolver = resolver;
            redraw();
        },
        setLabelResolver(resolver) {
            labelResolver = resolver;
            redraw();
        },
        setContentLanguage(language) {
            if (language === contentLanguage) return;
            contentLanguage = language;
            redraw();
        },
        setAssetResolver(resolver) {
            assetResolver = resolver;
            redraw();
        },
        highlight(refs) {
            highlighted = refs;
            redraw();
        },
        setOverlay(items) {
            overlay = items;
            drawOverlay();
        },
        setWheelMode(mode) {
            wheelMode = mode;
        },
        setGestures(next) {
            gestures = next;
            touch.apply();
        },
        setInset(left) {
            inset = left;
        },
        setGrid(on) {
            showGrid = on;
            drawGrid();
        },
        setRulers(next) {
            rulers = next;
            drawGuides();
        },
        setOrigin(on) {
            showOrigin = on;
            drawGuides();
        },
        setInteraction(next) {
            interaction = next;
            drag = null;
            editing = false;
        },
        getCamera: () => camera,
        setCamera(next) {
            camera = { ...next, viewport: viewportOf(container) };
            applyCamera();
        },
        fitLevel(padding = 40) {
            const box = levelBox();
            if (!box) return;
            camera = fit({ ...camera, viewport: viewportOf(container) }, box, padding, inset);
            applyCamera();
        },
        on(event, handler) {
            const set = listeners.get(event) ?? new Set();
            set.add(handler as (e: never) => void);
            listeners.set(event, set);
            return () => set.delete(handler as (e: never) => void);
        },
        // Pixi's ticker draws the stage every frame; stopping it is what stops the work.
        setPaused(paused) {
            if (paused) app.stop();
            else app.start();
        },
        destroy() {
            resizeObserver.disconnect();
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerCancel);
            touch.dispose();
            globalThis.removeEventListener('keydown', onKey);
            globalThis.removeEventListener('keyup', onKey);
            app.destroy(true, { children: true });
        },
    };
}

function viewportOf(container: HTMLElement) {
    return { width: container.clientWidth || 1, height: container.clientHeight || 1 };
}

// --- Drawing scene items -----------------------------------------------------------------------

function draw(item: SceneItem, zoom: number): Container {
    switch (item.type) {
        case 'polygon':
            return drawPolygon(item.shape, item.style, zoom);
        case 'opening':
            return drawOpening(item, zoom);
        case 'label':
            return drawLabel(item);
        case 'image':
            return drawImage(item);
        case 'icon':
            return drawIcon(item);
        case 'logo':
            return drawLogo(item);
    }
}

/** Pixels across an icon is baked at: sharp on a 1.2 m icon up to about 200 px per metre. */
const ICON_TEXTURE_PX = 256;
/** Icons as white silhouettes by SVG markup, baked once and shared by every Zone and Stop. */
const iconTextures = new Map<string, Promise<Texture>>();

/** The SVG as a white silhouette texture: every painted pixel white, so any SVG tints alike. */
function iconTexture(svg: string): Promise<Texture> {
    let baking = iconTextures.get(svg);
    if (!baking) {
        baking = loadSvgImage(svg, ICON_TEXTURE_PX).then((image) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = ICON_TEXTURE_PX;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, ...containIn(image, ICON_TEXTURE_PX));
            context.globalCompositeOperation = 'source-in';
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, ICON_TEXTURE_PX, ICON_TEXTURE_PX);
            return new Texture({
                source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true }),
            });
        });
        iconTextures.set(svg, baking);
    }
    return baking;
}

/** An SVG icon centred on its position, `size` metres across, as a silhouette in the style's stroke. */
function drawIcon(item: Extract<SceneItem, { type: 'icon' }>): Container {
    const holder = new Container();
    holder.position.set(item.position[0], item.position[1]);
    void iconTexture(item.svg).then(
        (texture) => {
            if (holder.destroyed) return;
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5);
            const scale = item.size / ICON_TEXTURE_PX;
            // Image pixels grow downward; in the Y-up world that is −Y.
            sprite.scale.set(scale, -scale);
            sprite.tint = item.style.stroke ?? '#000000';
            holder.addChild(sprite);
        },
        () => {
            // An SVG the browser cannot read leaves no icon; the plan itself still renders.
        },
    );
    return holder;
}

const flat = (ring: Vec2[]) => ring.flat();

function drawPolygon(shape: Shape, style: Style, zoom: number): Graphics {
    const g = new Graphics();
    const alpha = style.opacity ?? 1;
    g.poly(flat(shape.outer));
    if (style.fill) g.fill({ color: style.fill, alpha });
    for (const hole of shape.holes ?? []) g.poly(flat(hole)).cut();
    if (style.stroke) {
        const stroke = { color: style.stroke, width: (style.strokeWidth ?? 1) / zoom, alpha };
        g.poly(flat(shape.outer)).stroke(stroke);
        for (const hole of shape.holes ?? []) g.poly(flat(hole)).stroke(stroke);
    }
    return g;
}

function drawOpening(item: Extract<SceneItem, { type: 'opening' }>, zoom: number): Graphics {
    const g = new Graphics();
    const { width, depth, style } = item;
    const [w, h] = [width / 2, depth / 2];
    // The gap: a rectangle across the wall, slightly deeper so it fully covers it.
    const d = h + 0.5 / zoom;
    g.rect(-w, -d, width, 2 * d);
    if (style.fill) g.fill({ color: style.fill });
    if (style.stroke) {
        const lineWidth = (style.strokeWidth ?? 1) / zoom;
        const stroke = { color: style.stroke, width: lineWidth };
        // Jambs on both sides, drawn heavier so the wall visibly ends there.
        const jamb = { ...stroke, width: 2 * lineWidth };
        g.moveTo(-w, -d).lineTo(-w, d).stroke(jamb);
        g.moveTo(w, -d).lineTo(w, d).stroke(jamb);
        if (item.kind === 'door') {
            // The leaf stands open at right angles from the hinge jamb, on the swing side; the
            // arc runs from its tip to the far jamb.
            const x = item.hinge === 'start' ? -w : w;
            const side = item.swing === 'left' ? 1 : -1;
            const y = side * h;
            g.moveTo(x, y)
                .lineTo(x, y + side * width)
                .stroke(stroke);
            const closed = item.hinge === 'start' ? 0 : side * Math.PI;
            const anticlockwise = (item.hinge === 'start') === (item.swing === 'left');
            g.arc(x, y, width, (side * Math.PI) / 2, closed, anticlockwise).stroke(stroke);
        } else {
            // Doorless gaps: a threshold line on each face of the wall.
            const sill = { ...stroke, alpha: 0.6 };
            g.moveTo(-w, -h).lineTo(w, -h).stroke(sill);
            g.moveTo(-w, h).lineTo(w, h).stroke(sill);
            // Entrances point in from outside, emergency exits point out.
            const way =
                item.inside === undefined
                    ? 0
                    : (item.inside === 'left' ? 1 : -1) * (item.kind === 'emergency-exit' ? -1 : 1);
            const size = Math.min(width * 0.5, ARROW_MAX);
            if (way !== 0 && item.kind !== 'passage' && size * zoom >= ARROW_MIN_PX) {
                // A triangle just beyond the face it points away from, tip outward.
                const base = way * (h + size * 0.2);
                const tip = base + way * size * 0.6;
                g.poly([-size / 2, base, size / 2, base, 0, tip]).fill({ color: style.stroke });
            }
        }
    }
    g.position.set(item.position[0], item.position[1]);
    g.rotation = item.angle;
    return g;
}

/** Logos in their own colours by SVG markup, baked once, longest side `ICON_TEXTURE_PX`. */
const logoTextures = new Map<string, Promise<Texture>>();

function logoTexture(svg: string): Promise<Texture> {
    let baking = logoTextures.get(svg);
    if (!baking) {
        baking = loadSvgImage(svg, ICON_TEXTURE_PX).then((image) => {
            const [, , width, height] = containIn(image, ICON_TEXTURE_PX);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width));
            canvas.height = Math.max(1, Math.round(height));
            canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
            return new Texture({
                source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true }),
            });
        });
        logoTextures.set(svg, baking);
    }
    return baking;
}

/** A host's logo centred on its position, fitted whole into `width` × `height` metres. */
function drawLogo(item: Extract<SceneItem, { type: 'logo' }>): Container {
    const holder = new Container();
    holder.position.set(item.position[0], item.position[1]);
    void logoTexture(item.svg).then(
        (texture) => {
            if (holder.destroyed) return;
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5);
            const scale = Math.min(item.width / texture.width, item.height / texture.height);
            // Image pixels grow downward; in the Y-up world that is −Y.
            sprite.scale.set(scale, -scale);
            holder.addChild(sprite);
        },
        () => {
            // A logo the browser cannot read leaves the Zone without one.
        },
    );
    return holder;
}

function drawLabel(item: Extract<SceneItem, { type: 'label' }>): BitmapText {
    const text = new BitmapText({
        text: item.lines.join('\n'),
        style: {
            fontFamily: LABEL_FONT,
            fontSize: LABEL_FONT_PX,
            // Only for wrapped names: it also moves a single line within its box.
            ...(item.lines.length > 1 && { lineHeight: LABEL_FONT_PX * LABEL_LINE_HEIGHT }),
            align: 'center',
            fill: item.style.fill ?? '#000000',
        },
    });
    text.anchor.set(0.5);
    text.alpha = item.style.opacity ?? 1;
    const scale = item.size / LABEL_FONT_PX;
    // Undo the world's Y flip so text reads normally.
    text.scale.set(scale, -scale);
    text.position.set(item.position[0], item.position[1]);
    return text;
}

function drawImage(item: Extract<SceneItem, { type: 'image' }>): Container {
    const holder = new Container();
    holder.position.set(item.position[0], item.position[1]);
    holder.rotation = item.rotation;
    holder.alpha = item.opacity;
    void Assets.load<Texture>(underlayAsset(item.src)).then(
        (texture) => {
            if (holder.destroyed) return;
            const sprite = new Sprite(texture);
            // Image pixels grow downward; in the Y-up world that is −Y.
            sprite.scale.set(item.scale, -item.scale);
            holder.addChild(sprite);
        },
        () => {
            // A missing image leaves the Underlay blank; the plan itself still renders.
        },
    );
    return holder;
}

/** Small screen-sized text for the rulers and the origin mark. */
function guideText(text: string, fill: string): BitmapText {
    return new BitmapText({
        text,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: RULER_FONT_PX, fill },
    });
}

// --- Drawing overlay items ---------------------------------------------------------------------

const MARKER_PX = 5;
const OVERLAY_LABEL_PX = 12;
const OVERLAY_LABEL_PADDING = 3;

function drawOverlayItem(item: OverlayItem, zoom: number): Container {
    switch (item.type) {
        case 'polygon':
            return drawPolygon(item.shape, item.style, zoom);
        case 'line': {
            const g = new Graphics();
            const [first, ...rest] = item.points;
            if (!first) return g;
            g.moveTo(first[0], first[1]);
            for (const p of rest) g.lineTo(p[0], p[1]);
            if (item.closed) g.closePath();
            g.stroke({
                color: item.style.stroke ?? '#000000',
                width: (item.style.strokeWidth ?? 1) / zoom,
            });
            return g;
        }
        case 'marker': {
            const g = new Graphics();
            const r = MARKER_PX / zoom;
            const [x, y] = item.position;
            if (item.kind === 'node') g.circle(x, y, r);
            else if (item.kind === 'vertex') g.rect(x - r, y - r, 2 * r, 2 * r);
            else if (item.kind === 'edge') g.poly([x, y + r, x + r, y, x, y - r, x - r, y]);
            else if (item.kind === 'angle') g.poly([x, y + r, x + r, y - r, x - r, y - r]);
            else
                g.moveTo(x - r, y)
                    .lineTo(x + r, y)
                    .moveTo(x, y - r)
                    .lineTo(x, y + r);
            if (item.kind !== 'grid' && item.style.fill) g.fill({ color: item.style.fill });
            g.stroke({
                color: item.style.stroke ?? '#000000',
                width: (item.style.strokeWidth ?? 1) / zoom,
            });
            return g;
        }
        case 'label': {
            // Screen-sized text on a light backing, so dimensions stay readable over the plan.
            const holder = new Container();
            const text = new BitmapText({
                text: item.text,
                style: {
                    fontFamily: 'system-ui, sans-serif',
                    fontSize: OVERLAY_LABEL_PX,
                    fill: '#1f3f73',
                },
            });
            text.anchor.set(0.5);
            const pad = OVERLAY_LABEL_PADDING;
            const backing = new Graphics()
                .roundRect(
                    -text.width / 2 - pad,
                    -text.height / 2 - pad,
                    text.width + 2 * pad,
                    text.height + 2 * pad,
                    3,
                )
                .fill({ color: '#ffffff', alpha: 0.9 })
                .stroke({ color: '#2f6fdb', width: 1, alpha: 0.5 });
            holder.addChild(backing, text);
            // One screen pixel per unit, and undo the world's Y flip.
            holder.scale.set(1 / zoom, -1 / zoom);
            holder.position.set(item.position[0], item.position[1]);
            return holder;
        }
    }
}
