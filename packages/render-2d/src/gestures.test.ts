import { describe, expect, it } from 'vitest';
import { wheelGoesToPage } from './gestures.ts';

describe('wheelGoesToPage', () => {
    it('under cooperative gestures, a plain wheel scrolls the page', () => {
        expect(wheelGoesToPage('cooperative', {})).toBe(true);
    });

    it('⌘ or Ctrl + wheel, and a trackpad pinch (which comes with Ctrl), go to the plan', () => {
        expect(wheelGoesToPage('cooperative', { metaKey: true })).toBe(false);
        expect(wheelGoesToPage('cooperative', { ctrlKey: true })).toBe(false);
    });

    it('a greedy plan takes every wheel', () => {
        expect(wheelGoesToPage('greedy', {})).toBe(false);
    });
});
