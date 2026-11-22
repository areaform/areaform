import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromJSON } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { saveDraft, saveGeoJSON } from './save.ts';
import { createDraftSession, DraftError } from './session.ts';
import { png } from './testImages.ts';

function folder() {
    return mkdtempSync(join(tmpdir(), 'areaform-save-'));
}

function draftWithSource() {
    const session = createDraftSession();
    session.create({ name: 'Hall A', kind: 'exhibition' });
    session.calibrate([0, 0], [100, 0], 10, [300, 200]);
    const image = join(folder(), 'Hall shot.png');
    writeFileSync(image, png(300, 200));
    session.attachSource({ path: image, type: 'png', size: [300, 200] });
    return { session, image };
}

describe('saveDraft', () => {
    it('writes a plan that loads back as the same Document', () => {
        const session = createDraftSession();
        session.create({ name: 'Hall A', kind: 'exhibition' });
        const dir = join(folder(), 'drafts', 'hall-a');
        const saved = saveDraft(session, dir);
        expect(saved).toEqual({ plan: join(dir, 'plan.json') });
        const loaded = fromJSON(readFileSync(saved.plan, 'utf8'));
        expect(loaded.ok && loaded.doc).toEqual(session.document());
    });

    it('copies the Source image under the name its Underlay refers to', () => {
        const { session, image } = draftWithSource();
        const dir = folder();
        const saved = saveDraft(session, dir);
        expect(saved.source).toBe(join(dir, 'source.png'));
        expect(readFileSync(saved.source!)).toEqual(readFileSync(image));
    });

    it('does not replace a plan unless asked', () => {
        const session = createDraftSession();
        session.create({ name: 'Hall A', kind: 'exhibition' });
        const dir = folder();
        saveDraft(session, dir);
        expect(() => saveDraft(session, dir)).toThrow(/already exists/);
        expect(() => saveDraft(session, dir, { overwrite: true })).not.toThrow();
    });

    it('stops before writing anything if the Source image is gone', () => {
        const session = createDraftSession();
        session.create({ name: 'Hall A', kind: 'exhibition' });
        session.calibrate([0, 0], [100, 0], 10, [300, 200]);
        session.attachSource({ path: join(folder(), 'gone.png'), type: 'png', size: [300, 200] });
        const dir = join(folder(), 'out');
        expect(() => saveDraft(session, dir)).toThrow(DraftError);
        expect(existsSync(dir)).toBe(false);
    });
});

describe('saveGeoJSON', () => {
    it('writes plan.geojson in local metres for a Draft without a georeference', () => {
        const session = createDraftSession();
        session.create({ name: 'Hall A', kind: 'exhibition' });
        const dir = join(folder(), 'hall-a');

        const saved = saveGeoJSON(session, dir);

        expect(saved).toEqual({ geojson: join(dir, 'plan.geojson'), coordinateSystem: 'local' });
        const written = JSON.parse(readFileSync(saved.geojson, 'utf8'));
        expect(written).toMatchObject({ type: 'FeatureCollection', name: 'Hall A' });
        expect(written.features[0].properties.featureType).toBe('level');
    });

    it('does not replace a GeoJSON file unless asked', () => {
        const session = createDraftSession();
        session.create({ name: 'Hall A', kind: 'exhibition' });
        const dir = folder();
        saveGeoJSON(session, dir);
        expect(() => saveGeoJSON(session, dir)).toThrow(/already exists/);
        expect(() => saveGeoJSON(session, dir, { overwrite: true })).not.toThrow();
    });
});
