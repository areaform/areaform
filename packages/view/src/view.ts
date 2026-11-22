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
    type ViewPreset,
} from '@areaform/render-3d';
import { createPlanControls, type PlanControls, type ViewMode } from './controls.ts';
import { createTranslator, type Messages, type Translator } from './i18n/translator.ts';
import { createLevelSwitcher, startingLevel, type LevelSwitcher } from './levelSwitcher.ts';
import { createGestureHint } from './gestureHint.ts';
import { createMotion, type Motion, type MotionState } from './motion.ts';
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
    /** The 2D renderer is ready. */
    ready: Renderer;
    /** A 3D renderer is ready, each time 3D is shown. */
    ready3d: Renderer3D;
}

export interface View {
    /** The View's root element, inside the container. */
    readonly element: HTMLElement;
    getDocument(): AreaformDocument;
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
    update(doc: AreaformDocument): void;
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
    /** The tour flies through the Viewpoints of the Level shown. */
    const followViewpoints = () =>
        motion.setViewpoints(doc.levels.find((l) => l.id === levelId)?.viewpoints ?? NO_VIEWPOINTS);
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
        r.on('elementClick', (e) => in2d() && emit('elementClick', e));
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
                r.on('elementClick', (e) => emit('elementClick', e));
                r.on('backgroundClick', (e) => emit('backgroundClick', e));
                r.on('elementHover', (e) => emit('elementHover', e));
                r.on('gestureHint', showHint);
                emit('ready3d', r);
                motion.attach(r);
            },
            () => {
                if (canvas3d !== holder) return;
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

    // --- Plugins -------------------------------------------------------------------------------

    const cleanups: (() => void)[] = [];

    const api: View = {
        element,
        getDocument: () => doc,
        getLevelId: () => levelId,
        getView: () => mode,
        getTranslator: () => i18n,
        getContentLanguage: shownLanguage,
        renderer: () => r2,
        renderer3d: () => r3,
        update(next) {
            const fresh = next.id !== doc.id;
            doc = next;
            if (!doc.levels.some((l) => l.id === levelId)) levelId = startingLevel(doc).id;
            r2?.update(doc);
            r2?.setLevel(levelId);
            if (fresh) r2?.fitLevel();
            r3?.update(doc);
            r3?.setLevel(levelId);
            followViewpoints();
            redrawSwitcher();
        },
        setLevel(id) {
            if (id === levelId) return;
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
            mode = next;
            if (next === '3d') show3d();
            else hide3d();
            controls?.update({ view: mode });
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
