import type { Command, Ring } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createDraftSession, DraftError, NoDraftError } from './session.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

function hall() {
    const session = createDraftSession();
    const doc = session.create({ name: 'Hall A', kind: 'exhibition', size: [30, 20] });
    return { session, levelId: doc.levels[0]!.id };
}

describe('createDraftSession', () => {
    it('refuses to work before a Draft exists', () => {
        const session = createDraftSession();
        expect(() => session.document()).toThrow(NoDraftError);
        expect(() => session.apply([])).toThrow(NoDraftError);
    });

    it('starts a Draft from the Preset of its Space Kind', () => {
        const { session } = hall();
        const doc = session.document();
        expect(doc.kind).toBe('exhibition');
        expect(doc.levels).toHaveLength(1);
        expect(doc.levels[0]!.outline.outer).toContainEqual([30, 20]);
        expect(session.preset().categories.length).toBeGreaterThan(0);
    });

    it('applies a batch and returns the Diagnostics', () => {
        const { session, levelId } = hall();
        const result = session.apply([
            { type: 'wall.add', levelId, id: 'W', a: [0, 10], b: [30, 10], thickness: 0.2 },
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: square(1, 1, 3) } } },
            { type: 'zone.add', levelId, zone: { id: 'B2', shape: { outer: square(40, 1, 3) } } },
        ]);
        expect(result).toMatchObject({ ok: true, applied: 3 });
        expect(result.ok && result.diagnostics).toContainEqual({
            code: 'outside-outline',
            ref: { kind: 'zone', levelId, id: 'B2' },
        });
        expect(session.document().levels[0]!.zones.map((z) => z.id)).toEqual(['B1', 'B2']);
    });

    it('rejects the whole batch and names the first failing Command', () => {
        const { session, levelId } = hall();
        const before = session.document();
        const result = session.apply([
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: square(1, 1, 3) } } },
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: square(5, 1, 3) } } },
        ]);
        expect(result).toEqual({
            ok: false,
            failedAt: 1,
            errors: [{ code: 'duplicate-id', id: 'B1' }],
        });
        expect(session.document()).toBe(before);
    });

    it('does not blame a Command whose broken Invariant a later Command mends', () => {
        const { session, levelId } = hall();
        const result = session.apply([
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: [[1, 1]] } } },
            {
                type: 'zone.update',
                levelId,
                zoneId: 'B1',
                changes: { shape: { outer: square(1, 1, 3) } },
            },
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: square(5, 1, 3) } } },
        ]);
        expect(result).toMatchObject({ ok: false, failedAt: 2 });
    });

    it('reports a Command that throws instead of crashing', () => {
        const { session, levelId } = hall();
        const result = session.apply([{ type: 'zone.add', levelId } as unknown as Command]);
        expect(result).toMatchObject({ ok: false, failedAt: 0, errors: [{ code: 'bad-command' }] });
    });

    it('reports an unknown Command type', () => {
        const { session } = hall();
        const result = session.apply([{ type: 'booth.add' } as unknown as Command]);
        expect(result).toMatchObject({
            ok: false,
            errors: [{ code: 'bad-command', message: expect.stringContaining('booth.add') }],
        });
    });

    it('rejects a Command that would leave the Document malformed', () => {
        const { session, levelId } = hall();
        const zone = { id: 'B1', shape: { outer: square(1, 1, 3) }, label: 42 };
        const result = session.apply([{ type: 'zone.add', levelId, zone } as unknown as Command]);
        expect(result).toMatchObject({ ok: false, failedAt: 0, errors: [{ code: 'malformed' }] });
        expect(session.document().levels[0]!.zones).toEqual([]);
    });
});

describe('the Source', () => {
    const at = new Date('2026-10-22T12:00:00Z');

    function calibrated() {
        const session = createDraftSession({ now: () => at });
        session.create({ name: 'Hall A', kind: 'exhibition' });
        // 100 units are 10 m, so 0.1 m per unit; the Source is 30 × 20 m.
        session.calibrate([0, 0], [100, 0], 10, [300, 200]);
        return session;
    }

    it('records when the Draft was started', () => {
        const session = createDraftSession({ now: () => at });
        const doc = session.create({ name: 'Hall A', kind: 'exhibition' });
        expect(doc.meta).toEqual({ import: { importedAt: '2026-10-22T12:00:00.000Z' } });
    });

    it('keeps the calibration in the Document, so it is saved and undone with it', () => {
        const session = calibrated();
        expect(session.calibration()).toEqual({ scale: 0.1, size: [300, 200] });
        expect(session.document().meta?.['import']).toMatchObject({
            scale: 0.1,
            sourceSize: [300, 200],
        });
    });

    it('converts Source points to plan metres, Y up', () => {
        expect(
            calibrated().toPlan([
                [0, 200],
                [300, 0],
                [100, 50],
            ]),
        ).toEqual([
            [0, 0],
            [30, 20],
            [10, 15],
        ]);
    });

    it('needs a calibration before converting or attaching', () => {
        const session = createDraftSession();
        session.create({ name: 'Hall A', kind: 'exhibition' });
        expect(() => session.toPlan([[0, 0]])).toThrow(DraftError);
        expect(() =>
            session.attachSource({ path: '/x/hall.png', type: 'png', size: [300, 200] }),
        ).toThrow(/calibrate first/);
    });

    it('rejects an unusable calibration', () => {
        const session = calibrated();
        expect(() => session.calibrate([5, 5], [5, 5], 10, [300, 200])).toThrow(DraftError);
        expect(() => session.calibrate([0, 0], [1, 0], 10, [0, 200])).toThrow(DraftError);
    });

    it('lays the Source image over the calibrated Source, whatever its resolution', () => {
        const session = calibrated();
        const underlay = session.attachSource({
            path: '/shots/Hall.PNG',
            type: 'png',
            size: [600, 400],
        });
        expect(underlay).toEqual({
            id: 'import-source',
            src: 'source.png',
            position: [0, 20],
            scale: 0.05,
            rotation: 0,
            opacity: 0.5,
            locked: true,
            size: [600, 400],
        });
        expect(session.document().levels[0]!.underlays).toEqual([underlay]);
        expect(session.document().meta?.['import']).toMatchObject({
            source: { kind: 'image', ref: 'Hall.PNG' },
            underlayId: 'import-source',
        });
        expect(session.sourceFile()).toBe('/shots/Hall.PNG');
    });

    it('records the Figma frame as the Source when given', () => {
        const session = calibrated();
        const figmaUrl = 'https://www.figma.com/design/abc/Hall?node-id=1-2';
        session.attachSource({ path: '/shots/frame.png', type: 'png', size: [300, 200], figmaUrl });
        expect(session.document().meta?.['import']).toMatchObject({
            source: { kind: 'figma', ref: figmaUrl },
        });
    });

    it('rejects an image whose aspect ratio does not match the Source', () => {
        expect(() =>
            calibrated().attachSource({ path: '/x/a.png', type: 'png', size: [300, 300] }),
        ).toThrow(/aspect ratio/);
    });

    it('replaces an earlier Source image', () => {
        const session = calibrated();
        session.attachSource({ path: '/x/a.png', type: 'png', size: [300, 200] });
        session.attachSource({ path: '/x/b.jpg', type: 'jpeg', size: [150, 100] });
        expect(session.document().levels[0]!.underlays).toMatchObject([
            { src: 'source.jpg', scale: 0.2 },
        ]);
        expect(session.sourceFile()).toBe('/x/b.jpg');
    });

    it('moves the Source image along when calibrated again', () => {
        const session = calibrated();
        session.attachSource({ path: '/x/a.png', type: 'png', size: [600, 400] });
        session.calibrate([0, 0], [100, 0], 20, [300, 200]);
        expect(session.document().levels[0]!.underlays[0]).toMatchObject({
            scale: 0.1,
            position: [0, 40],
        });
    });

    it('refuses a calibration that no longer fits the Source image', () => {
        const session = calibrated();
        session.attachSource({ path: '/x/a.png', type: 'png', size: [600, 400] });
        expect(() => session.calibrate([0, 0], [100, 0], 10, [300, 300])).toThrow(/aspect ratio/);
        expect(session.calibration()).toEqual({ scale: 0.1, size: [300, 200] });
    });
});

describe('Import Flags', () => {
    function drawn() {
        const { session, levelId } = hall();
        session.apply([
            { type: 'wall.add', levelId, id: 'W', a: [0, 10], b: [30, 10], thickness: 0.2 },
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: square(1, 1, 3) } } },
            { type: 'zone.add', levelId, zone: { id: 'B2', shape: { outer: square(5, 1, 3) } } },
        ]);
        return { session, levelId };
    }

    it('records what to check, on which Level, in meta.import', () => {
        const { session, levelId } = drawn();
        session.flag('B1', "Unknown category 'lounge'", '12:34');
        session.flag(levelId, 'Outline guessed from the shadow');
        expect(session.flags()).toEqual([
            {
                ref: { kind: 'zone', id: 'B1', levelId },
                reason: "Unknown category 'lounge'",
                sourceRef: '12:34',
            },
            { ref: { kind: 'level', id: levelId }, reason: 'Outline guessed from the shadow' },
        ]);
        expect(session.document().meta?.['import']).toMatchObject({ flags: session.flags() });
    });

    it('finds Walls and Wall Nodes too', () => {
        const { session, levelId } = drawn();
        const nodeId = session.document().levels[0]!.walls[0]!.a;
        session.flag('W', 'Thickness guessed');
        session.flag(nodeId, 'Corner unclear');
        expect(session.flags().map((f) => f.ref)).toEqual([
            { kind: 'wall', id: 'W', levelId },
            { kind: 'wallNode', id: nodeId, levelId },
        ]);
    });

    it('keeps the same reason on the same Element once', () => {
        const { session } = drawn();
        session.flag('B1', 'Label unreadable');
        session.flag('B1', 'Label unreadable');
        session.flag('B1', 'Category guessed');
        expect(session.flags().map((f) => f.reason)).toEqual([
            'Label unreadable',
            'Category guessed',
        ]);
    });

    it('refuses an unknown id or an empty reason', () => {
        const { session } = drawn();
        expect(() => session.flag('B9', 'Check')).toThrow(DraftError);
        expect(() => session.flag('B1', '  ')).toThrow(DraftError);
        expect(session.flags()).toEqual([]);
    });

    it('drops the flags of deleted Elements and reports them', () => {
        const { session, levelId } = drawn();
        session.flag('B1', 'Label unreadable');
        session.flag('B2', 'Category guessed');
        const result = session.apply([{ type: 'zone.delete', levelId, zoneId: 'B1' }]);
        expect(result).toMatchObject({
            ok: true,
            droppedFlags: [{ ref: { id: 'B1' }, reason: 'Label unreadable' }],
        });
        expect(session.flags().map((f) => f.ref.id)).toEqual(['B2']);
    });

    it('reports no dropped flags when none were affected', () => {
        const { session, levelId } = drawn();
        session.flag('B2', 'Category guessed');
        const result = session.apply([{ type: 'zone.delete', levelId, zoneId: 'B1' }]);
        expect(result).not.toHaveProperty('droppedFlags');
    });
});

describe('source refs', () => {
    it('records where added Elements came from and forgets deleted ones', () => {
        const { session, levelId } = hall();
        session.expectSourceRefs({ B1: '1:8', B2: '1:10', B9: '1:99' });
        session.apply([
            { type: 'zone.add', levelId, zone: { id: 'B1', shape: { outer: square(1, 1, 3) } } },
            { type: 'zone.add', levelId, zone: { id: 'B2', shape: { outer: square(5, 1, 3) } } },
        ]);
        expect(session.document().meta?.['import']).toMatchObject({
            sourceRefs: { B1: '1:8', B2: '1:10' },
        });
        session.apply([{ type: 'zone.delete', levelId, zoneId: 'B1' }]);
        expect(session.document().meta?.['import']).toMatchObject({ sourceRefs: { B2: '1:10' } });
        // B9 arrives later and is still expected.
        session.apply([
            { type: 'zone.add', levelId, zone: { id: 'B9', shape: { outer: square(9, 1, 3) } } },
        ]);
        expect(session.document().meta?.['import']).toMatchObject({
            sourceRefs: { B2: '1:10', B9: '1:99' },
        });
    });
});
