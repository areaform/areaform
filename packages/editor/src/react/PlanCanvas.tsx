// Internal: mounts a render-2d renderer and keeps it in sync with props.
import type { ElementRef, AreaformDocument, Id } from '@areaform/core';
import {
    createRenderer,
    type BackgroundEvent,
    type Camera,
    type ElementEvent,
    type HoverEvent,
    type Interaction,
    type LabelResolver,
    type OverlayItem,
    type PlanPointerEvent,
    type AssetResolver,
    type Rulers,
    type Renderer,
    type StyleResolver,
    type Theme,
    type WheelMode,
} from '@areaform/render-2d';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const NONE: never[] = [];

export interface PlanCanvasProps {
    doc: AreaformDocument;
    levelId: Id;
    interaction: Interaction;
    wheel?: WheelMode | undefined;
    grid?: boolean | undefined;
    rulers?: Rulers | null | undefined;
    origin?: boolean | undefined;
    /** Read once, when the renderer is created. */
    theme?: Theme | undefined;
    styleResolver?: StyleResolver | undefined;
    labelResolver?: LabelResolver | undefined;
    /** The Content Language to show the Space's text in; the default language when absent. */
    contentLanguage?: string | undefined;
    resolveAsset?: AssetResolver | undefined;
    highlight?: ElementRef[] | undefined;
    overlay?: OverlayItem[] | undefined;
    /** No frames are drawn while the plan is out of sight, e.g. under the 3D view. */
    paused?: boolean | undefined;
    onPointerDown?: ((e: PlanPointerEvent) => void) | undefined;
    onPointerMove?: ((e: PlanPointerEvent) => void) | undefined;
    onPointerUp?: ((e: PlanPointerEvent) => void) | undefined;
    onElementClick?: ((e: ElementEvent) => void) | undefined;
    onBackgroundClick?: ((e: BackgroundEvent) => void) | undefined;
    onElementHover?: ((e: HoverEvent) => void) | undefined;
    onZoomChange?: ((zoom: number) => void) | undefined;
    onCameraChange?: ((camera: Camera) => void) | undefined;
    onReady?: ((renderer: Renderer) => void) | undefined;
}

export function PlanCanvas(props: PlanCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderer, setRenderer] = useState<Renderer | null>(null);
    // Latest callbacks, so renderer listeners never need re-subscribing.
    const latest = useRef(props);
    useLayoutEffect(() => {
        latest.current = props;
    });

    useEffect(() => {
        let cancelled = false;
        let created: Renderer | null = null;
        void createRenderer({
            container: containerRef.current!,
            interaction: latest.current.interaction,
            wheel: latest.current.wheel ?? 'auto',
            grid: latest.current.grid ?? false,
            rulers: latest.current.rulers ?? null,
            origin: latest.current.origin ?? false,
            ...(latest.current.theme && { theme: latest.current.theme }),
        }).then((r) => {
            if (cancelled) return r.destroy();
            created = r;
            r.on('pointerDown', (e) => latest.current.onPointerDown?.(e));
            r.on('pointerMove', (e) => latest.current.onPointerMove?.(e));
            r.on('pointerUp', (e) => latest.current.onPointerUp?.(e));
            r.on('elementClick', (e) => latest.current.onElementClick?.(e));
            r.on('backgroundClick', (e) => latest.current.onBackgroundClick?.(e));
            r.on('elementHover', (e) => latest.current.onElementHover?.(e));
            r.on('cameraChange', (c) => {
                latest.current.onZoomChange?.(c.zoom);
                latest.current.onCameraChange?.(c);
            });
            setRenderer(r);
        });
        return () => {
            cancelled = true;
            created?.destroy();
        };
    }, []);

    const {
        doc,
        levelId,
        interaction,
        wheel,
        grid,
        rulers,
        origin,
        styleResolver,
        labelResolver,
        contentLanguage,
        resolveAsset,
        highlight,
        overlay,
        paused,
    } = props;
    const fittedFor = useRef<string | null>(null);

    useEffect(() => {
        if (!renderer) return;
        renderer.update(doc);
        renderer.setLevel(levelId);
        // Fit when a new Space or Level is shown, not on every edit.
        const key = `${doc.id}:${levelId}`;
        if (fittedFor.current !== key) {
            fittedFor.current = key;
            renderer.fitLevel();
        }
    }, [renderer, doc, levelId]);

    useEffect(() => renderer?.setInteraction(interaction), [renderer, interaction]);
    useEffect(() => renderer?.setWheelMode(wheel ?? 'auto'), [renderer, wheel]);
    useEffect(() => renderer?.setGrid(grid ?? false), [renderer, grid]);
    useEffect(() => renderer?.setRulers(rulers ?? null), [renderer, rulers]);
    useEffect(() => renderer?.setOrigin(origin ?? false), [renderer, origin]);
    useEffect(() => renderer?.setStyleResolver(styleResolver), [renderer, styleResolver]);
    useEffect(() => renderer?.setLabelResolver(labelResolver), [renderer, labelResolver]);
    useEffect(() => renderer?.setContentLanguage(contentLanguage), [renderer, contentLanguage]);
    useEffect(() => renderer?.setAssetResolver(resolveAsset), [renderer, resolveAsset]);
    useEffect(() => renderer?.highlight(highlight ?? NONE), [renderer, highlight]);
    useEffect(() => renderer?.setOverlay(overlay ?? NONE), [renderer, overlay]);
    useEffect(() => renderer?.setPaused(paused ?? false), [renderer, paused]);
    useEffect(() => {
        if (renderer) latest.current.onReady?.(renderer);
    }, [renderer]);

    return <div ref={containerRef} className="af-canvas" />;
}
