import { describe, expect, it } from 'vitest';
import {
    containsPoint,
    containsRing,
    createEditor,
    createSpace,
    zoneAt,
    type Ring,
} from '../index.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

/** A hall Zone with a hole, and a booth drawn on top of the hall. */
function hall() {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    editor.exec({
        type: 'zone.add',
        levelId,
        zone: { id: 'HALL', shape: { outer: square(0, 0, 20), holes: [square(14, 14, 4)] } },
    });
    editor.exec({
        type: 'zone.add',
        levelId,
        zone: { id: 'A-12', shape: { outer: square(2, 2, 3) } },
    });
    return editor.getDocument().levels[0]!;
}

describe('zoneAt', () => {
    it('finds the Zone under a point', () => {
        expect(zoneAt(hall(), [10, 10])?.id).toBe('HALL');
    });

    it('prefers the topmost Zone where Zones overlap', () => {
        expect(zoneAt(hall(), [3, 3])?.id).toBe('A-12');
    });

    it('counts a point on the edge as inside', () => {
        expect(zoneAt(hall(), [5, 3])?.id).toBe('A-12');
    });

    it('finds nothing in a hole or outside every Zone', () => {
        expect(zoneAt(hall(), [16, 16])).toBeUndefined();
        expect(zoneAt(hall(), [30, 10])).toBeUndefined();
    });
});

describe('containsPoint', () => {
    const atrium = { outer: square(0, 0, 10), holes: [square(4, 4, 2)] };

    it('is true inside and on the edge, false in a hole or outside', () => {
        expect(containsPoint(atrium, [1, 1])).toBe(true);
        expect(containsPoint(atrium, [0, 5])).toBe(true);
        expect(containsPoint(atrium, [5, 5])).toBe(false);
        expect(containsPoint(atrium, [11, 5])).toBe(false);
    });
});

describe('containsRing', () => {
    /** An L: a 20 × 10 m rectangle with the top-right 8 × 5 m notched out. */
    const ell = {
        outer: [
            [0, 0],
            [20, 0],
            [20, 5],
            [12, 5],
            [12, 10],
            [0, 10],
        ] as Ring,
    };

    it('accepts a ring inside the shape, touching its edge allowed', () => {
        expect(containsRing(ell, square(2, 2, 3))).toBe(true);
        expect(containsRing(ell, square(0, 0, 3))).toBe(true);
    });

    it('rejects a ring whose corners are all inside but an edge leaves the shape', () => {
        const acrossNotch: Ring = [
            [10, 4],
            [19, 4],
            [10, 9],
        ];
        expect(acrossNotch.every((p) => containsPoint(ell, p))).toBe(true);

        expect(containsRing(ell, acrossNotch)).toBe(false);
    });

    it('rejects a ring around a hole of the shape', () => {
        const holed = { outer: square(0, 0, 10), holes: [square(4, 4, 2)] };
        expect(containsRing(holed, square(3, 3, 4))).toBe(false);
    });
});
