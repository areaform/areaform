import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleTimer, MIN_IDLE_SECONDS, validIdle } from './idle.ts';

describe('the idle timer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const setUp = (seconds?: number) => {
        const page = new EventTarget();
        const calls: number[] = [];
        const timer = createIdleTimer(page, (s) => calls.push(s), seconds);
        const touch = () => page.dispatchEvent(new Event('pointerdown'));
        return { page, calls, timer, touch };
    };

    it('calls once the time passes with nobody touching the page', () => {
        const { calls, touch } = setUp(60);
        touch();
        vi.advanceTimersByTime(59_000);
        expect(calls).toEqual([]);
        vi.advanceTimersByTime(1_000);
        expect(calls).toEqual([60]);
    });

    it('counts again from each touch, key or wheel', () => {
        const { page, calls, touch } = setUp(10);
        touch();
        vi.advanceTimersByTime(8_000);
        page.dispatchEvent(new Event('keydown'));
        vi.advanceTimersByTime(8_000);
        page.dispatchEvent(new Event('wheel'));
        vi.advanceTimersByTime(8_000);
        expect(calls).toEqual([]);
        vi.advanceTimersByTime(2_000);
        expect(calls).toEqual([10]);
    });

    it('waits for someone first, and calls only once until the next', () => {
        const { calls, touch } = setUp(10);
        vi.advanceTimersByTime(60_000);
        expect(calls).toEqual([]);
        touch();
        vi.advanceTimersByTime(60_000);
        expect(calls).toEqual([10]);
        touch();
        vi.advanceTimersByTime(10_000);
        expect(calls).toEqual([10, 10]);
    });

    it('is off without a time, under the least, or once destroyed', () => {
        expect(validIdle(undefined)).toBeUndefined();
        expect(validIdle(Number.NaN)).toBeUndefined();
        expect(validIdle(MIN_IDLE_SECONDS - 1)).toBeUndefined();
        expect(validIdle(MIN_IDLE_SECONDS)).toBe(MIN_IDLE_SECONDS);

        const off = setUp();
        off.touch();
        vi.advanceTimersByTime(600_000);
        expect(off.calls).toEqual([]);

        const gone = setUp(10);
        gone.touch();
        gone.timer.destroy();
        vi.advanceTimersByTime(60_000);
        expect(gone.calls).toEqual([]);
    });

    it('takes a new time at once, counting from the last touch', () => {
        const { calls, timer, touch } = setUp();
        touch();
        timer.set(30);
        vi.advanceTimersByTime(30_000);
        expect(calls).toEqual([30]);
        touch();
        timer.set(undefined);
        vi.advanceTimersByTime(600_000);
        expect(calls).toEqual([30]);
    });
});
