import { describe, expect, it } from 'vitest';
import {
    cameraLiteral,
    flyToLine,
    lookAtPointLine,
    lookAtZoneLine,
    setLevelLine,
} from './pageLines.ts';

describe('what the Editor copies for a page', () => {
    it('a flyTo line by id, with the name in a comment on one line', () => {
        expect(flyToLine({ id: 'vp_1', name: 'The  garden\nfrom the east' })).toBe(
            "el.areaform.flyTo('vp_1'); // The garden from the east",
        );
        expect(flyToLine({ id: 'vp_2' })).toBe("el.areaform.flyTo('vp_2');");
    });

    it('a setLevel line and a lookAt line for a Zone, by id', () => {
        expect(setLevelLine({ id: 'level-p1', name: 'P1 Parking' })).toBe(
            "el.areaform.setLevel('level-p1'); // P1 Parking",
        );
        expect(lookAtZoneLine({ id: 'b3-z2', label: 'Room 3.2' })).toBe(
            "el.areaform.lookAt('b3-z2'); // Room 3.2",
        );
    });

    it('a lookAt line for a point, to the centimetre', () => {
        expect(lookAtPointLine([12.504, -0.001])).toBe('el.areaform.lookAt([12.5, 0]);');
    });

    it('the camera to the centimetre, with its Level', () => {
        expect(
            cameraLiteral({
                position: [1.234, 20.005, -0.0001],
                target: [3, 0, -4.5],
                levelId: 'G',
            }),
        ).toBe("{ position: [1.23, 20.01, 0], target: [3, 0, -4.5], levelId: 'G' }");
    });
});
