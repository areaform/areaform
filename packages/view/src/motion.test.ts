import type { Viewpoint } from '@areaform/core';
import type { Gestures } from '@areaform/render-2d';
import type { Renderer3D } from '@areaform/render-3d';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CHOOSES_VIEW,
    createMotion,
    ORBIT_TURNS_PER_MINUTE,
    type Motion,
    type MotionWatchers,
} from './motion.ts';

/** A View's element stand-in: Node's own EventTarget is enough for the events motion watches. */
function setUp(
    options: {
        gestures?: Gestures;
        motion?: Motion;
        choosing?: boolean;
        resumeAfter?: number;
        /** Where the fake tour says it would go on when stopped. */
        next?: number;
    } = {},
) {
    // A press lands on the element itself; `choosing` makes it a control that chooses the view.
    const element = Object.assign(new EventTarget(), {
        closest: (selector: string) =>
            options.choosing && selector === `[${CHOOSES_VIEW}]` ? {} : null,
    }) as unknown as EventTarget & Element;
    const orbits: (number | null)[] = [];
    /** What the renderer was asked to do with tours, in order. */
    const tours: string[] = [];
    const renderer = {
        setOrbit: (speed: number | null) => void orbits.push(speed),
        playTour: (list: Viewpoint[], { orbitAfter }: { orbitAfter?: number } = {}) =>
            void tours.push(`play ${list.map((v) => v.id).join(',')} then ${orbitAfter}`),
        pauseTour: (paused: boolean) => void tours.push(paused ? 'hold' : 'go on'),
        stopTour: () => {
            tours.push('stop');
            return options.next ?? 0;
        },
    } as unknown as Renderer3D;
    const callbacks: Record<'screen' | 'tab' | 'reduced', (on: boolean) => void> = {
        screen: () => {},
        tab: () => {},
        reduced: () => {},
    };
    const watchers: MotionWatchers = {
        onScreen: (_, cb) => ((callbacks.screen = cb), () => {}),
        tabShown: (cb) => ((callbacks.tab = cb), () => {}),
        reducedMotion: (cb) => ((callbacks.reduced = cb), () => {}),
    };
    let gestures: Gestures = options.gestures ?? 'cooperative';
    const states: string[] = [];
    const motion = createMotion(element, {
        motion: options.motion ?? 'orbit',
        gestures: () => gestures,
        watchers,
        ...(options.resumeAfter !== undefined && { resumeAfter: options.resumeAfter }),
        onChange: (state) => states.push(state),
    });
    const fire = (type: string, props: Record<string, unknown> = {}) =>
        element.dispatchEvent(Object.assign(new Event(type), props));
    return {
        motion,
        renderer,
        orbits,
        tours,
        states,
        fire,
        callbacks,
        setGestures: (g: Gestures) => (gestures = g),
    };
}

describe('createMotion', () => {
    it('waits for a 3D renderer, then turns it about once a minute', () => {
        const { motion, renderer, orbits } = setUp();
        expect(motion.running()).toBe(false);

        motion.attach(renderer);

        expect(motion.running()).toBe(true);
        expect(orbits).toEqual([ORBIT_TURNS_PER_MINUTE]);
    });

    it('stays still with motion `none`', () => {
        const { motion, renderer } = setUp({ motion: 'none' });
        motion.attach(renderer);

        expect(motion.running()).toBe(false);
    });

    it('stops for good on a click, and does not start again when 3D is shown again', () => {
        const { motion, renderer, orbits, fire } = setUp();
        motion.attach(renderer);

        fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });
        motion.attach(null);
        motion.attach(renderer);

        expect(motion.running()).toBe(false);
        expect(orbits.at(-1)).toBeNull();
    });

    it('a key or ⌘ + wheel inside the plan stops it', () => {
        for (const [type, props] of [
            ['keydown', {}],
            ['wheel', { metaKey: true }],
        ] as const) {
            const { motion, renderer, fire } = setUp();
            motion.attach(renderer);
            fire(type, props);
            expect(motion.running(), type).toBe(false);
        }
    });

    it('a plain wheel scrolling past the plan does not stop it; on a greedy plan it does', () => {
        const { motion, renderer, fire, setGestures } = setUp();
        motion.attach(renderer);

        fire('wheel', {});
        expect(motion.running()).toBe(true);

        setGestures('greedy');
        fire('wheel', {});
        expect(motion.running()).toBe(false);
    });

    it('a finger that scrolls the page does not stop it, a tap does', () => {
        const { motion, renderer, fire } = setUp();
        motion.attach(renderer);

        fire('pointerdown', { pointerType: 'touch', pointerId: 1 });
        fire('pointercancel', { pointerType: 'touch', pointerId: 1 });
        expect(motion.running()).toBe(true);

        fire('pointerdown', { pointerType: 'touch', pointerId: 2 });
        fire('pointerup', { pointerType: 'touch', pointerId: 2 });
        expect(motion.running()).toBe(false);
    });

    it('two fingers stop it', () => {
        const { motion, renderer, fire } = setUp();
        motion.attach(renderer);

        fire('pointerdown', { pointerType: 'touch', pointerId: 1 });
        fire('pointerdown', { pointerType: 'touch', pointerId: 2 });

        expect(motion.running()).toBe(false);
    });

    it('pauses off screen and in a hidden tab, and goes on after', () => {
        const { motion, renderer, orbits, callbacks } = setUp();
        motion.attach(renderer);

        callbacks.screen(false);
        expect(motion.running()).toBe(false);
        callbacks.screen(true);
        callbacks.tab(false);
        expect(motion.running()).toBe(false);
        callbacks.tab(true);

        expect(motion.running()).toBe(true);
        expect(orbits).toEqual([1, null, 1, null, 1]);
    });

    it('never moves under prefers-reduced-motion', () => {
        const { motion, renderer, callbacks } = setUp();
        callbacks.reduced(true);

        motion.attach(renderer);

        expect(motion.running()).toBe(false);
    });

    it('turns again when the host asks for it again after the visitor stopped it', () => {
        const { motion, renderer, fire } = setUp();
        motion.attach(renderer);
        fire('keydown');

        motion.setMotion('none');
        motion.setMotion('orbit');

        expect(motion.running()).toBe(true);
    });

    describe('a tour', () => {
        const at = (id: string): Viewpoint => ({
            id,
            target: [0, 0],
            bearing: 0,
            tilt: 45,
            distance: 10,
        });

        it('flies through the Level’s Viewpoints, then turns around a single one', () => {
            const { motion, renderer, tours, orbits } = setUp({ motion: 'tour' });
            motion.setViewpoints([at('A'), at('B')]);

            motion.attach(renderer);

            expect(tours).toEqual([`play A,B then ${ORBIT_TURNS_PER_MINUTE}`]);
            expect(orbits).toEqual([]);
            expect(motion.running()).toBe(true);
        });

        it('turns instead on a Level without Viewpoints', () => {
            const { motion, renderer, tours, orbits } = setUp({ motion: 'tour' });

            motion.attach(renderer);

            expect(tours).toEqual([]);
            expect(orbits).toEqual([ORBIT_TURNS_PER_MINUTE]);
        });

        it('is held off screen and goes on from there, not from the start', () => {
            const { motion, renderer, tours, callbacks } = setUp({ motion: 'tour' });
            motion.setViewpoints([at('A')]);
            motion.attach(renderer);

            callbacks.screen(false);
            expect(motion.running()).toBe(false);
            callbacks.screen(true);

            expect(tours).toEqual(['play A then 1', 'hold', 'go on']);
        });

        it('ends for good on the first interaction', () => {
            const { motion, renderer, tours, fire } = setUp({ motion: 'tour' });
            motion.setViewpoints([at('A')]);
            motion.attach(renderer);

            fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });
            motion.setViewpoints([at('B')]);

            expect(tours).toEqual(['play A then 1', 'stop']);
        });

        it('starts again with another Level’s Viewpoints, and turns on one with none', () => {
            const { motion, renderer, tours, orbits } = setUp({ motion: 'tour' });
            motion.setViewpoints([at('A')]);
            motion.attach(renderer);

            motion.setViewpoints([at('B'), at('C')]);
            motion.setViewpoints([]);

            expect(tours).toEqual(['play A then 1', 'stop', 'play B,C then 1', 'stop']);
            expect(orbits).toEqual([ORBIT_TURNS_PER_MINUTE]);
        });

        it('never starts under prefers-reduced-motion', () => {
            const { motion, renderer, tours, callbacks } = setUp({ motion: 'tour' });
            callbacks.reduced(true);
            motion.setViewpoints([at('A')]);

            motion.attach(renderer);

            expect(tours).toEqual([]);
        });
    });

    describe('choosing what to see', () => {
        it('a press on the Level switcher or the 2D/3D switch does not stop it', () => {
            const { motion, renderer, fire } = setUp({ choosing: true });
            motion.attach(renderer);

            fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });
            fire('keydown');

            expect(motion.running()).toBe(true);
        });

        it('restart plays it again after an interaction stopped it, from the camera as it is', () => {
            const { motion, renderer, fire, tours } = setUp({ motion: 'tour' });
            motion.setViewpoints([{ id: 'A', target: [0, 0], bearing: 0, tilt: 45, distance: 10 }]);
            motion.attach(renderer);
            fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });
            expect(motion.running()).toBe(false);

            motion.restart();

            expect(motion.running()).toBe(true);
            expect(tours).toEqual(['play A then 1', 'stop', 'play A then 1']);
        });

        it('restart waits for the 3D view, as when the plan opens in 3D', () => {
            const { motion, renderer, fire, orbits } = setUp();
            fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });

            motion.restart();
            expect(orbits).toEqual([]);
            motion.attach(renderer);

            expect(orbits).toEqual([ORBIT_TURNS_PER_MINUTE]);
        });

        it('restart never moves it under prefers-reduced-motion', () => {
            const { motion, renderer, callbacks } = setUp();
            callbacks.reduced(true);
            motion.attach(renderer);

            motion.restart();

            expect(motion.running()).toBe(false);
        });
    });

    describe('Play and Pause', () => {
        const three = (['A', 'B', 'C'] as const).map((id): Viewpoint => ({
            id,
            target: [0, 0],
            bearing: 0,
            tilt: 45,
            distance: 10,
        }));

        it('Pause holds the tour where it is, and Play goes on from exactly there', () => {
            const { motion, renderer, tours, states } = setUp({ motion: 'tour' });
            motion.setViewpoints(three);
            motion.attach(renderer);

            motion.pause();
            expect(motion.running()).toBe(false);
            motion.play();

            expect(tours).toEqual(['play A,B,C then 1', 'hold', 'go on']);
            // Still until 3D is ready, then moving, held, moving.
            expect(states).toEqual(['still', 'moving', 'still', 'moving']);
        });

        it('reset plays the tour from its first Viewpoint again, after Pause too', () => {
            const { motion, renderer, tours, fire } = setUp({ motion: 'tour', next: 2 });
            motion.setViewpoints(three);
            motion.attach(renderer);
            fire('pointerdown', { pointerType: 'mouse' });
            motion.pause();
            expect(motion.running()).toBe(false);

            motion.reset();

            expect(motion.running()).toBe(true);
            expect(motion.paused()).toBe(false);
            expect(tours.at(-1)).toBe('play A,B,C then 1');
        });

        it('after a touch stopped the tour, Play goes on to the Viewpoint after the last it reached', () => {
            const { motion, renderer, tours, fire } = setUp({ motion: 'tour', next: 2 });
            motion.setViewpoints(three);
            motion.attach(renderer);
            fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });

            motion.play();

            expect(tours).toEqual(['play A,B,C then 1', 'stop', 'play C,A,B then 1']);
        });

        it('picking a floor does not start a paused camera', () => {
            const { motion, renderer } = setUp();
            motion.attach(renderer);

            motion.pause();
            motion.restart();

            expect(motion.running()).toBe(false);
            expect(motion.paused()).toBe(true);
        });

        it('plays under reduced motion when the visitor asks for it, until the next touch', () => {
            const { motion, renderer, callbacks, fire } = setUp();
            callbacks.reduced(true);
            motion.attach(renderer);
            expect(motion.running()).toBe(false);

            motion.play();
            expect(motion.running()).toBe(true);
            fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });
            motion.restart();

            expect(motion.running()).toBe(false);
        });
    });

    describe('auto-resume', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());
        const stopped = (options: Parameters<typeof setUp>[0] = {}) => {
            const made = setUp({ resumeAfter: 10, ...options });
            made.motion.attach(made.renderer);
            made.fire('pointerdown', { pointerType: 'mouse', pointerId: 1 });
            return made;
        };

        it('starts again after the seconds asked for without an interaction', () => {
            const { motion } = stopped();

            vi.advanceTimersByTime(9_000);
            expect(motion.running()).toBe(false);
            vi.advanceTimersByTime(1_000);

            expect(motion.running()).toBe(true);
        });

        it('counts again from each interaction, and from the pointer moving over the plan', () => {
            const { motion, fire } = stopped();

            vi.advanceTimersByTime(8_000);
            fire('keydown');
            vi.advanceTimersByTime(8_000);
            fire('pointermove');
            vi.advanceTimersByTime(8_000);
            expect(motion.running()).toBe(false);
            vi.advanceTimersByTime(2_000);

            expect(motion.running()).toBe(true);
        });

        it('counts only while the plan is seen, and nothing holds it, such as a route', () => {
            const { motion, callbacks } = stopped();

            callbacks.screen(false);
            vi.advanceTimersByTime(30_000);
            callbacks.screen(true);
            motion.hold('wayfinding', true);
            vi.advanceTimersByTime(30_000);
            expect(motion.running()).toBe(false);

            motion.hold('wayfinding', false);
            vi.advanceTimersByTime(10_000);
            expect(motion.running()).toBe(true);
        });

        it('counts the whole time again from an interaction, to the second', () => {
            const { motion, fire } = stopped();

            vi.advanceTimersByTime(9_900);
            fire('pointermove');
            vi.advanceTimersByTime(9_900);
            expect(motion.running()).toBe(false);
            vi.advanceTimersByTime(100);

            expect(motion.running()).toBe(true);
        });

        it('does not count while the plan is in 2D, where nothing moves', () => {
            const { motion, renderer, fire } = stopped();
            motion.attach(null);
            fire('pointerdown', { pointerType: 'mouse', pointerId: 2 });

            vi.advanceTimersByTime(60_000);
            motion.attach(renderer);

            // Showing 3D again is not a resume: the touch in 2D still stopped it.
            expect(motion.running()).toBe(false);
        });

        it('never after Pause, never under reduced motion, never when off or under 5 s', () => {
            const paused = stopped();
            paused.motion.pause();
            const reduced = stopped();
            reduced.callbacks.reduced(true);
            const off = stopped({ resumeAfter: undefined as unknown as number });
            const short = stopped({ resumeAfter: 3 });

            vi.advanceTimersByTime(60_000);

            for (const { motion } of [paused, reduced, off, short])
                expect(motion.running()).toBe(false);
        });
    });
});
