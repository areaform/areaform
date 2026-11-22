// Internal: mounts a render-3d renderer and keeps it in sync with props.
import type { AreaformDocument, ElementRef, Id } from '@areaform/core';
import type {
    BackgroundEvent,
    ElementEvent,
    HoverEvent,
    LabelResolver,
    StyleResolver,
    Theme,
} from '@areaform/render-2d';
import {
    createRenderer3D,
    type Camera3D,
    type Renderer3D,
    type Theme3D,
} from '@areaform/render-3d';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.ts';

export interface Canvas3DProps {
    doc: AreaformDocument;
    levelId: Id;
    theme?: Theme | undefined;
    theme3d?: Partial<Theme3D> | undefined;
    doorHeight?: number | undefined;
    labels?: boolean | undefined;
    cutaway?: boolean | undefined;
    maxPixelRatio?: number | undefined;
    labelResolver?: LabelResolver | undefined;
    contentLanguage?: string | undefined;
    styleResolver?: StyleResolver | undefined;
    highlight?: ElementRef[] | undefined;
    /** Where the camera starts; read once, when the renderer is created. */
    camera?: Camera3D | undefined;
    onCameraChange?: ((camera: Camera3D) => void) | undefined;
    onElementClick?: ((e: ElementEvent) => void) | undefined;
    onBackgroundClick?: ((e: BackgroundEvent) => void) | undefined;
    onElementHover?: ((e: HoverEvent) => void) | undefined;
    onReady?: ((renderer: Renderer3D) => void) | undefined;
}

const NONE: ElementRef[] = [];

export function Canvas3D(props: Canvas3DProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderer, setRenderer] = useState<Renderer3D | null>(null);
    const [failed, setFailed] = useState(false);
    const latest = useRef(props);
    const builtWith = useRef<LabelResolver | undefined>(undefined);
    useLayoutEffect(() => {
        latest.current = props;
    });

    useEffect(() => {
        let cancelled = false;
        let created: Renderer3D | null = null;
        const {
            theme,
            theme3d,
            doorHeight,
            labels,
            cutaway,
            maxPixelRatio,
            labelResolver,
            contentLanguage,
        } = latest.current;
        builtWith.current = labelResolver;
        createRenderer3D({
            container: containerRef.current!,
            ...(theme && { theme }),
            ...(theme3d && { theme3d }),
            ...(doorHeight !== undefined && { doorHeight }),
            ...(labels !== undefined && { labels }),
            ...(cutaway !== undefined && { cutaway }),
            ...(contentLanguage !== undefined && { contentLanguage }),
            ...(maxPixelRatio !== undefined && { maxPixelRatio }),
            ...(labelResolver && { labelResolver }),
        }).then(
            (r) => {
                if (cancelled) return r.destroy();
                created = r;
                r.update(latest.current.doc);
                r.setLevel(latest.current.levelId);
                if (latest.current.camera) r.setCamera(latest.current.camera);
                r.on('cameraChange', (c) => latest.current.onCameraChange?.(c));
                r.on('elementClick', (e) => latest.current.onElementClick?.(e));
                r.on('backgroundClick', (e) => latest.current.onBackgroundClick?.(e));
                r.on('elementHover', (e) => latest.current.onElementHover?.(e));
                setRenderer(r);
            },
            () => {
                if (!cancelled) setFailed(true);
            },
        );
        return () => {
            cancelled = true;
            created?.destroy();
        };
    }, []);

    const { doc, levelId, labelResolver, contentLanguage, styleResolver, highlight } = props;
    const i18n = useI18n();
    // A new resolver rebuilds the Level, so only one other than the renderer was made with.
    useEffect(() => {
        if (!renderer || labelResolver === builtWith.current) return;
        builtWith.current = labelResolver;
        renderer.setLabelResolver(labelResolver);
    }, [renderer, labelResolver]);
    useEffect(() => renderer?.setStyleResolver(styleResolver), [renderer, styleResolver]);
    // Unchanged from creation, this does nothing; a new one rebuilds the Level's names.
    useEffect(() => renderer?.setContentLanguage(contentLanguage), [renderer, contentLanguage]);
    useEffect(() => renderer?.highlight(highlight ?? NONE), [renderer, highlight]);
    useEffect(() => {
        if (!renderer) return;
        renderer.update(doc);
        renderer.setLevel(levelId);
    }, [renderer, doc, levelId]);
    useEffect(() => {
        if (renderer) latest.current.onReady?.(renderer);
    }, [renderer]);

    if (failed)
        return (
            <div className="af-canvas af-canvas-message" role="status">
                {i18n.t('plan.no3dMessage')}
            </div>
        );
    return <div ref={containerRef} className="af-canvas af-canvas-3d" />;
}
