import { describe, expect, it, vi } from 'vitest';
import { createPlaceCard } from './placeCard.ts';

const UNIT = { id: 'unit-g12', levelId: 'ground' };

describe("the place card's buttons from other Plugins", () => {
    it('gives each card the buttons that name it, in the order they were added', () => {
        const card = createPlaceCard();
        card.add((zone) => (zone.id === 'unit-g12' ? { label: 'See inside', run() {} } : null));
        card.add(() => ({ label: 'Share', run() {} }));
        expect(card.buttons(UNIT).map((b) => b.label)).toEqual(['See inside', 'Share']);
        expect(card.buttons({ id: 'unit-g08', levelId: 'ground' }).map((b) => b.label)).toEqual([
            'Share',
        ]);
    });

    it('has the host draw it again when a button comes, changes or goes', () => {
        const card = createPlaceCard();
        const redraw = vi.fn();
        expect(card.hosted()).toBe(false);
        const end = card.host(redraw);
        expect(card.hosted()).toBe(true);

        const remove = card.add(() => null);
        card.changed();
        remove();
        expect(redraw).toHaveBeenCalledTimes(3);
        expect(card.buttons(UNIT)).toEqual([]);

        end();
        expect(card.hosted()).toBe(false);
        card.changed();
        expect(redraw).toHaveBeenCalledTimes(3);
    });
});
