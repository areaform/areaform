// Cooperative gestures (ADR-0025): when a scroll or a swipe went to the page, a short line over
// the plan says how to zoom and move it instead: in 2D a drag moves it, in 3D a drag turns the
// camera and Ctrl + drag moves it (⌘ also zooms on a Mac).
import type { GestureHint } from '@areaform/render-2d';
import type { ViewMode } from './controls.ts';
import type { Translator } from './i18n/translator.ts';

/** How long the hint stays after the last gesture that went to the page, ms. */
const HINT_MS = 1500;

export interface GestureHintLayer {
    /** Shows the hint for what went to the page, in the words for the view it happened in. */
    show(kind: GestureHint, view: ViewMode): void;
    destroy(): void;
}

/** The hint over `element`, made on first use, in the language `i18n()` gives at the time. */
export function createGestureHint(element: HTMLElement, i18n: () => Translator): GestureHintLayer {
    let hint: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
        show(kind, view) {
            if (!hint) {
                hint = document.createElement('div');
                hint.className = 'af-gesture-hint';
                // Shown to the eye only: it repeats on every scroll, and says nothing a keyboard needs.
                hint.setAttribute('aria-hidden', 'true');
                element.append(hint);
            }
            hint.textContent = i18n().t(textFor(kind, view));
            hint.classList.add('af-shown');
            clearTimeout(timer);
            timer = setTimeout(() => hint?.classList.remove('af-shown'), HINT_MS);
        },
        destroy() {
            clearTimeout(timer);
            hint?.remove();
            hint = null;
        },
    };
}

/** The hint's message: two fingers on touch; for the wheel, the keys for this keyboard and view. */
function textFor(kind: GestureHint, view: ViewMode) {
    if (kind === 'touch') return 'gestures.touch' as const;
    if (isMac())
        return view === '3d' ? ('gestures.wheelMac3d' as const) : ('gestures.wheelMac' as const);
    return view === '3d' ? ('gestures.wheel3d' as const) : ('gestures.wheel' as const);
}

/** ⌘ on Apple's keyboards, Ctrl elsewhere. */
function isMac() {
    return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
}
