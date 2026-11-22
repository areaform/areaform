// The buttons for looking at the plan, in its bottom-right corner, shared by the View and the
// Editor (ADR-0012).
import type { ViewPreset } from '@areaform/render-3d';
import { createIcon, type IconName } from './icons.ts';
import { english, type Translator } from './i18n/translator.ts';
import { CHOOSES_VIEW, type MotionState } from './motion.ts';

/** Which view of the plan is shown: the flat plan, or the 3D preview. */
export type ViewMode = '2d' | '3d';

export interface PlanControlsState {
    view: ViewMode;
    /** False greys out **3D** (e.g. without WebGL). */
    canShow3d: boolean;
    grid: boolean;
    /**
     * Whether the 3D camera moves on its own now, for the **Play / Pause** toggle; `null` (the
     * default) hides it, for a plan whose camera never moves.
     */
    motion: MotionState | null;
}

export interface PlanControlsHandlers {
    /** Shows the **2D / 3D** switch. */
    onViewChange?: ((view: ViewMode) => void) | undefined;
    /** Shows **Show grid** in 2D. */
    onToggleGrid?: (() => void) | undefined;
    /** Shows **Top view** and **Angled view** in 3D. */
    onViewAngle?: ((angle: ViewPreset) => void) | undefined;
    onFit: () => void;
    /** Shows **Play / Pause** in 3D while `motion` is set: the visitor stops or starts the camera. */
    onMotionToggle?: (() => void) | undefined;
}

export interface PlanControls {
    readonly element: HTMLElement;
    update(state: Partial<PlanControlsState>): void;
    /** The translator for every button's text. */
    setTranslator(i18n: Translator<unknown>): void;
    destroy(): void;
}

/**
 * A **2D / 3D** switch (left out without `onViewChange`), then **Show grid** in 2D (left out
 * without `onToggleGrid`) or **Top view** and **Angled view** in 3D, and **Fit**, stacked in the
 * plan's bottom-right corner. Put its `element` inside a positioned box over the canvas.
 */
export function createPlanControls(
    handlers: PlanControlsHandlers,
    initial: Partial<PlanControlsState> = {},
    translator: Translator<unknown> = english,
): PlanControls {
    let state: PlanControlsState = {
        view: '2d',
        canShow3d: true,
        grid: false,
        motion: null,
        ...initial,
    };
    let i18n = translator as Translator;
    const element = document.createElement('div');
    element.className = 'af-plan-controls';
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-orientation', 'vertical');

    const button = (onClick: () => void, icon?: IconName, text?: string) => {
        const b = document.createElement('button');
        b.className = 'af-button af-icon-button';
        b.type = 'button';
        if (icon) b.append(createIcon(icon));
        if (text) b.textContent = text;
        b.addEventListener('click', onClick);
        return b;
    };
    const switcher = document.createElement('div');
    switcher.className = 'af-view-switch';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute(CHOOSES_VIEW, '');
    const show2d = button(() => handlers.onViewChange?.('2d'), undefined, '2D');
    const show3d = button(() => handlers.onViewChange?.('3d'), undefined, '3D');
    switcher.append(show2d, show3d);
    const grid = button(() => handlers.onToggleGrid?.(), 'grid');
    const top = button(() => handlers.onViewAngle?.('top'), 'topView');
    const angled = button(() => handlers.onViewAngle?.('perspective'), 'angledView');
    const fit = button(() => handlers.onFit(), 'fit');
    // Not a touch of the plan: it says what the camera does rather than moving it.
    const toggle = button(() => handlers.onMotionToggle?.());
    toggle.setAttribute(CHOOSES_VIEW, '');

    const render = () => {
        const { view, canShow3d } = state;
        element.setAttribute('aria-label', i18n.t('plan.controls'));
        switcher.setAttribute('aria-label', i18n.t('plan.view'));
        show2d.setAttribute('aria-pressed', String(view === '2d'));
        show2d.title = i18n.t('plan.show2d');
        show3d.setAttribute('aria-pressed', String(view === '3d'));
        show3d.disabled = !canShow3d;
        show3d.title = canShow3d ? i18n.t('plan.show3d') : i18n.t('plan.no3d');
        grid.setAttribute('aria-label', i18n.t('plan.showGrid'));
        grid.setAttribute('aria-pressed', String(state.grid));
        grid.title = i18n.t('plan.showGridTitle');
        top.setAttribute('aria-label', i18n.t('plan.topView'));
        top.title = i18n.t('plan.topViewTitle');
        angled.setAttribute('aria-label', i18n.t('plan.angledView'));
        angled.title = i18n.t('plan.angledViewTitle');
        fit.setAttribute('aria-label', i18n.t('plan.fit'));
        fit.title = i18n.t('plan.fitTitle');
        const moving = state.motion === 'moving';
        toggle.replaceChildren(createIcon(moving ? 'pause' : 'play'));
        toggle.setAttribute('aria-label', i18n.t(moving ? 'plan.pauseMotion' : 'plan.playMotion'));
        toggle.title = i18n.t(moving ? 'plan.pauseMotion' : 'plan.playMotion');
        const showToggle = view === '3d' && state.motion !== null && !!handlers.onMotionToggle;
        element.replaceChildren(
            ...(handlers.onViewChange ? [switcher] : []),
            ...(view === '2d' && handlers.onToggleGrid ? [grid] : []),
            ...(view === '3d' && handlers.onViewAngle ? [top, angled] : []),
            fit,
            ...(showToggle ? [toggle] : []),
        );
    };
    render();

    return {
        element,
        update(next) {
            state = { ...state, ...next };
            render();
        },
        setTranslator(next) {
            i18n = next as Translator;
            render();
        },
        destroy: () => element.remove(),
    };
}
