import { describe, expect, it } from 'vitest';
import { harness } from '../testing.ts';

/** The test Level `G` plus `L2`, joined by a lift, and a booth on G. */
function withLift() {
    const h = harness();
    const G = h.levelId;
    h.editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
    const shape = {
        outer: [
            [18, 8],
            [19, 8],
            [19, 9],
            [18, 9],
        ] as [number, number][],
    };
    h.editor.exec({
        type: 'connection.add',
        connection: {
            id: 'LIFT',
            kind: 'elevator',
            stops: [G, 'L2'].map((levelId) => ({ levelId, shape })),
            bidirectional: true,
        },
    });
    h.editor.exec({
        type: 'zone.add',
        levelId: G,
        zone: {
            id: 'Z',
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
    const offer = () => h.controller.getState().extendOffer;
    return { ...h, offer };
}

describe('Offer to extend Connections after duplicating a Level', () => {
    it('is made when the duplicated Level has Connections, and names the copy', () => {
        const h = withLift();

        const copyId = h.controller.duplicateLevel(h.levelId);

        expect(copyId).toBeTruthy();
        expect(h.offer()).toEqual({ copyId, sourceId: h.levelId });
    });

    it('is not made for a Level without Connections', () => {
        const h = withLift();

        h.controller.duplicateLevel('L2');
        h.editor.exec({ type: 'connection.delete', connectionId: 'LIFT' });
        h.controller.duplicateLevel('L2');

        expect(h.offer()).toBeNull();
    });

    it('survives selecting something on the copy', () => {
        const h = withLift();
        const copyId = h.controller.duplicateLevel(h.levelId)!;
        h.controller.setLevel(copyId);

        const zone = h.editor.getDocument().levels.find((l) => l.id === copyId)!.zones[0]!;
        h.controller.select([{ kind: 'zone', id: zone.id, levelId: copyId }]);
        h.controller.select([]);

        expect(h.offer()).toEqual({ copyId, sourceId: h.levelId });
    });

    it('goes away on Done', () => {
        const h = withLift();
        h.controller.duplicateLevel(h.levelId);

        h.controller.dismissExtendOffer();

        expect(h.offer()).toBeNull();
    });

    it('goes away once every Connection is extended, or when the copy is undone', () => {
        const h = withLift();
        const copyId = h.controller.duplicateLevel(h.levelId)!;
        const lift = h.editor.getDocument().connections[0]!;
        h.editor.exec({
            type: 'connection.update',
            connectionId: 'LIFT',
            changes: { stops: [...lift.stops, { levelId: copyId, shape: lift.stops[0]!.shape }] },
        });
        expect(h.offer()).toBeNull();

        const again = withLift();
        again.controller.duplicateLevel(again.levelId);
        again.key('z', { meta: true });
        expect(again.offer()).toBeNull();
    });
});
