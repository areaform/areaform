import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDraft } from './open.ts';
import { saveDraft } from './save.ts';
import { createDraftSession, DraftError } from './session.ts';
import { png } from './testImages.ts';

function folder() {
    return mkdtempSync(join(tmpdir(), 'areaform-open-'));
}

describe('openDraft', () => {
    it('opens a saved Draft folder with its Source image', () => {
        const saved = createDraftSession();
        saved.create({ name: 'Hall A', kind: 'exhibition' });
        saved.calibrate([0, 0], [100, 0], 10, [300, 200]);
        const image = join(folder(), 'shot.png');
        writeFileSync(image, png(300, 200));
        saved.attachSource({ path: image, type: 'png', size: [300, 200] });
        saved.flag(saved.document().levels[0]!.id, 'Outline traced from a shadow');
        const dir = folder();
        saveDraft(saved, dir);

        const session = createDraftSession();
        const opened = openDraft(session, dir);
        expect(opened).toEqual({
            plan: join(dir, 'plan.json'),
            source: join(dir, 'source.png'),
            repairs: [],
        });
        expect(session.document()).toEqual(saved.document());
        expect(session.flags()).toHaveLength(1);
        expect(session.sourceFile()).toBe(join(dir, 'source.png'));
    });

    it('opens a plan file that is not a Draft, and saves it back in place', () => {
        const first = createDraftSession();
        first.create({ name: 'Hall A', kind: 'exhibition' });
        const plan = join(folder(), 'plan.json');
        const doc = { ...first.document(), meta: {} };
        writeFileSync(plan, JSON.stringify(doc));

        const session = createDraftSession();
        expect(openDraft(session, plan)).toEqual({ plan, repairs: [] });
        expect(session.document()).toEqual(doc);
        expect(session.flags()).toEqual([]);
        expect(() => saveDraft(session, join(plan, '..'), { overwrite: true })).not.toThrow();
    });

    it('reports a missing or broken plan', () => {
        const session = createDraftSession();
        const dir = folder();
        expect(() => openDraft(session, dir)).toThrow(/plan\.json does not exist/);
        writeFileSync(join(dir, 'plan.json'), '{ not json');
        expect(() => openDraft(session, dir)).toThrow(DraftError);
        expect(() => openDraft(session, dir)).toThrow(/invalid-json/);
    });
});
