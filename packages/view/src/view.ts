// The View (ADR-0012): a Space shown to visitors, in plain TypeScript so `embed.js` needs no
// framework. It mounts the 2D renderer, loads the 3D one when asked, draws the plan controls and
// forwards clicks and hovers from either; Plugins add the rest.
import type { AreaformDocument, ElementRef, Id, Vec2, Viewpoint } from '@areaform/core';
import {
    createRenderer,
    worldToScreen,
    type AssetResolver,
    type BackgroundEvent,
    type Camera,
    type ElementEvent,
    type GestureHint,
    type Gestures,
    type HoverEvent,
    type LabelResolver,
    type Renderer,
    type StyleResolver,
    type Theme,
    type WheelMode,
} from '@areaform/render-2d';
import {
    createRenderer3D,
    isWebGLAvailable,
    type Camera3D,
    type Renderer3D,
    type Theme3D,
    type Vec3,
    type ViewPreset,
} from '@areaform/render-3d';
import { createPlanControls, type PlanControls, type ViewMode } from './controls.ts';
import { createTranslator, type Messages, type Translator } from './i18n/translator.ts';
import { createLevelSwitcher, startingLevel, type LevelSwitcher } from './levelSwitcher.ts';
import { createGestureHint } from './gestureHint.ts';
import { createIdleTimer } from './idle.ts';
import { createMotion, onInteraction, type Motion, type MotionState } from './motion.ts';
import {
    camera3dOf2d,
    type CameraTarget,
    type FlightResult,
    type FlyToOptions,
    type LookAtOptions,
} from './pageCameraCore.ts';
import { createPlaceCard, type PlaceCard } from './placeCard.ts';
import type { PluginSource, ViewPlugin } from './plugins.ts';
import { rulersFor } from './units.ts';

export interface ViewOptions {
    doc: AreaformDocument;
    /** The Level shown; by default the one at elevation 0 (the ground floor), else the lowest. */
    levelId?: Id;
    /** The plan's look in 2D and 3D: category colours and icons, label sizes. Read at creation. */
    theme?: Theme;
    /** What only the 3D view has a look for. Read at creation. */
    theme3d?: Partial<Theme3D>;
    /** The top of doors and passages in 3D, metres (default 2.1). Read at creation. */
    doorHeight?: number;
    /** Zone names on the 3D floor (default on). Read at creation. */
    labels3d?: boolean;
    /** Walls near the 3D camera go down to a kerb (default on). Read at creation. */
    cutaway?: boolean;
    /** The sharpest the 3D canvas is drawn, device pixels per CSS pixel (default 2). Read at creation. */
    maxPixelRatio?: number;
    /** Where the 3D camera starts, e.g. one saved from `camera3dChange`. Read at creation. */
    camera3d?: Camera3D;
    /** A host's runtime look per Element (Style Overrides); in 3D, Zones only. */
    styleResolver?: StyleResolver;
    /** A host's runtime name and logo per Zone. */
    labelResolver?: LabelResolver;
    /** Finds Underlay images by their `src`. */
    resolveAsset?: AssetResolver;
    /** Elements drawn in the Theme's `highlight`; in 3D, Zones only. */
    highlight?: ElementRef[];
    /** The interface language (`en` by default) and messages laid over its texts. */
    locale?: string;
    messages?: Partial<Messages>;
    /** The Content Language for the Space's text; `locale` when absent (ADR-0011). */
    contentLanguage?: string;
    /** What scrolling does in 2D (default `auto`). */
    wheel?: WheelMode;
    /**
     * Who gets a plain wheel and one finger: the plan (`greedy`, default), or the page it is on
     * (`cooperative`), where ⌘/Ctrl + wheel, a pinch or two fingers move the plan and a short hint
     * says so (ADR-0025). For a plan on a page that scrolls.
     */
    gestures?: Gestures;
    /**
     * How the 3D camera moves on its own (default `none`): `orbit` turns it slowly, `tour` flies
     * through the Viewpoints of the Level shown (`orbit` without any). It starts once
     * 3D is ready, stops for good on the first interaction, pauses off screen and in a hidden tab,
     * and never moves under `prefers-reduced-motion`. 2D stays still.
     */
    motion?: Motion;
    /**
     * Seconds without an interaction after which motion that a touch of the plan stopped starts
     * again, at least 5; off by default. For a plan nobody reads for long, such as a Kiosk. It
     * never resumes after **Pause**, under reduced motion, or while a Plugin holds it
     * (`holdMotion`), such as Wayfinding showing a route.
     */
    motionResume?: number;
    /**
     * Seconds with nobody touching, clicking, typing or scrolling anywhere on the page, after
     * which the View sends `idle`, at least 5; off by default. It counts from the first touch and
     * sends once until the next. For a Kiosk: the host answers with `reset()`, perhaps after a
     * "Still here?" notice of its own.
     */
    idleAfter?: number;
    /**
     * How big the View's buttons, cards and pins are: `normal` (default), or `large` for a touch
     * screen read standing up, such as a Kiosk. The `af-large` class on the View's element.
     */
    controlSize?: ControlSize;
    /**
     * CSS pixels on the View's left that the host covers, e.g. with a card of text: the plan is
     * framed in the rest, the 3D camera turns around it, and the Level switcher and the badge
     * move right of it (default 0).
     */
    inset?: number;
    /** The grid over the floor in 2D (default off). */
    grid?: boolean;
    /** Rulers in metres along the 2D plan's edges (default off). */
    rulers?: boolean;
    /** The origin mark in 2D (default off). */
    origin?: boolean;
    /**
     * The Level names in the top-left corner for visitors to switch between, top floor first, one
     * button on a narrow View; shown only while the plan has two or more Levels (default off).
     */
    levelSwitcher?: boolean;
    /** The plan controls in the bottom-right corner (default off). */
    controls?: boolean;
    /** **Show grid** among the controls; a press emits `gridChange` and shows or hides the grid. */
    gridButton?: boolean;
    /** The view shown at the start (default `2d`); `3d` without WebGL 2 starts in 2D when it may. */
    view?: ViewMode;
    /** The views to switch between (default both); one hides the switch. */
    views?: ViewMode[];
    /** Plugins to start with, each as is or as a loader that imports it. */
    plugins?: PluginSource[];
    /**
     * A small "Made with Areaform" link in the bottom-left corner (default on), as Leaflet credits
     * itself; turn it off freely: the MIT licence does not require it.
     */
    attribution?: boolean;
    /** A short line beside that link, e.g. a notice from the host. */
    attributionNote?: string;
}

/** What `view.on(event, handler)` can listen to, and what each handler receives. */
export interface ViewEvents {
    elementClick: ElementEvent;
    backgroundClick: BackgroundEvent;
    elementHover: HoverEvent;
    /** The user switched between 2D and 3D. */
    viewChange: ViewMode;
    /**
     * Another Level is shown: picked in the Level switcher (which clears the highlight), or set
     * with `setLevel`, by the host or a Plugin (Wayfinding opens Here's Level).
     */
    levelChange: Id;
    /** The user pressed **Show grid**, with the grid it asks for. */
    gridChange: boolean;
    /** The 2D zoom changed, screen pixels per metre. */
    zoomChange: number;
    /** The 2D plan moved or zoomed, or the View changed size: anything drawn over it moves too. */
    camera2dChange: Camera;
    camera3dChange: Camera3D;
    /**
     * A flight the host started with `flyTo` arrived: at a Viewpoint (its `id`), or at a camera
     * (`id` null).
     */
    viewpoint: { id: Id | null; levelId: Id };
    /** A visitor clicked a Zone, in 2D or 3D: its id, its Level and its `data`. */
    zoneClick: { id: Id; levelId: Id; data: Record<string, unknown> | undefined };
    /** The tour (`motion: 'tour'`) reached a Viewpoint, `index` in its Level's list, and stays a while. */
    tourStep: { id: Id; levelId: Id; index: number };
    /** The 2D renderer is ready. */
    ready: Renderer;
    /** A 3D renderer is ready, each time 3D is shown. */
    ready3d: Renderer3D;
    /** Nobody used the page for `idleAfter` seconds. */
    idle: { seconds: number };
    /** `reset()` put the View back as it opened; Plugins go back to their start too. */
    reset: undefined;
    /**
     * Another Space is shown, an Inner Space a Plugin went into (`inner`), or the host's own again;
     * `levelChange` follows. Plugins keep what belongs to each Space apart, such as a route.
     */
    spaceChange: { doc: AreaformDocument; inner: boolean; unit?: InnerUnit };
}

/**
 * The unit an Inner Space is shown for: its Zone and Level on the host's plan, and whether the
 * shop's plan is laid into it by a fit, so the two share coordinates and one route can go in.
 */
export interface InnerUnit {
    zoneId: Id;
    levelId: Id;
    fitted: boolean;
}

/** How big the View's controls are: `large` for a touch screen read standing up. */
export type ControlSize = 'normal' | 'large';

export interface View {
    /** The View's root element, inside the container. */
    readonly element: HTMLElement;
    /** The Document shown: the host's own, or an Inner Space's while a Plugin shows one. */
    getDocument(): AreaformDocument;
    /** The host's own Document, the one `update` gives, even while an Inner Space is shown. */
    getHomeDocument(): AreaformDocument;
    getLevelId(): Id;
    /** The view shown now. */
    getView(): ViewMode;
    /** The interface translator, e.g. for a Plugin's texts. */
    getTranslator(): Translator;
    /** The Content Language the Space's text is shown in, if any. */
    getContentLanguage(): string | undefined;
    /** The 2D renderer once ready, and the 3D one while 3D is shown. */
    renderer(): Renderer | null;
    renderer3d(): Renderer3D | null;
    /** The host's own Document changed; shown at once, or once back from an Inner Space. */
    update(doc: AreaformDocument): void;
    /**
     * Shows another Space's Document in place of the host's own, an Inner Space (Inner Space, CONTEXT.md), on
     * `levelId` or its starting Level; `null` shows the host's own again, on `levelId` or the
     * Level it was on. Sends `spaceChange`. For a Plugin: the host's `update` still goes to its own.
     */
    showSpace(doc: AreaformDocument | null, levelId?: Id, unit?: InnerUnit): void;
    /** Buttons other Plugins add to the place card, which Wayfinding shows (Inner Space, CONTEXT.md). */
    readonly placeCard: PlaceCard;
    setLevel(levelId: Id): void;
    setView(view: ViewMode): void;
    setStyleResolver(resolver: StyleResolver | undefined): void;
    setLabelResolver(resolver: LabelResolver | undefined): void;
    setAssetResolver(resolver: AssetResolver | undefined): void;
    highlight(refs: ElementRef[]): void;
    setLocale(locale: string | undefined, messages?: Partial<Messages>): void;
    setContentLanguage(language: string | undefined): void;
    setWheelMode(mode: WheelMode): void;
    setGestures(gestures: Gestures): void;
    /** Starts or stops the camera moving on its own; asking again turns one the visitor stopped. */
    setMotion(motion: Motion): void;
    /** Seconds of idle time after which motion stopped by a touch starts again, or off. */
    setMotionResume(seconds: number | undefined): void;
    /**
     * Holds auto-resume while `reason` is on: a Plugin showing something the visitor reads, such
     * as a route or a place card. The idle time counts again once nothing holds it.
     */
    holdMotion(reason: string, on: boolean): void;
    /** Seconds with nobody using the page after which `idle` is sent, or off. */
    setIdleAfter(seconds: number | undefined): void;
    setControlSize(size: ControlSize): void;
    /**
     * Puts the View back as it opened, for the next visitor: its first Level and view, the
     * highlight it was given, the plan fitted, and the camera's motion from the start, even after
     * **Pause**, the host's own Space again when an Inner Space is shown. Then sends `reset`, on
     * which Wayfinding clears the route and goes back to its Here. The host's own state, such as
     * a search box, is the host's to clear.
     */
    reset(): void;
    /** CSS pixels on the View's left that the host covers, as the `inset` option. */
    setInset(left: number): void;
    setGrid(on: boolean): void;
    setRulers(on: boolean): void;
    setOrigin(on: boolean): void;
    /** Shows or hides the "Made with Areaform" link, with an optional line beside it. */
    setAttribution(on: boolean, note?: string): void;
    /** Frames the whole Level in the view shown. */
    fit(): void;
    /** In 3D, looks from a named angle. */
    setViewAngle(angle: ViewPreset): void;
    /**
     * Flies the camera to a Viewpoint, by its id, or to a camera as `getCamera` gives it, showing
     * its Level first. In 2D the plan pans and zooms there instead. Resolves on arrival, then the
     * `viewpoint` event follows; resolves `{ interrupted: true }` when the visitor took the plan on
     * the way, or the page moved the camera again. Rejects an id this plan has no Viewpoint for.
     * Under `prefers-reduced-motion` the camera is there at once.
     */
    flyTo(to: CameraTarget, options?: FlyToOptions): Promise<FlightResult>;
    /**
     * Turns the camera to a Zone, by its id, showing its Level first, or to a plan point (metres)
     * on the Level shown. A small Zone brings the camera closer along its line of sight and one
     * too big to fit sends it back (`ZONE_SHARE`); `distance` says how far to end up. In 2D the
     * plan pans there and zooms by the same rule. Resolves as `flyTo` does.
     */
    lookAt(to: Id | Vec2, options?: LookAtOptions): Promise<FlightResult>;
    /**
     * Puts the camera `t` of the way along the shown Level's Viewpoints in tour order, 0 at the
     * first and 1 at the last, for a scroll library to drive: no flight, no events. Called before
     * the view is ready, it waits for it.
     */
    setProgress(t: number): void;
    /**
     * Where the camera is, in the 3D view's coordinates; in 2D a camera straight above the plan's
     * middle, as high as its zoom. Null before the view is ready. `flyTo` takes it back.
     */
    getCamera(): Camera3D | null;
    /**
     * Where a plan point (metres) at `height` above the floor is on the View, CSS pixels from its
     * top-left corner, in the view shown; null when it is not in view yet or behind the 3D camera.
     */
    toScreen(point: Vec2, height?: number): Vec2 | null;
    on<E extends keyof ViewEvents>(event: E, handler: (e: ViewEvents[E]) => void): () => void;
    /** Starts a Plugin; resolves once it is loaded and running. */
    use(plugin: PluginSource): Promise<void>;
    destroy(): void;
}

const BOTH: ViewMode[] = ['2d', '3d'];

/** The camera driven by the page, loaded on its first move: most pages never move it. */
type PageCamera = typeof import('./pageCamera.ts');
let pageCamera: PageCamera | null = null;
let pageCameraLoading: Promise<PageCamera> | null = null;
const loadPageCamera = () =>
    (pageCameraLoading ??= import('./pageCamera.ts').then(
        (module) => (pageCamera = module),
        (error: unknown) => {
            // A failed download is tried again on the next call.
            pageCameraLoading = null;
            throw error;
        },
    ));

/** Seconds `lookAt` takes to turn the camera, unless told. */
const LOOK_SECONDS = 1.5;

/** One empty list, so a Level without Viewpoints never looks like a new tour. */
const NO_VIEWPOINTS: Viewpoint[] = [];

/** Where the attribution link goes. */
const ATTRIBUTION_URL = 'https://areaform.app';

/** Shows a Space in `container`: the 2D plan, a 3D view on demand, and the plan controls. */
export function createView(container: HTMLElement, options: ViewOptions): View {
    let doc = options.doc;
    let levelId = options.levelId ?? startingLevel(doc).id;
    let locale = options.locale;
    let messages = options.messages;
    let i18n = createTranslator(locale, messages);
    let contentLanguage = options.contentLanguage;
    let styleResolver = options.styleResolver;
    let labelResolver = options.labelResolver;
    let assetResolver = options.resolveAsset;
    let highlighted = options.highlight ?? [];
    let wheel = options.wheel ?? 'auto';
    let gestures: Gestures = options.gestures ?? 'greedy';
    let inset = options.inset ?? 0;
    const applyInset = () => element.style.setProperty('--af-inset-left', `${inset}px`);
    let grid = options.grid ?? false;
    let rulers = options.rulers ?? false;
    let origin = options.origin ?? false;
    const views = options.views ?? BOTH;
    let mode: ViewMode = views.includes(options.view ?? '2d') ? (options.view ?? '2d') : views[0]!;
    let camera3d = options.camera3d;
    /** How the View opened, for `reset`. */
    const startLevel = levelId;
    const startHighlight = highlighted;
    let destroyed = false;

    const listeners = new Map<keyof ViewEvents, Set<(e: never) => void>>();
    const emit = <E extends keyof ViewEvents>(event: E, payload: ViewEvents[E]) => {
        for (const handler of listeners.get(event) ?? [])
            (handler as (e: ViewEvents[E]) => void)(payload);
    };
    const shownLanguage = () => contentLanguage ?? locale;

    const element = document.createElement('div');
    element.className = 'af-view';
    const canvas2d = document.createElement('div');
    canvas2d.className = 'af-canvas';
    const overlay = document.createElement('div');
    overlay.className = 'af-overlay';
    element.append(canvas2d, overlay);
    container.append(element);
    applyInset();
    const applyControlSize = (size: ControlSize | undefined) =>
        element.classList.toggle('af-large', size === 'large');
    applyControlSize(options.controlSize);

    // Cooperative gestures: a hint when a gesture went to the page.
    const hint = createGestureHint(element, () => i18n);
    const showHint = (kind: GestureHint) => hint.show(kind, mode);

    // Made further down; the motion reports to it from the start, so it is declared here.
    let controls: PlanControls | null = null;
    let motionKind: Motion = options.motion ?? 'none';
    /** Whether the camera moves, as the motion last said: for the Play/Pause toggle. */
    let motionState: MotionState = 'still';
    /** What the toggle shows; none for a camera that never moves. */
    const toggleState = () => (motionKind === 'none' ? null : motionState);
    const motion = createMotion(element, {
        motion: motionKind,
        gestures: () => gestures,
        ...(options.motionResume !== undefined && { resumeAfter: options.motionResume }),
        onChange: (state) => {
            motionState = state;
            controls?.update({ motion: toggleState() });
        },
    });
    /** The Viewpoints of the Level shown, in tour order. */
    const shownViewpoints = () =>
        doc.levels.find((l) => l.id === levelId)?.viewpoints ?? NO_VIEWPOINTS;
    /** The tour flies through the Viewpoints of the Level shown. */
    const followViewpoints = () => motion.setViewpoints(shownViewpoints());
    followViewpoints();

    // --- 2D: always mounted, so the plan keeps its pan and zoom across a visit to 3D -----------

    let r2: Renderer | null = null;
    const in2d = () => mode === '2d';
    void createRenderer({
        container: canvas2d,
        interaction: 'view',
        wheel,
        gestures,
        grid,
        rulers: rulers ? rulersFor('metric', i18n) : null,
        origin,
        ...(options.theme && { theme: options.theme }),
    }).then((r) => {
        if (destroyed) return r.destroy();
        r2 = r;
        r.on('elementClick', (e) => {
            if (!in2d()) return;
            emit('elementClick', e);
            zoneClicked(e);
        });
        r.on('backgroundClick', (e) => in2d() && emit('backgroundClick', e));
        r.on('elementHover', (e) => in2d() && emit('elementHover', e));
        r.on('cameraChange', (c) => {
            emit('camera2dChange', c);
            emit('zoomChange', c.zoom);
        });
        r.on('gestureHint', (h) => in2d() && showHint(h));
        r.setStyleResolver(styleResolver);
        r.setLabelResolver(labelResolver);
        r.setContentLanguage(shownLanguage());
        r.setAssetResolver(assetResolver);
        r.setInset(inset);
        r.highlight(highlighted);
        r.update(doc);
        r.setLevel(levelId);
        r.fitLevel();
        // Opened in 3D: the plan underneath waits, undrawn, for a switch to 2D.
        if (!in2d()) r.setPaused(true);
        emit('ready', r);
        rendererReady();
    });

    // --- 3D: created when shown, its camera kept for the next visit ----------------------------

    let r3: Renderer3D | null = null;
    let canvas3d: HTMLElement | null = null;
    const canShow3d = isWebGLAvailable();
    const show3d = () => {
        // The 3D canvas, or its message when 3D fails, covers the plan: stop drawing it meanwhile.
        r2?.setPaused(true);
        const holder = document.createElement('div');
        holder.className = 'af-canvas af-canvas-3d';
        canvas3d = holder;
        element.insertBefore(holder, overlay);
        createRenderer3D({
            container: holder,
            ...(options.theme && { theme: options.theme }),
            ...(options.theme3d && { theme3d: options.theme3d }),
            ...(options.doorHeight !== undefined && { doorHeight: options.doorHeight }),
            ...(options.labels3d !== undefined && { labels: options.labels3d }),
            ...(options.cutaway !== undefined && { cutaway: options.cutaway }),
            ...(options.maxPixelRatio !== undefined && { maxPixelRatio: options.maxPixelRatio }),
            gestures,
            inset,
            ...(labelResolver && { labelResolver }),
            ...(styleResolver && { styleResolver }),
            ...(shownLanguage() !== undefined && { contentLanguage: shownLanguage()! }),
        }).then(
            (r) => {
                if (canvas3d !== holder) return r.destroy(); // left 3D before it was ready
                r3 = r;
                r.update(doc);
                r.setLevel(levelId);
                r.highlight(highlighted);
                if (camera3d) r.setCamera(camera3d);
                r.on('cameraChange', (c) => {
                    camera3d = c;
                    emit('camera3dChange', c);
                });
                r.on('elementClick', (e) => {
                    emit('elementClick', e);
                    zoneClicked(e);
                });
                r.on('backgroundClick', (e) => emit('backgroundClick', e));
                r.on('elementHover', (e) => emit('elementHover', e));
                r.on('gestureHint', showHint);
                r.on('tourStep', (viewpoint) => {
                    const index = shownViewpoints().findIndex((v) => v.id === viewpoint.id);
                    emit('tourStep', { id: viewpoint.id, levelId, index });
                });
                emit('ready3d', r);
                motion.attach(r);
                rendererReady();
            },
            () => {
                if (canvas3d !== holder) return;
                // Nothing to move: a flight waiting for 3D ends.
                wake(false);
                holder.classList.add('af-canvas-message');
                holder.setAttribute('role', 'status');
                holder.textContent = i18n.t('plan.no3dMessage');
            },
        );
    };
    const hide3d = () => {
        motion.attach(null);
        if (r3) camera3d = r3.getCamera();
        r3?.destroy();
        r3 = null;
        canvas3d?.remove();
        canvas3d = null;
        if (!destroyed) r2?.setPaused(false);
    };
    // Without WebGL 2 the 3D button is greyed out, so a plan asked to start in 3D starts in 2D,
    // unless 2D is not one of its views; then it shows the 3D view's message.
    if (mode === '3d' && !canShow3d && views.includes('2d')) mode = '2d';
    if (mode === '3d') show3d();
    const startMode = mode;

    // --- Idle, for a Kiosk -----------------------------------------------------------------------

    const idle = createIdleTimer(
        element.ownerDocument,
        (seconds) => emit('idle', { seconds }),
        options.idleAfter,
    );

    // --- Controls ------------------------------------------------------------------------------

    if (options.controls) {
        controls = createPlanControls(
            {
                ...(views.length > 1 && {
                    onViewChange: (next) => {
                        if (next === mode) return;
                        api.setView(next);
                        // The visitor chose 3D: its motion plays once it is ready.
                        if (next === '3d') motion.restart();
                        emit('viewChange', next);
                    },
                }),
                ...(options.gridButton && {
                    onToggleGrid: () => {
                        api.setGrid(!grid);
                        emit('gridChange', grid);
                    },
                }),
                onViewAngle: (angle) => r3?.setView(angle),
                onFit: () => api.fit(),
                onMotionToggle: () => (motion.running() ? motion.pause() : motion.play()),
            },
            { view: mode, canShow3d, grid, motion: toggleState() },
            i18n,
        );
        element.append(controls.element);
    }

    // --- Level switcher ------------------------------------------------------------------------

    let levelSwitcher: LevelSwitcher | null = null;
    const switcherState = () => ({ doc, levelId, language: shownLanguage(), i18n });
    if (options.levelSwitcher) {
        levelSwitcher = createLevelSwitcher((id) => {
            if (id === levelId) return;
            api.highlight([]);
            api.setLevel(id);
            // The visitor chose this Level: its tour, or the turn, plays from here. A Level set by
            // code, such as Wayfinding following a route, leaves the motion as it is.
            motion.restart();
        }, switcherState());
        element.append(levelSwitcher.element);
    }
    const redrawSwitcher = () => levelSwitcher?.update(switcherState());

    // --- Attribution ---------------------------------------------------------------------------

    let attribution: HTMLElement | null = null;
    let attributionOn = options.attribution ?? true;
    let attributionNote = options.attributionNote;
    const drawAttribution = () => {
        attribution?.remove();
        attribution = null;
        if (!attributionOn) return;
        attribution = document.createElement('div');
        attribution.className = 'af-attribution';
        const link = document.createElement('a');
        link.href = ATTRIBUTION_URL;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = i18n.t('attribution.madeWith');
        attribution.append(link);
        if (attributionNote) {
            const note = document.createElement('span');
            note.textContent = attributionNote;
            attribution.append(note);
        }
        element.append(attribution);
    };
    drawAttribution();

    // --- The camera driven by the page ----------------------------------------------------------

    /** Calls waiting for the view shown to be ready, each told whether it is. */
    const waiting: ((ready: boolean) => void)[] = [];
    const shownRenderer = () => (mode === '3d' ? r3 : r2);
    const whenShown = (): Promise<boolean> =>
        shownRenderer() ? Promise.resolve(true) : new Promise((resolve) => waiting.push(resolve));
    /** Tells waiting calls the view is ready, or with `false` that it never will be. */
    const wake = (ready = true) => {
        if (ready && !shownRenderer()) return;
        for (const resolve of waiting.splice(0)) resolve(ready);
    };
    /** Each move the page starts gets the next number; an older one still waiting gives way. */
    let pageMoves = 0;
    let flight2d: { frame: number; done: (arrived: boolean) => void } | null = null;
    /** Ends the page's flight where it is, in either view: its Promise says it was interrupted. */
    const stopPageMove = () => {
        r3?.stopFlight();
        const ended = flight2d;
        flight2d = null;
        if (ended) {
            cancelAnimationFrame(ended.frame);
            ended.done(false);
        }
    };
    // The visitor wins: a drag, a zoom, a tap or a key stops what the page started, a call still
    // waiting for the view to be ready included.
    const unlistenPage = onInteraction(
        element,
        () => gestures,
        () => {
            pageMoves += 1;
            stopPageMove();
        },
    );
    /** Pans and zooms the 2D plan there over `seconds`; true on arrival. */
    const fly2d = (
        { camera2dAt }: PageCamera,
        to: { center: Vec2; zoom: number },
        seconds: number,
    ) =>
        new Promise<boolean>((resolve) => {
            const r = r2;
            if (!r) return resolve(false);
            const from = r.getCamera();
            const start = performance.now();
            const move = { frame: 0, done: resolve };
            flight2d = move;
            const step = (now: number) => {
                if (flight2d !== move) return;
                const t = seconds > 0 ? Math.min(1, (now - start) / 1000 / seconds) : 1;
                // The View may change size on the way: the plan keeps the viewport it has now.
                r.setCamera({ ...camera2dAt(from, to, t), viewport: r.getCamera().viewport });
                if (t < 1) move.frame = requestAnimationFrame(step);
                else {
                    flight2d = null;
                    resolve(true);
                }
            };
            step(start);
        });
    /** A flight's time; none under `prefers-reduced-motion`. */
    const flightTime = (seconds: number) =>
        globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 0
            : Math.max(0, seconds);
    /**
     * The page takes the camera: what it or the motion was doing stops at once, and the move gets
     * its number. A visitor's gesture or a newer call while the camera's code loads ends it.
     */
    const claimCamera = () => {
        stopPageMove();
        motion.stop();
        return ++pageMoves;
    };
    /**
     * The move numbered `mine` shows `levelTo` and `go` moves the camera once the view is ready,
     * unless a newer call or the visitor came meanwhile.
     */
    const takeCamera = async (
        mine: number,
        levelTo: Id,
        go: () => Promise<boolean>,
    ): Promise<FlightResult> => {
        if (mine !== pageMoves || destroyed) return { interrupted: true };
        if (levelTo !== levelId) api.setLevel(levelTo);
        if (!(await whenShown()) || mine !== pageMoves || destroyed) return { interrupted: true };
        return { interrupted: !(await go()) };
    };
    /** Where `setProgress` put the camera, until the view shown is ready to be put there. */
    let progress: number | null = null;
    const applyProgress = () => {
        if (progress === null || !pageCamera) return;
        const { poseAlong, cameraOfPose, camera2dAt, camera2dOf } = pageCamera;
        const pose = poseAlong(shownViewpoints(), progress);
        if (!pose) return void (progress = null);
        const camera = cameraOfPose(pose, levelId);
        if (mode === '3d' && r3) r3.setCamera(camera);
        else if (mode === '2d' && r2) {
            const now = r2.getCamera();
            r2.setCamera(camera2dAt(now, camera2dOf(camera, now.viewport.height), 1));
        } else return;
        progress = null;
    };
    /** A renderer became ready: calls waiting for it go on. */
    const rendererReady = () => {
        wake();
        applyProgress();
    };
    /** A click on a Zone, told with its `data`. */
    const zoneClicked = ({ ref }: ElementEvent) => {
        if (ref.kind !== 'zone') return;
        const zone = doc.levels
            .find((l) => l.id === ref.levelId)
            ?.zones.find((z) => z.id === ref.id);
        emit('zoneClick', { id: ref.id, levelId: ref.levelId, data: zone?.data });
    };

    // --- Plugins -------------------------------------------------------------------------------

    const cleanups: (() => void)[] = [];

    /** The host's own Document; `doc` is another while an Inner Space is shown. */
    let home = doc;
    /** The host's Level to come back to from an Inner Space. */
    let homeLevel = levelId;
    /** Shows `next` in both renderers, keeping the Level when it has it. */
    const show = (next: AreaformDocument, level?: Id) => {
        const fresh = next.id !== doc.id;
        doc = next;
        const shown = levelId;
        if (level && doc.levels.some((l) => l.id === level)) levelId = level;
        else if (!doc.levels.some((l) => l.id === levelId)) levelId = startingLevel(doc).id;
        r2?.update(doc);
        r2?.setLevel(levelId);
        // Another Space is framed whole in 2D; the 3D camera stays, for whoever moved it there.
        if (fresh) r2?.fitLevel();
        r3?.update(doc);
        r3?.setLevel(levelId);
        followViewpoints();
        redrawSwitcher();
        return shown;
    };
    const placeCard = createPlaceCard();

    const api: View = {
        element,
        placeCard,
        getDocument: () => doc,
        getHomeDocument: () => home,
        getLevelId: () => levelId,
        getView: () => mode,
        getTranslator: () => i18n,
        getContentLanguage: shownLanguage,
        renderer: () => r2,
        renderer3d: () => r3,
        update(next) {
            const inside = doc !== home;
            home = next;
            // Inside an Inner Space the host's plan waits until the visitor comes back out.
            if (inside) return;
            const shown = show(next);
            // The Level shown is gone from the plan: another is shown, and the host is told.
            if (levelId !== shown) emit('levelChange', levelId);
        },
        showSpace(next, level, unit) {
            const inner = next !== null && next !== home;
            if ((next ?? home) === doc) return;
            stopPageMove();
            if (inner && doc === home) homeLevel = levelId;
            const shown = show(next ?? home, level ?? (inner ? undefined : homeLevel));
            emit('spaceChange', { doc, inner, ...(inner && unit && { unit }) });
            if (levelId !== shown) emit('levelChange', levelId);
        },
        setLevel(id) {
            if (id === levelId) return;
            stopPageMove();
            levelId = id;
            r2?.setLevel(id);
            r2?.fitLevel();
            r3?.setLevel(id);
            r3?.fitLevel();
            followViewpoints();
            redrawSwitcher();
            emit('levelChange', id);
        },
        setView(next) {
            if (next === mode || !views.includes(next) || (next === '3d' && !canShow3d)) return;
            // A flight in the view being left ends there; a call waiting for a view goes on in this one.
            stopPageMove();
            mode = next;
            if (next === '3d') show3d();
            else hide3d();
            controls?.update({ view: mode });
            wake();
        },
        setStyleResolver(resolver) {
            styleResolver = resolver;
            r2?.setStyleResolver(resolver);
            r3?.setStyleResolver(resolver);
        },
        setLabelResolver(resolver) {
            if (resolver === labelResolver) return;
            labelResolver = resolver;
            r2?.setLabelResolver(resolver);
            r3?.setLabelResolver(resolver);
        },
        setAssetResolver(resolver) {
            assetResolver = resolver;
            r2?.setAssetResolver(resolver);
        },
        highlight(refs) {
            highlighted = refs;
            r2?.highlight(refs);
            r3?.highlight(refs);
        },
        setLocale(nextLocale, nextMessages) {
            if (nextLocale === locale && nextMessages === messages) return;
            locale = nextLocale;
            messages = nextMessages;
            i18n = createTranslator(locale, messages);
            controls?.setTranslator(i18n);
            drawAttribution();
            redrawSwitcher();
            if (rulers) r2?.setRulers(rulersFor('metric', i18n));
            // Without its own, the Content Language follows the interface's.
            if (contentLanguage === undefined) {
                r2?.setContentLanguage(locale);
                r3?.setContentLanguage(locale);
            }
        },
        setContentLanguage(language) {
            contentLanguage = language;
            r2?.setContentLanguage(shownLanguage());
            r3?.setContentLanguage(shownLanguage());
            redrawSwitcher();
        },
        setWheelMode(next) {
            wheel = next;
            r2?.setWheelMode(next);
        },
        setGestures(next) {
            gestures = next;
            r2?.setGestures(next);
            r3?.setGestures(next);
        },
        setMotion(next) {
            motionKind = next;
            motion.setMotion(next);
            controls?.update({ motion: toggleState() });
        },
        setMotionResume(seconds) {
            motion.setResumeAfter(seconds);
        },
        holdMotion(reason, on) {
            motion.hold(reason, on);
        },
        setIdleAfter(seconds) {
            idle.set(seconds);
        },
        setControlSize(size) {
            applyControlSize(size);
        },
        reset() {
            if (destroyed) return;
            // A flight or a `setProgress` the page started ends here.
            stopPageMove();
            pageMoves += 1;
            progress = null;
            camera3d = options.camera3d;
            // A Kiosk always starts again on its own Space, not the shop a visitor went into.
            api.showSpace(null, startLevel);
            api.highlight(startHighlight);
            api.setView(startMode);
            if (levelId !== startLevel) api.setLevel(startLevel);
            r2?.fitLevel();
            if (r3) {
                if (camera3d) r3.setCamera(camera3d);
                else r3.fitLevel();
            }
            motion.reset();
            emit('reset', undefined);
        },
        setInset(left) {
            if (left === inset) return;
            inset = left;
            applyInset();
            r2?.setInset(left);
            r2?.fitLevel();
            r3?.setInset(left);
        },
        setGrid(on) {
            grid = on;
            r2?.setGrid(on);
            controls?.update({ grid: on });
        },
        setRulers(on) {
            rulers = on;
            r2?.setRulers(on ? rulersFor('metric', i18n) : null);
        },
        setOrigin(on) {
            origin = on;
            r2?.setOrigin(on);
        },
        setAttribution(on, note) {
            attributionOn = on;
            attributionNote = note;
            drawAttribution();
        },
        fit() {
            if (mode === '3d') r3?.fitLevel();
            else r2?.fitLevel();
        },
        setViewAngle(angle) {
            r3?.setView(angle);
        },
        async flyTo(to, options = {}) {
            const mine = claimCamera();
            const pc = await loadPageCamera();
            const { findViewpoint, cameraOfPose, camera2dOf, DEFAULT_FLIGHT } = pc;
            let levelTo = levelId;
            let camera: Pick<Camera3D, 'position' | 'target'>;
            let id: Id | null = null;
            let seconds = options.seconds;
            if (typeof to === 'string') {
                const found = findViewpoint(doc, to);
                if (!found) throw new Error(`Areaform: no Viewpoint "${to}" in this plan`);
                levelTo = found.levelId;
                id = to;
                camera = cameraOfPose(found.viewpoint, found.levelId);
                seconds ??= found.viewpoint.flight;
            } else {
                if (to.levelId && doc.levels.some((l) => l.id === to.levelId)) levelTo = to.levelId;
                camera = to;
            }
            const time = flightTime(seconds ?? DEFAULT_FLIGHT);
            return takeCamera(mine, levelTo, () => {
                if (mode === '3d' && r3) return r3.flyTo(camera, { seconds: time });
                if (mode === '2d' && r2)
                    return fly2d(pc, camera2dOf(camera, r2.getCamera().viewport.height), time);
                return Promise.resolve(false);
            }).then((result) => {
                if (!result.interrupted) emit('viewpoint', { id, levelId });
                return result;
            });
        },
        async lookAt(to, options = {}) {
            const mine = claimCamera();
            const pc = await loadPageCamera();
            const {
                findZone,
                cameraDistance,
                distanceToShow,
                positionAtDistance,
                zoomAtDistance,
                zoomToShow,
            } = pc;
            let levelTo = levelId;
            let point: Vec2;
            let size: Vec2 | null = null;
            if (typeof to === 'string') {
                const zone = findZone(doc, to);
                if (!zone) throw new Error(`Areaform: no Zone "${to}" in this plan`);
                ({ center: point, size, levelId: levelTo } = zone);
            } else point = to;
            const time = flightTime(options.seconds ?? LOOK_SECONDS);
            return takeCamera(mine, levelTo, () => {
                if (mode === '3d' && r3) {
                    const { position } = r3.getCamera();
                    const target: Vec3 = [point[0], 0, -point[1]];
                    const now = cameraDistance({ position, target });
                    const viewport = { width: element.clientWidth, height: element.clientHeight };
                    const distance =
                        options.distance ?? (size ? distanceToShow(size, now, viewport) : now);
                    return r3.flyTo(
                        { position: positionAtDistance(position, target, distance), target },
                        { seconds: time, path: 'line' },
                    );
                }
                if (mode === '2d' && r2) {
                    const now = r2.getCamera();
                    const zoom =
                        options.distance !== undefined
                            ? zoomAtDistance(options.distance, now.viewport.height)
                            : size
                              ? zoomToShow(now, size)
                              : now.zoom;
                    return fly2d(pc, { center: point, zoom }, time);
                }
                return Promise.resolve(false);
            });
        },
        setProgress(t) {
            stopPageMove();
            pageMoves += 1;
            motion.stop();
            progress = t;
            if (pageCamera) return applyProgress();
            loadPageCamera().then(
                () => !destroyed && applyProgress(),
                () => {}, // offline: the next call tries again
            );
        },
        getCamera() {
            if (mode === '3d') return r3?.getCamera() ?? null;
            return r2 ? camera3dOf2d(r2.getCamera(), levelId) : null;
        },
        toScreen(point, height = 0) {
            if (mode === '3d') return r3?.toScreen(point, height) ?? null;
            return r2 ? worldToScreen(r2.getCamera(), point) : null;
        },
        on(event, handler) {
            const set = listeners.get(event) ?? new Set();
            set.add(handler as (e: never) => void);
            listeners.set(event, set);
            return () => set.delete(handler as (e: never) => void);
        },
        async use(source) {
            const loaded = await loadPlugin(source);
            if (destroyed) return;
            const cleanup = loaded({ view: api, overlay, i18n: api.getTranslator() });
            if (cleanup) cleanups.push(cleanup);
        },
        destroy() {
            destroyed = true;
            stopPageMove();
            unlistenPage();
            idle.destroy();
            wake(false);
            for (const cleanup of cleanups.splice(0)) cleanup();
            hide3d();
            motion.destroy();
            hint.destroy();
            r2?.destroy();
            r2 = null;
            controls?.destroy();
            listeners.clear();
            element.remove();
        },
    };
    for (const plugin of options.plugins ?? []) void api.use(plugin);
    return api;
}

/** A Plugin given as is, or imported through its loader. */
async function loadPlugin(source: PluginSource): Promise<ViewPlugin> {
    if (typeof source === 'function') return source;
    const loaded = await source.load();
    return typeof loaded === 'function' ? loaded : loaded.default;
}
