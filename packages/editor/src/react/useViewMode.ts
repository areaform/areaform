// Internal: the 2D / 3D switch shared by AreaformEditor and AreaformView.
import { isWebGLAvailable, type Camera3D } from '@areaform/render-3d';
import { useRef, useState } from 'react';
import type { ViewMode } from './PlanControls.tsx';

export interface ViewModeProps {
    /** The view shown at the start (default `2d`). */
    defaultView?: ViewMode;
    /** The view shown, when the host owns it; pair it with `onViewChange`. */
    view?: ViewMode;
    /** Called when the user switches between 2D and 3D. */
    onViewChange?: (view: ViewMode) => void;
    /** The views the user can switch between (default both); `['2d']` hides the switch. */
    views?: ViewMode[];
}

const BOTH: ViewMode[] = ['2d', '3d'];

/**
 * The view to show and how to switch it. The 3D camera is remembered between switches, so going
 * back to 3D looks from where it was left.
 */
export function useViewMode({ defaultView, view, onViewChange, views = BOTH }: ViewModeProps) {
    const [own, setOwn] = useState<ViewMode>(defaultView ?? '2d');
    const wanted = view ?? own;
    const shown = views.includes(wanted) ? wanted : (views[0] ?? '2d');
    const camera = useRef<Camera3D | undefined>(undefined);
    return {
        shown,
        /** The switch's handler, or undefined when there is only one view to show. */
        change:
            views.length > 1
                ? (next: ViewMode) => {
                      if (next === shown) return;
                      setOwn(next);
                      onViewChange?.(next);
                  }
                : undefined,
        canShow3d: isWebGLAvailable(),
        camera,
    };
}
