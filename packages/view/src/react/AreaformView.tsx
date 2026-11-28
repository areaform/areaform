import type { AreaformDocument, ElementRef, Id } from '@areaform/core';
import type {
    AssetResolver,
    BackgroundEvent,
    ElementEvent,
    Gestures,
    HoverEvent,
    LabelResolver,
    Renderer,
    StyleResolver,
    Theme,
    WheelMode,
} from '@areaform/render-2d';
import type { Renderer3D } from '@areaform/render-3d';
import { useEffect, type Ref } from 'react';
import type { ViewMode } from '../controls.ts';
import type { Messages } from '../i18n/translator.ts';
import type { Motion } from '../motion.ts';
import type { PluginSource } from '../plugins.ts';
import type { ControlSize, View, ViewEvents } from '../view.ts';
import { HOLDER_STYLE, useView } from './useView.ts';

/** The language props every component takes. */
export interface LocaleProps {
    /**
     * The interface language as a BCP 47 tag: `en` (default), `pl`, `uk`, `ru`, or any other with
     * `messages`. Unrelated to the language of the Space's own labels.
     */
    locale?: string;
    /** Messages laid over the built-in ones: change any text, or translate into another language. */
    messages?: Partial<Messages>;
}

export interface AreaformViewProps extends LocaleProps {
    doc: AreaformDocument;
    /** Defaults to the Level at elevation 0 (the ground floor), else the lowest. */
    levelId?: Id;
    /**
     * The plan's look in 2D and 3D: category colours and icons, label sizes. Read when the view
     * mounts.
     */
    theme?: Theme;
    /**
     * A host's runtime look per Element (Style Overrides), e.g. booth status colours; never saved.
     * The 3D view applies it to Zones only. Keep it stable (`useCallback`).
     */
    styleResolver?: StyleResolver;
    /**
     * The Content Language to show the Space's text in, e.g. the visitor's: each Zone shows its
     * translation in the best offered match (`pl-PL` finds `pl`), else its label in the default
     * language. The interface `locale` when absent (ADR-0011).
     */
    contentLanguage?: string;
    /**
     * A host's runtime name and logo (SVG markup) per Zone, e.g. a booth's exhibitor, over the
     * Document's own; never saved. Keep it stable (`useCallback`): a new one redraws the plan.
     */
    labelResolver?: LabelResolver;
    /** Finds Underlay images by their `src`, e.g. files the host holds as `blob:` URLs. */
    resolveAsset?: AssetResolver;
    /** Elements drawn in the Theme's `highlight`, e.g. search results; in 3D, Zones only. */
    highlight?: ElementRef[];
    /** What scrolling does: `auto` (default) pans on a trackpad and zooms on a pinch or mouse wheel. */
    wheel?: WheelMode;
    /**
     * Who gets a plain wheel and one finger: the plan (`greedy`, default), or the page around it
     * (`cooperative`), where ⌘/Ctrl + wheel, a pinch or two fingers move the plan.
     */
    gestures?: Gestures;
    /**
     * The 3D camera moving on its own (default `none`): `orbit` turns it, `tour` flies through the
     * shown Level's Viewpoints. It stops on the first interaction or **Pause**; **Play** and
     * `motionResume` move it on.
     */
    motion?: Motion;
    /** Seconds without an interaction after which a stopped camera moves again (at least 5); off when absent. */
    motionResume?: number;
    /**
     * Seconds with nobody using the page after which `onIdle` is called (at least 5); off when
     * absent. For a Kiosk: answer with `reset()` on the View from `ref`.
     */
    idleAfter?: number;
    /** `large` buttons, cards and pins for a touch screen read standing up, such as a Kiosk. */
    controlSize?: ControlSize;
    /** Draw the Document's grid over the floor (default off). */
    grid?: boolean;
    /** Rulers in metres along the plan's top and left edges (default off). */
    rulers?: boolean;
    /** Mark the origin, 0/0, which all Levels share, with X and Y arrows (default off). */
    origin?: boolean;
    /**
     * Show **2D / 3D**, **Fit** and **Show grid** buttons in the plan's bottom-right corner (default
     * off). **Show grid** appears only with `onGridChange`, since the host owns `grid`. Read when
     * the view mounts.
     */
    controls?: boolean;
    /**
     * The Level names in the top-left corner for visitors to switch between, shown only with two or
     * more Levels (default off). A switch calls `onLevelChange`. Read when the view mounts.
     */
    levelSwitcher?: boolean;
    /** The view shown at the start (default `2d`). Read when the view mounts. */
    defaultView?: ViewMode;
    /** The view shown, when the host owns it; pair it with `onViewChange`. */
    view?: ViewMode;
    /** The views the user can switch between (default both); `['2d']` hides the switch. */
    views?: ViewMode[];
    /**
     * Plugins to start with, each as is or as `{ load: () => import(…) }`, e.g. `[tooltip()]`.
     * Read when the view mounts.
     */
    plugins?: PluginSource[];
    /** Called when the user switches between 2D and 3D. */
    onViewChange?: (view: ViewMode) => void;
    /** Called when the user picks another Level in the Level switcher. */
    onLevelChange?: (levelId: Id) => void;
    /** Called when the user presses **Show grid**, with the grid it asks for. */
    onGridChange?: (on: boolean) => void;
    onElementClick?: (e: ElementEvent) => void;
    onBackgroundClick?: (e: BackgroundEvent) => void;
    onElementHover?: (e: HoverEvent) => void;
    onZoomChange?: (zoom: number) => void;
    /**
     * Gets the View once it is made, for the camera driven by the page: `flyTo`, `lookAt`,
     * `setProgress`, `getCamera`, `setLevel`.
     */
    ref?: Ref<View | null>;
    /** A flight started with `flyTo` arrived: at a Viewpoint (its id) or at a camera (`id` null). */
    onViewpoint?: (e: ViewEvents['viewpoint']) => void;
    /** A visitor clicked a Zone: its id, its Level and its `data`. */
    onZoneClick?: (e: ViewEvents['zoneClick']) => void;
    /** The tour reached a Viewpoint and stays there a while. */
    onTourStep?: (e: ViewEvents['tourStep']) => void;
    /** Nobody used the page for `idleAfter` seconds. */
    onIdle?: (e: ViewEvents['idle']) => void;
    /** The View was put back as it opened with `reset()`. */
    onReset?: () => void;
    onReady?: (renderer: Renderer) => void;
    /** Called with the 3D renderer each time the 3D view is shown and ready. */
    onReady3d?: (renderer: Renderer3D) => void;
    /** The small "Made with Areaform" link in the bottom-left corner (default on); turn it off freely. */
    attribution?: boolean;
    /** A short line beside that link, e.g. a notice from the host. */
    attributionNote?: string;
}

const NONE: ElementRef[] = [];

/**
 * Read-only display of a Space for end users: pan, zoom, click, hover, highlight, and a 3D
 * preview of the Level to orbit around. A React wrapper over `createView`.
 */
export function AreaformView(props: AreaformViewProps) {
    const {
        doc,
        levelId,
        styleResolver,
        contentLanguage,
        labelResolver,
        resolveAsset,
        highlight,
        wheel,
        gestures,
        motion,
        motionResume,
        idleAfter,
        controlSize,
        grid,
        rulers,
        origin,
        view: shown,
        locale,
        messages,
    } = props;
    const { holder, view } = useView(
        {
            doc,
            ...(levelId !== undefined && { levelId }),
            ...(props.theme && { theme: props.theme }),
            ...(locale !== undefined && { locale }),
            ...(messages && { messages }),
            controls: props.controls ?? false,
            levelSwitcher: props.levelSwitcher ?? false,
            gridButton: !!props.onGridChange,
            ...((shown ?? props.defaultView) && { view: shown ?? props.defaultView! }),
            ...(props.views && { views: props.views }),
            ...(props.plugins && { plugins: props.plugins }),
            attribution: props.attribution ?? true,
            ...(props.attributionNote !== undefined && { attributionNote: props.attributionNote }),
        },
        {
            elementClick: props.onElementClick,
            backgroundClick: props.onBackgroundClick,
            elementHover: props.onElementHover,
            viewChange: props.onViewChange,
            levelChange: props.onLevelChange,
            gridChange: props.onGridChange,
            zoomChange: props.onZoomChange,
            viewpoint: props.onViewpoint,
            zoneClick: props.onZoneClick,
            tourStep: props.onTourStep,
            idle: props.onIdle,
            reset: props.onReset,
            ready: props.onReady,
            ready3d: props.onReady3d,
        },
        props.ref,
    );
    useEffect(
        () => view?.setAttribution(props.attribution ?? true, props.attributionNote),
        [view, props.attribution, props.attributionNote],
    );
    useEffect(() => view?.update(doc), [view, doc]);
    useEffect(() => {
        if (levelId !== undefined) view?.setLevel(levelId);
    }, [view, levelId]);
    useEffect(() => {
        if (shown) view?.setView(shown);
    }, [view, shown]);
    useEffect(() => view?.setStyleResolver(styleResolver), [view, styleResolver]);
    useEffect(() => view?.setLabelResolver(labelResolver), [view, labelResolver]);
    useEffect(() => view?.setAssetResolver(resolveAsset), [view, resolveAsset]);
    useEffect(() => view?.highlight(highlight ?? NONE), [view, highlight]);
    useEffect(() => view?.setLocale(locale, messages), [view, locale, messages]);
    useEffect(() => view?.setContentLanguage(contentLanguage), [view, contentLanguage]);
    useEffect(() => view?.setWheelMode(wheel ?? 'auto'), [view, wheel]);
    useEffect(() => view?.setGestures(gestures ?? 'greedy'), [view, gestures]);
    useEffect(() => view?.setMotion(motion ?? 'none'), [view, motion]);
    useEffect(() => view?.setMotionResume(motionResume), [view, motionResume]);
    useEffect(() => view?.setIdleAfter(idleAfter), [view, idleAfter]);
    useEffect(() => view?.setControlSize(controlSize ?? 'normal'), [view, controlSize]);
    useEffect(() => view?.setGrid(grid ?? false), [view, grid]);
    useEffect(() => view?.setRulers(rulers ?? false), [view, rulers]);
    useEffect(() => view?.setOrigin(origin ?? false), [view, origin]);
    return <div ref={holder} style={HOLDER_STYLE} />;
}
