import { fromJSON, type AreaformDocument } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import frozen from '../../server/demo/expo.json?raw';
import { sampleExpo } from './sampleExpo.ts';

/** What a visitor sees of each Level: its Zones, by id. Walls get new ids on every build. */
const zonesOf = (doc: AreaformDocument) =>
    doc.levels.map((level) => ({
        name: level.name,
        zones: level.zones.map(({ id, label, category, shape }) => ({
            id,
            label,
            category,
            shape,
        })),
    }));

describe('the Expo demo', () => {
    it('is the one the demo Space sp_demo-expo publishes (apps/server/demo/expo.json)', () => {
        // Built again by Commands on every load, so the seed keeps a copy; after a change here,
        // write the copy again from `sampleExpo()`.
        const loaded = fromJSON(frozen);
        if (!loaded.ok) throw new Error('apps/server/demo/expo.json does not load');
        expect(zonesOf(loaded.doc)).toEqual(zonesOf(sampleExpo()));
    });
});
