import type { AreaformDocument, ElementRef, Id } from '@areaform/core';
import type {
    BackgroundEvent,
    ElementEvent,
    Gestures,
    HoverEvent,
    LabelResolver,
    StyleResolver,
    Theme,
} from '@areaform/render-2d';
import type { Camera3D, Renderer3D, Theme3D } from '@areaform/render-3d';
import { useEffect, type Ref } from 'react';
import type { Motion } from '../motion.ts';
import type { PluginSource } from '../plugins.ts';
import type { View, ViewEvents } from '../view.ts';
import type { LocaleProps } from './AreaformView.tsx';
import { HOLDER_STYLE, useView } from './useView.ts';

export interface Areaform3DViewProps extends LocaleProps {
    doc: AreaformDocument;
    /** Defaults to the Level at elevation 0 (the ground floor), else the lowest. */
    levelId?: Id;
    /** The 2D Theme, for the colours of Zones, Obstacles and Openings. */
    theme?: Theme;
    /** What only the 3D view has a look for: background, floor, Walls, Stops, label colour. */
    theme3d?: Partial<Theme3D>;
    /** Height of the top of doors and passages, metres (default 2.1). */
    doorHeight?: number;
    /**
     * A host's runtime name and logo (SVG markup) per Zone, e.g. a booth's exhibitor, over the
     * Document's own; never saved. Keep it stable (`useCallback`): a new one redraws the plan.
     */
    labelResolver?: LabelResolver;
    /**
     * The Content Language to show the Space's text in, e.g. the visitor's: each Zone shows its
     * translation in the best offered match (`pl-PL` finds `pl`), else its label in the default
     * language. The interface `locale` when absent (ADR-0011).
     */
    contentLanguage?: string;
    /**
     * A host's runtime look per Zone (Style Overrides), e.g. booth status colours: fill, opacity
     * and stroke, as in 2D. Keep it stable (`useCallback`): a new one redraws the Zones.
     */
    styleResolver?: StyleResolver;
    /** Zones drawn with the Theme's `highlight` outline, e.g. search results. */
    highlight?: ElementRef[];
    /**
     * Zone names painted on the floor, laid out as in 2D (default on); Stop icons show either way.
     * Read when the view mounts.
     */
    labels?: boolean;
    /**
     * Walls nearer the camera than the point it orbits around go down to a low kerb, so they never
     * hide the plan behind them (default on). Read when the view mounts.
     */
    cutaway?: boolean;
    /**
     * The sharpest the canvas is drawn, device pixels per CSS pixel (default 2); lower it for weak
     * devices. Read when the view mounts.
     */
    maxPixelRatio?: number;
    /**
     * Where the camera starts, e.g. one saved from `onCameraChange`; a ¾ view of the whole Level
     * when absent. Read when the view mounts.
     */
    camera?: Camera3D;
    /**
     * Who gets a plain wheel and one finger: the plan (`greedy`, default), or the page around it
     * (`cooperative`), where ⌘/Ctrl + wheel, a pinch or two fingers move the plan.
     */
    gestures?: Gestures;
    /**
     * The camera moving on its own (default `none`): `orbit` turns it, `tour` flies through the
     * shown Level's Viewpoints. It stops on the first interaction or **Pause**; **Play** and
     * `motionResume` move it on.
     */
    motion?: Motion;
    /** Seconds without an interaction after which a stopped camera moves again (at least 5); off when absent. */
    motionResume?: number;
    /** Show **Fit**, **Top view** and **Angled view** buttons in the bottom-right corner (default on). */
    controls?: boolean;
    onCameraChange?: (camera: Camera3D) => void;
    /** A click on an Element, as in the View; a lowered Wall is only its kerb. */
    onElementClick?: (e: ElementEvent) => void;
    /** A click on the bare floor, the ground or the sky. */
    onBackgroundClick?: (e: BackgroundEvent) => void;
    /** The pointer moved onto another Element, or off every Element. */
    onElementHover?: (e: HoverEvent) => void;
    onReady?: (renderer: Renderer3D) => void;
    /** Gets the View once it is made, for `flyTo`, `lookAt`, `setProgress` and `getCamera`. */
    ref?: Ref<View | null>;
    /** A flight started with `flyTo` arrived: at a Viewpoint (its id) or at a camera (`id` null). */
    onViewpoint?: (e: ViewEvents['viewpoint']) => void;
    /** A visitor clicked a Zone: its id, its Level and its `data`. */
    onZoneClick?: (e: ViewEvents['zoneClick']) => void;
    /** The tour reached a Viewpoint and stays there a while. */
    onTourStep?: (e: ViewEvents['tourStep']) => void;
    /** Plugins to start with, as in the View. Read when the view mounts. */
    plugins?: PluginSource[];
    /** The small "Made with Areaform" link in the bottom-left corner (default on); turn it off freely. */
    attribution?: boolean;
    /** A short line beside that link, e.g. a notice from the host. */
    attributionNote?: string;
}

const NONE: ElementRef[] = [];
const ONLY_3D = ['3d' as const];

/**
 * A read-only 3D preview of one Level: drag to orbit, right-drag or Shift-drag to pan, scroll to
 * zoom. Loads Three.js when it first mounts; shows a message instead without WebGL 2. A React
 * wrapper over `createView`, showing 3D only.
 */
export function Areaform3DView(props: Areaform3DViewProps) {
    const {
        doc,
        levelId,
        labelResolver,
        contentLanguage,
        styleResolver,
        highlight,
        gestures,
        motion,
        motionResume,
        locale,
        messages,
    } = props;
    const { holder, view } = useView(
        {
            doc,
            ...(levelId !== undefined && { levelId }),
            ...(props.theme && { theme: props.theme }),
            ...(props.theme3d && { theme3d: props.theme3d }),
            ...(props.doorHeight !== undefined && { doorHeight: props.doorHeight }),
            ...(props.labels !== undefined && { labels3d: props.labels }),
            ...(props.cutaway !== undefined && { cutaway: props.cutaway }),
            ...(props.maxPixelRatio !== undefined && { maxPixelRatio: props.maxPixelRatio }),
            ...(props.camera && { camera3d: props.camera }),
            ...(locale !== undefined && { locale }),
            ...(messages && { messages }),
            ...(contentLanguage !== undefined && { contentLanguage }),
            ...(labelResolver && { labelResolver }),
            ...(styleResolver && { styleResolver }),
            controls: props.controls ?? true,
            view: '3d',
            views: ONLY_3D,
            ...(props.plugins && { plugins: props.plugins }),
            attribution: props.attribution ?? true,
            ...(props.attributionNote !== undefined && { attributionNote: props.attributionNote }),
        },
        {
            elementClick: props.onElementClick,
            backgroundClick: props.onBackgroundClick,
            elementHover: props.onElementHover,
            camera3dChange: props.onCameraChange,
            ready3d: props.onReady,
            viewpoint: props.onViewpoint,
            zoneClick: props.onZoneClick,
            tourStep: props.onTourStep,
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
    useEffect(() => view?.setStyleResolver(styleResolver), [view, styleResolver]);
    useEffect(() => view?.setGestures(gestures ?? 'greedy'), [view, gestures]);
    useEffect(() => view?.setMotion(motion ?? 'none'), [view, motion]);
    useEffect(() => view?.setMotionResume(motionResume), [view, motionResume]);
    useEffect(() => view?.setLabelResolver(labelResolver), [view, labelResolver]);
    useEffect(() => view?.highlight(highlight ?? NONE), [view, highlight]);
    useEffect(() => view?.setLocale(locale, messages), [view, locale, messages]);
    useEffect(() => view?.setContentLanguage(contentLanguage), [view, contentLanguage]);
    return <div ref={holder} style={HOLDER_STYLE} />;
}
