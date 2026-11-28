// The published JSON Schema (schema/v1/document.json) and the checker the core loads with
// (schema.ts) are written separately. These tests keep them saying the same thing: every
// Document one accepts the other accepts, and every mistake one rejects the other rejects.
//
// Unlike the other core tests, this one calls `checkSchemaV1` directly rather than going through
// `fromJSON`: `fromJSON` also checks the Invariants, which the JSON Schema leaves out on purpose,
// so only the shape check alone can be compared with it.

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { stressSpace } from '../../bench/stressSpace.ts';
import schema from '../../schema/v1/document.json' with { type: 'json' };
import { createSpace } from '../createSpace.ts';
import type { AreaformDocument } from '../model.ts';
import { defaultPresets } from '../presets.ts';
import { checkSchemaV1 } from './schema.ts';
import { DOCUMENT_SCHEMA_URL, fromJSON, toJSON } from './serialization.ts';

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

/** Every optional property made required, so a property added to the model must be added here. */
type EveryProperty<T> = T extends readonly unknown[]
    ? { [K in keyof T]: EveryProperty<T[K]> }
    : T extends object
      ? { [K in keyof T]-?: EveryProperty<T[K]> }
      : T;

const square = (x: number, y: number, size: number): [number, number][] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
];

/** Every property of the model set. The shapes are what is checked, not the meaning. */
const withEveryProperty = {
    schemaVersion: 1,
    id: 'doc',
    name: 'Hall',
    names: { pl: 'Hala' },
    languages: { default: 'en', others: ['pl'] },
    kind: 'exhibition',
    units: 'm',
    grid: { step: 0.5, snap: true },
    geo: { origin: { lat: 52.23, lng: 21.01 }, bearing: 12 },
    levels: [
        {
            id: 'L1',
            name: 'Ground',
            names: { pl: 'Parter' },
            group: 'Pavilion A',
            ordinal: 0,
            elevation: 0,
            height: 4,
            outline: { outer: square(0, 0, 20), holes: [square(8, 8, 2).reverse()] },
            wallNodes: [
                { id: 'N1', position: [0, 5] },
                { id: 'N2', position: [10, 5] },
            ],
            walls: [{ id: 'W1', a: 'N1', b: 'N2', thickness: 0.1, height: 3 }],
            openings: [
                {
                    id: 'D1',
                    kind: 'door',
                    width: 0.9,
                    hinge: 'end',
                    swing: 'right',
                    host: 'wall',
                    wallId: 'W1',
                    offset: 4,
                },
                {
                    id: 'E1',
                    kind: 'entrance',
                    width: 4,
                    hinge: 'start',
                    swing: 'left',
                    host: 'free',
                    position: [20, 10],
                    angle: 1.5,
                },
            ],
            zones: [
                {
                    id: 'Z1',
                    shape: { outer: square(1, 1, 3), holes: [] },
                    label: 'A-1',
                    labels: { pl: 'A-1' },
                    labelAnchor: [2.5, 2.5],
                    labelSize: 0.6,
                    labelColor: '#123456',
                    category: 'booth',
                    restricted: false,
                    walkAround: true,
                    innerSpace: { space: 'sp_volt', fit: { x: 1, y: 1, rotation: 0.5 } },
                    style: { fill: '#eeeeee', stroke: '#333333', opacity: 0.8 },
                    data: { exhibitorId: 42 },
                },
            ],
            obstacles: [
                { id: 'O1', shape: { outer: square(15, 15, 0.5), holes: [] }, kind: 'column' },
            ],
            underlays: [
                {
                    id: 'U1',
                    src: 'plan.png',
                    position: [0, 20],
                    scale: 0.01,
                    rotation: 0,
                    opacity: 0.5,
                    locked: true,
                    size: [2000, 2000],
                },
            ],
            viewpoints: [
                {
                    id: 'V1',
                    name: 'Entrance',
                    target: [10, 10],
                    bearing: 315,
                    tilt: 50,
                    distance: 25,
                    flight: 3,
                    pause: 2,
                },
            ],
        },
        {
            id: 'L2',
            name: 'First',
            names: {},
            group: 'Pavilion A',
            ordinal: 1,
            elevation: 4,
            height: 4,
            outline: { outer: square(0, 0, 20), holes: [] },
            wallNodes: [],
            walls: [],
            openings: [],
            zones: [],
            obstacles: [],
            underlays: [],
            viewpoints: [],
        },
    ],
    connections: [
        {
            id: 'C1',
            kind: 'escalator',
            name: 'Escalator',
            names: { pl: 'Schody ruchome' },
            stops: [
                { levelId: 'L1', shape: { outer: square(17, 1, 2), holes: [] }, entry: [18, 1] },
                { levelId: 'L2', shape: { outer: square(17, 1, 2), holes: [] }, entry: [18, 3] },
            ],
            bidirectional: false,
            accessible: false,
        },
    ],
    meta: { app: 'test' },
} satisfies EveryProperty<AreaformDocument>;

/** As a published plan.json would be: naming its schema, which readers ignore. */
const fullDocument = { $schema: schema.$id, ...withEveryProperty };

/** Both checks give the same verdict on `value`; returns that verdict. */
function expectAgreement(value: unknown, what: string): boolean {
    const accepted = validate(value);
    const checkerError = checkSchemaV1(value);
    const message = `${what}: JSON Schema ${accepted ? 'accepts' : 'rejects'} (${JSON.stringify(validate.errors?.[0] ?? null)}), schema.ts ${checkerError ? `rejects (${JSON.stringify(checkerError)})` : 'accepts'}`;
    expect(accepted, message).toBe(checkerError === null);
    return accepted;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A value of another type in place of `value`; a string becomes one no enum allows. */
function wrongValues(value: Json): Json[] {
    if (typeof value === 'string') return [42, 'not-a-known-value'];
    if (typeof value === 'number') return ['1'];
    if (typeof value === 'boolean') return ['true'];
    if (Array.isArray(value)) return [{}, [...value, ...value.slice(0, 1)]];
    if (value !== null) return [[], 'object'];
    return [];
}

interface Mutation {
    /** Where the change is, such as `levels[0].zones[0].label`. */
    path: string;
    /** The changed copy of the whole Document. */
    doc: Json;
    /** For the failure message, such as `without levels[0].zones[0].label`. */
    what: string;
}

/** Every copy of `doc` with one property removed or one value replaced. */
function* mutations(doc: Json): Generator<Mutation> {
    function* walk(
        node: Json,
        path: string,
        replace: (value: Json | undefined) => Json,
    ): Generator<Mutation> {
        for (const wrong of wrongValues(node)) {
            yield { path, doc: replace(wrong), what: `${path} = ${JSON.stringify(wrong)}` };
        }
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                yield* walk(node[i]!, `${path}[${i}]`, (value) =>
                    replace(node.map((item, j) => (j === i ? value! : item))),
                );
            }
        } else if (node !== null && typeof node === 'object') {
            for (const key of Object.keys(node)) {
                const child = (value: Json | undefined) => {
                    const copy = { ...node };
                    if (value === undefined) delete copy[key];
                    else copy[key] = value;
                    return replace(copy);
                };
                const at = path ? `${path}.${key}` : key;
                yield { path: at, doc: child(undefined), what: `without ${at}` };
                yield* walk(node[key]!, at, child);
            }
        }
    }
    yield* walk(doc, '', (value) => value!);
}

/** `doc` with the first Opening of the first Level changed by `change`. */
function withOpening(doc: typeof fullDocument, change: Record<string, unknown>): unknown {
    const [level, ...otherLevels] = doc.levels;
    const [opening, ...otherOpenings] = level!.openings;
    return {
        ...doc,
        levels: [
            { ...level, openings: [{ ...opening, ...change }, ...otherOpenings] },
            ...otherLevels,
        ],
    };
}

describe('the published JSON Schema', () => {
    it('is the version 1 schema at its permanent address', () => {
        expect(schema.$id).toBe('https://areaform.app/schema/v1/document.json');
        // The address every saved file names; a new schema version needs its own schema file.
        expect(DOCUMENT_SCHEMA_URL).toBe(schema.$id);
    });

    it('accepts a Document using every property, and the core loads it', () => {
        expect(expectAgreement(fullDocument, 'fullDocument')).toBe(true);
        const loaded = fromJSON(JSON.stringify(fullDocument));
        expect(loaded.ok ? [] : loaded.errors).toEqual([]);
    });

    it.each(['generic', ...Object.keys(defaultPresets)])('accepts a new %s Space', (kind) => {
        const doc = createSpace({ name: 'Space', kind, size: [30, 20], language: 'en' });
        expect(expectAgreement(JSON.parse(JSON.stringify(doc)), kind)).toBe(true);
    });

    it('accepts the stress Document', () => {
        const doc = stressSpace({ booths: 200, walls: 100 });
        expect(expectAgreement(JSON.parse(JSON.stringify(doc)), 'stress')).toBe(true);
    });

    it('agrees with the core on every property removed or given a wrong value', () => {
        let rejected = 0;
        let checked = 0;
        for (const { path, doc, what } of mutations(fullDocument as unknown as Json)) {
            // The core checks the version before the shape, when it migrates (ADR-0006).
            if (path === 'schemaVersion') continue;
            checked++;
            if (!expectAgreement(doc, what)) rejected++;
        }
        // Guards the walk itself: it must reach far and find plenty to reject.
        expect(checked).toBeGreaterThan(300);
        expect(rejected).toBeGreaterThan(150);
    });

    it.each([0, 2, '1'])('rejects schemaVersion %j, as the core does', (version) => {
        const value = { ...fullDocument, schemaVersion: version };
        expect(validate(value)).toBe(false);
        expect(fromJSON(JSON.stringify(value)).ok).toBe(false);
    });

    it.each([NaN, Infinity, -Infinity])(
        'rejects %d, which JSON cannot carry but parsed data can, as the core does',
        (bad) => {
            const value = { ...fullDocument, grid: { ...fullDocument.grid, step: bad } };
            expect(expectAgreement(value, String(bad))).toBe(false);
        },
    );

    it.each(['__proto__', 'hasOwnProperty', 'toString', 'constructor'])(
        'rejects an Opening hosted by %j, as the core does without throwing',
        (host) => {
            const value = withOpening(fullDocument, { host });
            expect(expectAgreement(value, host)).toBe(false);
            expect(fromJSON(value)).toMatchObject({
                ok: false,
                errors: [{ code: 'malformed', path: 'levels[0].openings[0].host' }],
            });
        },
    );

    it('keeps its address and unknown properties through a load and a save', () => {
        const value = {
            ...fullDocument,
            futureProperty: true,
            levels: fullDocument.levels.map((level) => ({ ...level, futureProperty: [1] })),
        };
        const loaded = fromJSON(JSON.stringify(value));
        if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
        const saved: unknown = JSON.parse(toJSON(loaded.doc));

        expect(saved).toEqual(value);
        expect(expectAgreement(saved, 'saved')).toBe(true);
    });
});
