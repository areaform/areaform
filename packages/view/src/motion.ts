// The camera moving on its own (ADR-0025): when it may move is decided here, the turning and the
// flying are the 3D renderer's. It starts once a 3D renderer is ready, stops for good on the first
// interaction inside the plan, pauses off screen and in a hidden tab, and never moves under
// `prefers-reduced-motion`.
import { wheelGoesToPage, type Gestures } from '@areaform/render-2d';
import type { Viewpoint } from '@areaform/core';
import type { Renderer3D } from '@areaform/render-3d';
import { MIN_IDLE_SECONDS, validIdle } from './idle.ts';

/**
 * How the 3D camera moves on its own: `none` (default); `orbit`, a slow turn; or `tour`, a flight
 * through the Viewpoints of the Level shown, which turns slowly around a single one and is `orbit`
 * on a Level without any. 2D stays still.
 */
export const MOTIONS = ['none', 'orbit', 'tour'] as const;
export type Motion = (typeof MOTIONS)[number];

/** Whether `value`, e.g. from a snippet's attribute, is a Motion this version knows. */
export const isMotion = (value: unknown): value is Motion =>
    (MOTIONS as readonly unknown[]).includes(value);

/**
 * Marks a control that chooses what the plan shows, such as the Level switcher or the 2D/3D
 * switch: pressing it is not an interaction that stops the motion; the View plays the motion for
 * what it now shows instead.
 */
export const CHOOSES_VIEW = 'data-af-chooses-view';

/** About one turn a minute. */
export const ORBIT_TURNS_PER_MINUTE = 1;

/** What the page tells the motion: each watcher calls back with the state now, then on changes. */
export interface MotionWatchers {
    /** Whether `element` is on screen. */
    onScreen(element: Element, callback: (visible: boolean) => void): () => void;
    /** Whether the tab is shown. */
    tabShown(callback: (shown: boolean) => void): () => void;
    /** Whether the visitor asked for less motion. */
    reducedMotion(callback: (reduced: boolean) => void): () => void;
}

/** What the Play/Pause toggle shows: the camera moving, or not, by the visitor's doing or not. */
export type MotionState = 'moving' | 'still';

/** The shortest idle time auto-resume takes, seconds: the idle reset's, `MIN_IDLE_SECONDS`. */
export const MIN_RESUME_SECONDS = MIN_IDLE_SECONDS;

export interface MotionOptions {
    /** How the camera moves on its own: `none`, `orbit` or `tour`. */
    motion: Motion;
    /** Who gets a plain wheel and one finger now: under `cooperative` they are not interactions. */
    gestures: () => Gestures;
    /**
     * Seconds without an interaction, the plan in sight, after which motion that an interaction
     * stopped starts again; never after **Pause**, nor under reduced motion. Off when absent or
     * under `MIN_RESUME_SECONDS`.
     */
    resumeAfter?: number;
    /** Called when the camera starts or stops moving, e.g. to show Play or Pause. */
    onChange?: (state: MotionState) => void;
    /** The page's state, for tests; an IntersectionObserver, the tab and the media query otherwise. */
    watchers?: MotionWatchers;
}

export interface MotionController {
    setMotion(motion: Motion): void;
    /** The 3D renderer it turns, once ready, or `null` when 3D is left. */
    attach(renderer: Renderer3D | null): void;
    /** The Viewpoints of the Level shown; a new list starts the tour again from the camera. */
    setViewpoints(viewpoints: Viewpoint[]): void;
    /**
     * Plays the motion again for what is shown now, also after an interaction stopped it: when
     * the visitor picks another Level or switches to 3D. Not after **Pause**.
     */
    restart(): void;
    /**
     * The visitor's **Play**: the camera moves on from where it is, the tour to the Viewpoint
     * after the last it reached. It plays under reduced motion too, since the visitor asked.
     */
    play(): void;
    /** The visitor's **Pause**: the camera stays until **Play**; nothing starts it on its own. */
    pause(): void;
    /**
     * The host page took the camera, e.g. with `flyTo`: the motion stops as on an interaction,
     * and auto-resume, if on, counts from now.
     */
    stop(): void;
    /**
     * Back to how it started, for a View put back as it opened (`View.reset`): the tour from its
     * first Viewpoint, and a camera the visitor stopped or paused moving again.
     */
    reset(): void;
    /** Whether the visitor paused it. */
    paused(): boolean;
    /** Holds auto-resume while `reason` is on, e.g. a route or a place card being read. */
    hold(reason: string, on: boolean): void;
    /** Seconds of idle time after which a camera stopped by a touch moves again, or off. */
    setResumeAfter(seconds: number | undefined): void;
    /** Whether the camera is moving now. */
    running(): boolean;
    destroy(): void;
}

/**
 * Watches `element` (the View) for interactions and turns the attached renderer while it may.
 * `gestures` says whether a plain wheel or a swipe is the page's: then it is not an interaction.
 */
export function createMotion(
    element: EventTarget & Element,
    options: MotionOptions,
): MotionController {
    let motion = options.motion;
    let renderer: Renderer3D | null = null;
    /** An interaction inside the plan stopped it; auto-resume may start it again. */
    let stopped = false;
    /** The visitor pressed Pause. */
    let paused = false;
    /** The visitor pressed Play, which plays under reduced motion too, until the next stop. */
    let playedByVisitor = false;
    let visible = true;
    let shown = true;
    let reduced = false;
    let viewpoints: Viewpoint[] = [];
    /** Where in the Viewpoints the next tour starts: on from where the last one stopped. */
    let startIndex = 0;
    /** What the renderer does now: nothing, a turn, or a tour, which a pause only holds. */
    let playing: Motion = 'none';
    let held = false;
    let resumeAfter = validIdle(options.resumeAfter);
    const holds = new Set<string>();
    let idle = 0;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let reported: MotionState | null = null;

    const running = () => playing === 'orbit' || (playing === 'tour' && !held);
    const report = () => {
        const state: MotionState = running() ? 'moving' : 'still';
        if (state === reported) return;
        reported = state;
        options.onChange?.(state);
    };
    const wanted = () =>
        motion === 'none' || stopped
            ? 'none'
            : motion === 'tour' && viewpoints.length > 0
              ? 'tour'
              : 'orbit';
    const end = () => {
        if (playing === 'tour' && renderer && viewpoints.length > 0)
            startIndex = (startIndex + renderer.stopTour()) % viewpoints.length;
        if (playing === 'orbit') renderer?.setOrbit(null);
        playing = 'none';
        held = false;
    };
    const update = () => {
        if (renderer) {
            const kind = wanted();
            const go = visible && shown && !paused && (!reduced || playedByVisitor);
            // A held tour stays started, so it goes on from where it was; anything else ends.
            if (playing !== 'none' && (playing !== kind || (playing === 'orbit' && !go))) end();
            if (kind === 'orbit' && go && playing === 'none') {
                renderer.setOrbit(ORBIT_TURNS_PER_MINUTE);
                playing = 'orbit';
            } else if (kind === 'tour' && playing === 'none' && go) {
                const order = [...viewpoints.slice(startIndex), ...viewpoints.slice(0, startIndex)];
                renderer.playTour(order, { orbitAfter: ORBIT_TURNS_PER_MINUTE });
                playing = 'tour';
            } else if (kind === 'tour' && playing === 'tour' && held === go) {
                held = !go;
                renderer.pauseTour(held);
            }
        }
        report();
        tick();
    };

    // Auto-resume counts whole seconds of stillness while the plan is seen in 3D and nothing holds
    // it; in 2D there is nothing to move, and showing 3D plays the motion anyway.
    const tick = () => {
        const after = resumeAfter;
        const waiting = stopped && !paused && !reduced && !!renderer && after !== undefined;
        if (waiting && !ticker) {
            ticker = setInterval(() => {
                if (!visible || !shown || holds.size > 0) return;
                idle += 1;
                if (idle >= after) {
                    idle = 0;
                    stopped = false;
                    update();
                }
            }, 1000);
        } else if (!waiting && ticker) {
            clearInterval(ticker);
            ticker = undefined;
        }
    };
    /** Counts the idle time again from now, to the whole second. */
    const stillAgain = () => {
        idle = 0;
        if (!ticker) return;
        clearInterval(ticker);
        ticker = undefined;
        tick();
    };
    const stop = () => {
        stillAgain();
        if (stopped) return;
        stopped = true;
        playedByVisitor = false;
        update();
    };

    const unlisten = onInteraction(element, options.gestures, stop);
    // A pointer moving over the plan is someone looking at it: auto-resume waits.
    const onPointerMove = () => stillAgain();
    element.addEventListener('pointermove', onPointerMove, { passive: true });

    const watchers = options.watchers ?? browserWatchers();
    const unwatch = [
        watchers.onScreen(element, (v) => {
            visible = v;
            update();
        }),
        watchers.tabShown((s) => {
            shown = s;
            update();
        }),
        watchers.reducedMotion((r) => {
            reduced = r;
            update();
        }),
    ];

    return {
        setMotion(next) {
            if (next === motion) return;
            end();
            motion = next;
            startIndex = 0;
            // Asked again by the host: a camera stopped or paused by the visitor may move again.
            stopped = false;
            paused = false;
            update();
        },
        attach(next) {
            if (next === renderer) return;
            end();
            renderer = next;
            update();
        },
        setViewpoints(next) {
            if (next === viewpoints) return;
            end();
            viewpoints = next;
            startIndex = 0;
            update();
        },
        restart() {
            if (paused) return;
            stopped = false;
            end();
            update();
        },
        play() {
            paused = false;
            stopped = false;
            playedByVisitor = true;
            stillAgain();
            update();
        },
        pause() {
            paused = true;
            update();
        },
        stop,
        reset() {
            end();
            startIndex = 0;
            stopped = false;
            paused = false;
            playedByVisitor = false;
            stillAgain();
            update();
        },
        paused: () => paused,
        hold(reason, on) {
            if (on) holds.add(reason);
            else holds.delete(reason);
            // Idle time starts again once nothing is being read.
            if (!on) stillAgain();
        },
        setResumeAfter(seconds) {
            resumeAfter = validIdle(seconds);
            update();
        },
        running,
        destroy() {
            unlisten();
            element.removeEventListener('pointermove', onPointerMove);
            for (const off of unwatch) off();
            clearInterval(ticker);
            end();
            renderer = null;
        },
    };
}

/**
 * Calls `callback` on each interaction inside `element`: a click, a mouse drag, a tap, two fingers,
 * a key, or a wheel the plan takes (`gestures`). A wheel or a finger scrolling the page past it
 * is not one. Returns a function that stops listening. The camera's motion stops on the first; the
 * Editor stops a tour played in it the same way.
 */
export function onInteraction(
    element: EventTarget,
    gestures: () => Gestures,
    callback: () => void,
): () => void {
    // A finger down may be a tap (an interaction) or the start of scrolling the page (not one,
    // and the browser cancels its pointer): it counts once lifted, or when a second finger joins.
    const fingers = new Set<number>();
    // A press of a control that chooses what to see is not one (`CHOOSES_VIEW`).
    const choosing = (e: Event) =>
        typeof (e.target as Element | null)?.closest === 'function' &&
        (e.target as Element).closest(`[${CHOOSES_VIEW}]`) !== null;
    const onPointerDown = (e: Event) => {
        if (choosing(e)) return;
        const pointer = e as PointerEvent;
        if (pointer.pointerType !== 'touch' || gestures() === 'greedy') return callback();
        fingers.add(pointer.pointerId);
        if (fingers.size > 1) callback();
    };
    const onPointerUp = (e: Event) => {
        if (fingers.delete((e as PointerEvent).pointerId)) callback();
    };
    const onPointerCancel = (e: Event) => {
        fingers.delete((e as PointerEvent).pointerId);
    };
    const onWheel = (e: Event) => {
        if (!wheelGoesToPage(gestures(), e as WheelEvent)) callback();
    };
    const events: [string, (e: Event) => void][] = [
        ['pointerdown', onPointerDown],
        ['pointerup', onPointerUp],
        ['pointercancel', onPointerCancel],
        ['wheel', onWheel],
        ['keydown', (e) => choosing(e) || callback()],
    ];
    // Captured, so a renderer stopping an event on its way down still counts as an interaction.
    for (const [type, handler] of events)
        element.addEventListener(type, handler, { capture: true, passive: true });
    return () => {
        for (const [type, handler] of events)
            element.removeEventListener(type, handler, { capture: true });
    };
}

/** The page's own state: an IntersectionObserver, the tab's visibility and the media query. */
function browserWatchers(): MotionWatchers {
    return {
        onScreen(element, callback) {
            if (typeof IntersectionObserver === 'undefined') return () => {};
            const observer = new IntersectionObserver((entries) => {
                const entry = entries[entries.length - 1];
                if (entry) callback(entry.isIntersecting);
            });
            observer.observe(element);
            return () => observer.disconnect();
        },
        tabShown(callback) {
            const report = () => callback(document.visibilityState !== 'hidden');
            report();
            document.addEventListener('visibilitychange', report);
            return () => document.removeEventListener('visibilitychange', report);
        },
        reducedMotion(callback) {
            const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
            if (!query) return () => {};
            const report = () => callback(query.matches);
            report();
            query.addEventListener('change', report);
            return () => query.removeEventListener('change', report);
        },
    };
}
