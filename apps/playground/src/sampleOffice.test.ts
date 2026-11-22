import { diagnose } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { importFlags } from './draftImport.ts';
import { sampleOffice } from './sampleOffice.ts';

describe('the Office demo', () => {
    it('loads three Levels joined by stairs, lifts and a car ramp, with no Diagnostics', () => {
        const doc = sampleOffice();

        expect(doc.levels.map((level) => level.name)).toEqual([
            'Ground floor',
            'P1 Parking',
            'B2 Technical',
        ]);
        expect(doc.connections.map((c) => c.kind).sort()).toEqual([
            'elevator',
            'elevator',
            'ramp',
            'stairs',
            'stairs',
        ]);
        expect(diagnose(doc)).toEqual([]);
    });

    it('has no Import Flags left to review', () => {
        expect(importFlags(sampleOffice())).toEqual([]);
    });

    it('shows its Figma frame under the ground floor', () => {
        const ground = sampleOffice().levels[0]!;

        expect(ground.underlays.map((u) => u.src)).toEqual(['sample-office-source.png']);
    });
});
