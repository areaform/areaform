import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    DOCUMENT_SCHEMA_URL,
    fromJSON,
    toJSON,
    type AreaformDocument,
    type Ring,
} from './index.ts';

const booth: Ring = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
];

/** A Document using every kind of element, built through Commands. */
function sampleDocument(): AreaformDocument {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const L1 = doc.levels[0]!.id;
    const run = (command: Parameters<typeof editor.exec>[0]) => {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    };
    run({ type: 'wall.add', levelId: L1, id: 'W1', a: [0, 5], b: [10, 5], thickness: 0.1 });
    run({
        type: 'opening.add',
        levelId: L1,
        opening: {
            id: 'D1',
            kind: 'door',
            width: 0.9,
            host: 'wall',
            wallId: 'W1',
            offset: 4,
            hinge: 'end',
            swing: 'right',
        },
    });
    run({
        type: 'opening.add',
        levelId: L1,
        opening: {
            id: 'E1',
            kind: 'entrance',
            width: 4,
            host: 'free',
            position: [40, 10],
            angle: 0,
        },
    });
    run({
        type: 'zone.add',
        levelId: L1,
        zone: {
            id: 'A-12',
            shape: { outer: booth },
            label: 'A-12',
            category: 'booth',
            style: { fill: '#ffcc00' },
            data: { exhibitor: 'Acme' },
        },
    });
    run({
        type: 'obstacle.add',
        levelId: L1,
        obstacle: { id: 'COL', kind: 'column', shape: { outer: booth } },
    });
    run({
        type: 'underlay.add',
        levelId: L1,
        underlay: {
            id: 'U1',
            src: 'hall.png',
            position: [0, 25],
            scale: 0.02,
            rotation: 0,
            opacity: 0.5,
            locked: true,
        },
    });
    run({ type: 'level.add', id: 'L2', name: 'Gallery' });
    run({
        type: 'connection.add',
        connection: {
            id: 'LIFT',
            kind: 'elevator',
            stops: [L1, 'L2'].map((levelId) => ({ levelId, shape: { outer: booth } })),
            bidirectional: true,
            accessible: true,
        },
    });
    return editor.getDocument();
}

/** A sample Document as plain JSON data, for hand-editing in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests corrupt arbitrary paths
function sampleData(): any {
    return JSON.parse(toJSON(sampleDocument()));
}

describe('toJSON / fromJSON', () => {
    it('round-trips a Document', () => {
        const doc = sampleDocument();

        const loaded = fromJSON(toJSON(doc));

        expect(loaded).toEqual({ ok: true, doc, repairs: [] });
    });

    it('accepts already-parsed data as well as a string', () => {
        const loaded = fromJSON(sampleData());

        expect(loaded.ok).toBe(true);
    });

    it('names the JSON Schema first in the file, and drops it again on load', () => {
        const doc = sampleDocument();

        const json = toJSON(doc);
        const loaded = fromJSON(json);

        expect(Object.entries(JSON.parse(json))[0]).toEqual(['$schema', DOCUMENT_SCHEMA_URL]);
        expect(loaded.ok && loaded.doc).not.toHaveProperty('$schema');
    });

    it('names the current JSON Schema, whatever the Document carried', () => {
        const doc = { ...sampleDocument(), $schema: 'https://example.com/old.json' };

        expect(JSON.parse(toJSON(doc))).toHaveProperty('$schema', DOCUMENT_SCHEMA_URL);
    });

    it('indents the file when asked', () => {
        const doc = sampleDocument();

        const json = toJSON(doc, { indent: 2 });

        expect(json).toMatch(/^\{\n {2}"\$schema": "[^"]+",\n {2}"schemaVersion": 1,\n/);
        expect(JSON.parse(json)).toEqual(JSON.parse(toJSON(doc)));
    });

    it('produces a Document an Editor can work with', () => {
        const loaded = fromJSON(toJSON(sampleDocument()));
        if (!loaded.ok) throw new Error('expected ok');

        const editor = createEditor(loaded.doc);
        const result = editor.exec({
            type: 'zone.delete',
            levelId: loaded.doc.levels[0]!.id,
            zoneId: 'A-12',
        });

        expect(result.ok).toBe(true);
    });
});

describe('fromJSON rejects input that is not a valid Document', () => {
    it('rejects invalid JSON', () => {
        expect(fromJSON('{ nope')).toEqual({ ok: false, errors: [{ code: 'invalid-json' }] });
    });

    it.each([null, 42, '"text"', [], {}])('rejects %j as not a Document', (data) => {
        expect(fromJSON(data)).toEqual({ ok: false, errors: [{ code: 'not-a-document' }] });
    });

    it.each([0, -1, 1.5])('rejects schemaVersion %d', (version) => {
        const data = { ...sampleData(), schemaVersion: version };

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [{ code: 'unsupported-version', version }],
        });
    });

    it.each([2, 99])('rejects schemaVersion %i as written by a newer library', (version) => {
        const data = { ...sampleData(), schemaVersion: version };

        expect(fromJSON(data)).toEqual({ ok: false, errors: [{ code: 'newer-version', version }] });
    });

    it('reports the path of a missing property', () => {
        const data = sampleData();
        delete data.levels[0].walls;

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [{ code: 'malformed', path: 'levels[0].walls', expected: 'array' }],
        });
    });

    it('reports the path of a value with the wrong type', () => {
        const data = sampleData();
        data.levels[0].zones[0].shape.outer[1] = ['3', 0];

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [
                {
                    code: 'malformed',
                    path: 'levels[0].zones[0].shape.outer[1][0]',
                    expected: 'number',
                },
            ],
        });
    });

    it('reports an unknown enumeration value', () => {
        const data = sampleData();
        data.connections[0].kind = 'teleporter';

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [
                {
                    code: 'malformed',
                    path: 'connections[0].kind',
                    expected: "'stairs' | 'elevator' | 'escalator' | 'ramp'",
                },
            ],
        });
    });

    it('reports a Zone label colour that is not a string', () => {
        const data = sampleData();
        data.levels[0].zones[0].labelColor = 42;

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [
                { code: 'malformed', path: 'levels[0].zones[0].labelColor', expected: 'string' },
            ],
        });
    });

    it('reports an unknown door swing', () => {
        const data = sampleData();
        data.levels[0].openings[0].swing = 'inward';

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [
                {
                    code: 'malformed',
                    path: 'levels[0].openings[0].swing',
                    expected: "'left' | 'right'",
                },
            ],
        });
    });

    it('keeps unknown extra properties', () => {
        const data = sampleData();
        data.levels[0].zones[0].futureField = { x: 1 };

        const loaded = fromJSON(data);

        expect(loaded.ok && loaded.doc.levels[0]?.zones[0]).toHaveProperty('futureField', { x: 1 });
    });

    it('rejects a structurally valid Document that breaks Invariants', () => {
        const data = sampleData();
        data.levels[0].walls[0].b = 'ghost-node';

        expect(fromJSON(data)).toEqual({
            ok: false,
            errors: [{ code: 'dangling-reference', id: 'W1', ref: 'ghost-node' }],
        });
    });
});

describe('fromJSON with repair', () => {
    it('drops a Wall with a dangling Wall Node together with its hosted Opening', () => {
        const data = sampleData();
        data.levels[0].walls[0].b = 'ghost-node';

        const loaded = fromJSON(data, { repair: true });

        if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
        const level = loaded.doc.levels[0]!;
        expect(level.walls).toEqual([]);
        expect(level.openings.map((o) => o.id)).toEqual(['E1']);
        expect(loaded.repairs).toEqual([
            {
                error: { code: 'dangling-reference', id: 'W1', ref: 'ghost-node' },
                removed: [{ kind: 'wall', id: 'W1', levelId: level.id }],
            },
            {
                error: { code: 'dangling-reference', id: 'D1', ref: 'W1' },
                removed: [{ kind: 'opening', id: 'D1', levelId: level.id }],
            },
        ]);
    });

    it('keeps the first of two elements with the same id', () => {
        const data = sampleData();
        data.levels[0].zones.push({ ...data.levels[0].zones[0], label: 'Duplicate' });

        const loaded = fromJSON(data, { repair: true });

        expect(loaded.ok && loaded.doc.levels[0]?.zones.map((z) => z.label)).toEqual(['A-12']);
    });

    it('drops a Stop on a missing Level, and the Connection if it is left with one Stop', () => {
        const data = sampleData();
        data.connections[0].stops[1].levelId = 'ghost-level';

        const loaded = fromJSON(data, { repair: true });

        expect(loaded.ok && loaded.doc.connections).toEqual([]);
        expect(loaded.ok && loaded.repairs.map((r) => r.error.code)).toEqual([
            'dangling-reference',
            'too-few-stops',
        ]);
    });

    it('fails when the damage cannot be repaired by removing elements', () => {
        const data = sampleData();
        data.levels[0].outline.outer = [
            [0, 0],
            [1, 1],
        ];

        expect(fromJSON(data, { repair: true })).toEqual({
            ok: false,
            errors: [{ code: 'invalid-shape', id: data.levels[0].id }],
        });
    });
});
