// Idle time for a Kiosk (docs/notes/kiosk.md, decided 2026-11-03): after so many seconds with
// nobody touching the page, the View says so, and the host puts it back as it opened (`reset`),
// perhaps after a "Still here?" notice of its own. The open View gives only this building block;
// the hosted Kiosk builds its Welcome Screen on it.

/**
 * The shortest idle time, seconds, for the idle reset and for motion's auto-resume alike: less
 * would reset a plan, or move its camera, between a visitor's taps.
 */
export const MIN_IDLE_SECONDS = 5;

/** What counts as someone using the page: a touch, a click, a key or a wheel. */
const ACTIVITY = ['pointerdown', 'keydown', 'wheel'] as const;

export interface IdleTimer {
    /** Seconds without activity before `onIdle`, or off (absent, not a number, or under the least). */
    set(seconds: number | undefined): void;
    destroy(): void;
}

/** `seconds` when it is a usable idle time, else `undefined` (off). */
export function validIdle(seconds: number | undefined): number | undefined {
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= MIN_IDLE_SECONDS
        ? seconds
        : undefined;
}

/**
 * Calls `onIdle` once `seconds` pass with no activity anywhere on `target` (the View's document:
 * on a Kiosk the page is the screen, and a touch on the host's own buttons is someone there too).
 * It counts only from the first activity, and once called waits for the next: a plan nobody has
 * touched since it opened, or since the last reset, is already as it opened.
 */
export function createIdleTimer(
    target: EventTarget,
    onIdle: (seconds: number) => void,
    seconds?: number,
): IdleTimer {
    let after = validIdle(seconds);
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Activity came since the last call, so a call is due once it stops. */
    let armed = false;
    const clear = () => {
        clearTimeout(timer);
        timer = undefined;
    };
    const arm = () => {
        clear();
        if (!armed || after === undefined) return;
        const wait = after;
        timer = setTimeout(() => {
            timer = undefined;
            armed = false;
            onIdle(wait);
        }, wait * 1000);
    };
    const onActivity = () => {
        armed = true;
        arm();
    };
    for (const type of ACTIVITY)
        target.addEventListener(type, onActivity, { capture: true, passive: true });
    return {
        set(next) {
            const valid = validIdle(next);
            if (valid === after) return;
            after = valid;
            arm();
        },
        destroy() {
            clear();
            for (const type of ACTIVITY)
                target.removeEventListener(type, onActivity, { capture: true });
        },
    };
}
