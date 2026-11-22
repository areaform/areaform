import { createSpace, type AreaformDocument, type Zone } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { matchZones } from './matchZones.ts';
import { DraftError } from './session.ts';

const square = (x: number) => ({
    outer: [
        [x, 0],
        [x + 2, 0],
        [x + 2, 2],
        [x, 2],
    ] as [number, number][],
});

function hall(zones: Omit<Zone, 'shape'>[]): AreaformDocument {
    const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [40, 10] });
    const level = doc.levels[0]!;
    return {
        ...doc,
        levels: [{ ...level, zones: zones.map((zone, i) => ({ ...zone, shape: square(i * 3) })) }],
    };
}

const doc = hall([
    { id: 'z1', label: 'A1', category: 'booth' },
    { id: 'z2', label: 'A-2', category: 'booth', data: { externalId: 7, note: 'corner' } },
    { id: 'z3', label: 'A3', category: 'booth' },
    { id: 'aisle', label: 'A1', category: 'aisle' },
]);
const levelId = doc.levels[0]!.id;

describe('matchZones', () => {
    it('matches by label ignoring case and separators, and proposes the changes', () => {
        const result = matchZones(
            doc,
            [
                { booth: 'a 1', company: 'Acme', id: 41 },
                { booth: 'A2', company: 'Beta', id: 7 },
            ],
            {
                key: 'booth',
                by: 'label',
                category: 'booth',
                set: { 'data.externalId': 'id', 'data.exhibitor': 'company' },
            },
        );
        expect(result.matched).toEqual([
            { zoneId: 'z1', levelId, label: 'A1', row: 0, key: 'a 1' },
            { zoneId: 'z2', levelId, label: 'A-2', row: 1, key: 'A2' },
        ]);
        expect(result.commands).toEqual([
            {
                type: 'zone.update',
                levelId,
                zoneId: 'z1',
                changes: { data: { externalId: 41, exhibitor: 'Acme' } },
            },
            {
                type: 'zone.update',
                levelId,
                zoneId: 'z2',
                // The keys the row doesn't set are kept.
                changes: { data: { externalId: 7, note: 'corner', exhibitor: 'Beta' } },
            },
        ]);
        expect(result.unmatchedZones).toEqual([{ zoneId: 'z3', levelId, label: 'A3' }]);
        expect(result.counts).toEqual({ rows: 2, zones: 3, matched: 2, updates: 2 });
    });

    it('compares exactly when asked', () => {
        const result = matchZones(doc, [{ booth: 'A2' }], {
            key: 'booth',
            by: 'label',
            exact: true,
        });
        expect(result.unmatchedRows).toEqual([{ row: 0, key: 'A2' }]);
    });

    it('matches by a data key, and proposes nothing for a Zone already up to date', () => {
        const result = matchZones(doc, [{ id: '7', name: 'A-2' }], {
            key: 'id',
            by: 'data.externalId',
            set: { label: 'name' },
        });
        expect(result.matched.map((m) => m.zoneId)).toEqual(['z2']);
        expect(result.commands).toEqual([]);
    });

    it('reports what does not match one to one, and proposes nothing for it', () => {
        const result = matchZones(
            doc,
            [
                { booth: 'A1' },
                { booth: 'A3', company: 'One' },
                { booth: 'a3', company: 'Two' },
                { booth: 'B9' },
                { booth: '' },
                { company: 'No booth' },
            ],
            { key: 'booth', by: 'label', set: { 'data.exhibitor': 'company' } },
        );
        expect(result.ambiguous).toEqual([
            {
                row: 0,
                key: 'A1',
                zones: [
                    { zoneId: 'z1', levelId, label: 'A1' },
                    { zoneId: 'aisle', levelId, label: 'A1' },
                ],
            },
        ]);
        expect(result.duplicateRows).toEqual([
            { zoneId: 'z3', levelId, label: 'A3', rows: [1, 2], key: 'A3' },
        ]);
        expect(result.unmatchedRows).toEqual([{ row: 3, key: 'B9' }]);
        expect(result.rowsWithoutKey).toEqual([4, 5]);
        expect(result.unmatchedZones).toEqual([{ zoneId: 'z2', levelId, label: 'A-2' }]);
        expect(result.matched).toEqual([]);
        expect(result.commands).toEqual([]);
    });

    it('sets the label and category as text', () => {
        const result = matchZones(doc, [{ booth: 'A3', no: 3, kind: 'kiosk' }], {
            key: 'booth',
            by: 'label',
            category: 'booth',
            set: { label: 'no', category: 'kind' },
        });
        expect(result.commands[0]!.changes).toEqual({ label: '3', category: 'kiosk' });
    });

    it('rejects an unknown Level', () => {
        expect(() =>
            matchZones(doc, [{ booth: 'A1' }], { key: 'booth', by: 'label', levelId: 'nope' }),
        ).toThrow(DraftError);
    });
});
