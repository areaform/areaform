// The View's plan controls (ADR-0012) as a React component.
import {
    createPlanControls,
    type PlanControls as Controls,
    type PlanControlsHandlers,
    type ViewMode,
} from '@areaform/view';
import type { ViewPreset } from '@areaform/render-3d';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.ts';

export type { ViewMode } from '@areaform/view';

/**
 * The buttons for looking at the plan, in its bottom-right corner: a **2D / 3D** switch (left out
 * without `onViewChange`), then **Show grid** in 2D (left out without `onToggleGrid`) or **Top
 * view** and **Angled view** in 3D, and **Fit**. Place it inside a positioned box over the canvas.
 */
export function PlanControls({
    view = '2d',
    onViewChange,
    canShow3d = true,
    grid = false,
    onToggleGrid,
    onViewAngle,
    onFit,
}: {
    view?: ViewMode;
    onViewChange?: ((view: ViewMode) => void) | undefined;
    /** False greys out **3D** (e.g. without WebGL). */
    canShow3d?: boolean;
    grid?: boolean;
    onToggleGrid?: (() => void) | undefined;
    onViewAngle?: ((angle: ViewPreset) => void) | undefined;
    onFit: () => void;
}) {
    const i18n = useI18n();
    const holder = useRef<HTMLDivElement>(null);
    // One object the controls keep; each render puts the latest handlers in it.
    const [handlers] = useState<PlanControlsHandlers>(() => ({ onFit }));
    const [controls, setControls] = useState<Controls | null>(null);
    useLayoutEffect(() => {
        handlers.onFit = onFit;
        handlers.onViewChange = onViewChange;
        handlers.onToggleGrid = onToggleGrid;
        handlers.onViewAngle = onViewAngle;
    });
    useEffect(() => {
        const created = createPlanControls(handlers);
        holder.current!.append(created.element);
        setControls(created);
        return () => created.destroy();
    }, [handlers]);
    useEffect(() => controls?.setTranslator(i18n), [controls, i18n]);
    // Which buttons show depends on which handlers are given, so this runs on every render.
    useEffect(() => controls?.update({ view, canShow3d, grid }));
    // Adds no box of its own, so the controls are placed against the plan as before.
    return <div ref={holder} style={{ display: 'contents' }} />;
}
