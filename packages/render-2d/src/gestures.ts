// Cooperative gestures (ADR-0025): a plan on a page that scrolls lets the page have a plain wheel
// and a one-finger swipe, and moves only with ⌘/Ctrl + wheel, a pinch or two fingers. Both
// renderers use these, so 2D and 3D agree on what goes to the page.

/**
 * Who gets the gestures that also scroll a page: `greedy` (the default), the plan takes them all,
 * for a plan that is the whole page; `cooperative`, the page keeps a plain wheel and one finger.
 */
export type Gestures = 'cooperative' | 'greedy';

/** What a visitor tried that went to the page instead, so the View can say how to move the plan. */
export type GestureHint = 'wheel' | 'touch';

/**
 * Whether a wheel event scrolls the page rather than the plan: under `cooperative`, any wheel
 * without ⌘ or Ctrl (a trackpad pinch comes with Ctrl, so it still zooms).
 */
export function wheelGoesToPage(
    gestures: Gestures,
    wheel: { ctrlKey?: boolean; metaKey?: boolean },
): boolean {
    return gestures === 'cooperative' && !wheel.ctrlKey && !wheel.metaKey;
}

/**
 * Lets one finger on `element` scroll the page while `gestures()` is `cooperative`, and keeps the
 * page still while two fingers move the plan. `onHint` is called when the browser takes a finger
 * for scrolling. `apply` sets the element up again after `gestures()` changes; `dispose` removes
 * the listeners.
 */
export function cooperativeTouch(
    element: HTMLElement,
    gestures: () => Gestures,
    onHint: (hint: GestureHint) => void,
): { apply(): void; dispose(): void } {
    const apply = () => {
        // The browser decides on touchstart who gets the gesture: the page may pan, never zoom.
        element.style.touchAction = gestures() === 'cooperative' ? 'pan-x pan-y' : 'none';
    };
    // Two fingers: the plan's. A touchmove not yet scrolling can still be stopped from starting to.
    const onTouchMove = (e: TouchEvent) => {
        if (gestures() === 'cooperative' && e.touches.length > 1 && e.cancelable)
            e.preventDefault();
    };
    // The browser cancels a finger's pointer once it scrolls the page with it.
    const onPointerCancel = (e: PointerEvent) => {
        if (gestures() === 'cooperative' && e.pointerType === 'touch') onHint('touch');
    };
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('pointercancel', onPointerCancel);
    apply();
    return {
        apply,
        dispose() {
            element.removeEventListener('touchmove', onTouchMove);
            element.removeEventListener('pointercancel', onPointerCancel);
        },
    };
}
