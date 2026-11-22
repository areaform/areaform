import { resolveOpening } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { harness, wallSegments } from './testing.ts';

/** A labelled 2 × 2 m booth Zone at (2, 2) on the test Level, selected. */
function withBooth() {
    const h = harness('exhibition');
    h.editor.exec({
        type: 'zone.add',
        levelId: h.levelId,
        zone: {
            id: 'B1',
            label: 'A-1',
            category: 'booth',
            data: { price: 100 },
            shape: {
                outer: [
                    [2, 2],
                    [4, 2],
                    [4, 4],
                    [2, 4],
                ],
            },
        },
    });
    h.controller.select([{ kind: 'zone', id: 'B1', levelId: h.levelId }]);
    const zones = () => h.level().zones;
    const copyOf = () => zones().find((z) => z.id !== 'B1')!;
    return { ...h, zones, copyOf };
}

const meta = { meta: true };

describe('Copy and paste', () => {
    it('pastes a copy one grid step right and down, selected, as one undo step', () => {
        const h = withBooth();

        expect(h.key('c', meta)).toBe(true);
        expect(h.key('v', meta)).toBe(true);

        const copy = h.copyOf();
        expect(copy.shape.outer).toEqual([
            [3, 1],
            [5, 1],
            [5, 3],
            [3, 3],
        ]);
        expect(copy).toMatchObject({ label: 'A-1', category: 'booth', data: { price: 100 } });
        expect(h.controller.getState().selection).toEqual([
            { kind: 'zone', id: copy.id, levelId: h.levelId },
        ]);
        h.key('z', meta);
        expect(h.zones()).toHaveLength(1);
    });

    it('steps each further paste on by another grid step', () => {
        const h = withBooth();
        h.key('c', meta);
        h.key('v', meta);
        h.key('v', meta);

        const corners = h.zones().map((z) => z.shape.outer[0]);
        expect(corners).toEqual([
            [2, 2],
            [3, 1],
            [4, 0],
        ]);
    });

    it('pastes in place on another Level', () => {
        const h = withBooth();
        h.key('c', meta);
        h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
        h.controller.setLevel('L2');

        h.key('v', meta);

        const upper = h.editor.getDocument().levels.find((l) => l.id === 'L2')!;
        expect(upper.zones.map((z) => z.shape.outer[0])).toEqual([[2, 2]]);
    });

    it('copies Walls with the doors on them', () => {
        const h = harness();
        const { levelId } = h;
        h.editor.exec({ type: 'wall.add', levelId, id: 'W', a: [2, 6], b: [8, 6], thickness: 0.2 });
        h.editor.exec({
            type: 'opening.add',
            levelId,
            opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 2 },
        });
        h.controller.select([{ kind: 'wall', id: 'W', levelId }]);

        h.key('c', meta);
        h.key('v', meta);

        expect(wallSegments(h.level())).toEqual(['2,6 → 8,6', '3,5 → 9,5']);
        const level = h.level();
        const pasted = level.openings.find((o) => o.id !== 'D')!;
        expect(pasted).toMatchObject({ kind: 'door', width: 1, host: 'wall' });
        expect(resolveOpening(level, pasted)!.position).toEqual([5, 5]);
        // The pasted Wall is selected (its door comes with it).
        expect(
            h.controller
                .getState()
                .selection.map((r) => r.kind)
                .sort(),
        ).toEqual(['opening', 'wall']);
    });

    it('places a door on the right piece when the pasted Wall is split by an existing one', () => {
        const h = harness();
        const { levelId } = h;
        h.editor.exec({ type: 'wall.add', levelId, id: 'W', a: [2, 6], b: [8, 6], thickness: 0.2 });
        // X stops short of W, but crosses where the copy will go (y = 5) at x = 6.
        h.editor.exec({
            type: 'wall.add',
            levelId,
            id: 'X',
            a: [6, 2],
            b: [6, 5.5],
            thickness: 0.2,
        });
        h.editor.exec({
            type: 'opening.add',
            levelId,
            opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 4.5 },
        });
        h.controller.select([{ kind: 'wall', id: 'W', levelId }]);

        h.key('c', meta);
        h.key('v', meta);

        const level = h.level();
        const pasted = level.openings.find((o) => o.id !== 'D')!;
        // The copy runs 3 → 9 at y = 5 and is split at x = 6, so its first piece is only 3 m
        // long; the door (4.5 m along) belongs on the second piece, at x = 7.5.
        expect(resolveOpening(level, pasted)!.position).toEqual([7.5, 5]);
    });

    it('⌘D duplicates the selection without touching the clipboard', () => {
        const h = withBooth();
        h.key('c', meta);
        h.editor.exec({
            type: 'zone.add',
            levelId: h.levelId,
            zone: {
                id: 'B2',
                shape: {
                    outer: [
                        [10, 2],
                        [12, 2],
                        [12, 4],
                        [10, 4],
                    ],
                },
            },
        });
        h.controller.select([{ kind: 'zone', id: 'B2', levelId: h.levelId }]);

        h.key('d', meta);
        const afterDuplicate = h.zones().map((z) => z.shape.outer[0]);
        h.key('v', meta);

        expect(afterDuplicate).toContainEqual([11, 1]);
        expect(h.zones().map((z) => z.shape.outer[0])).toContainEqual([3, 1]);
    });

    it('⌘X removes the selection; the next paste puts it back in place', () => {
        const h = withBooth();

        h.key('x', meta);
        expect(h.zones()).toEqual([]);
        h.key('v', meta);

        expect(h.zones().map((z) => z.shape.outer[0])).toEqual([[2, 2]]);
    });

    it('does nothing (and lets the key through) with nothing to copy or paste', () => {
        const h = harness();

        expect(h.key('c', meta)).toBe(false);
        expect(h.key('v', meta)).toBe(false);
        expect(h.key('d', meta)).toBe(false);
    });
});

describe('System clipboard text', () => {
    it('round-trips a copy through text into another Document, in place', () => {
        const h = withBooth();
        h.controller.copy();
        const text = h.controller.clipboardText()!;
        expect(JSON.parse(text)).toMatchObject({ format: 'areaform/clip', version: 1 });

        const other = harness('exhibition');
        expect(other.controller.pasteText(text)).toBe(true);

        const pasted = other.level().zones;
        expect(pasted).toHaveLength(1);
        expect(pasted[0]).toMatchObject({ label: 'A-1', category: 'booth' });
        expect(pasted[0]!.shape.outer[0]).toEqual([2, 2]);
        expect(other.controller.getState().selection).toHaveLength(1);
    });

    it('steps on like an ordinary paste when pasted back into the same Level', () => {
        const h = withBooth();
        h.controller.copy();
        const text = h.controller.clipboardText()!;

        h.controller.pasteText(text);
        h.controller.pasteText(text);

        expect(h.zones().map((z) => z.shape.outer[0])).toEqual([
            [2, 2],
            [3, 1],
            [4, 0],
        ]);
    });

    it('ignores text that is not a copied selection, without throwing', () => {
        const h = harness();

        for (const text of ['', 'hello', '{"format":"areaform/clip","version":1}', '{"zones":3}'])
            expect(h.controller.pasteText(text)).toBe(false);
        expect(h.level().zones).toEqual([]);
    });

    it('has no text before anything is copied', () => {
        expect(harness().controller.clipboardText()).toBeNull();
    });
});
