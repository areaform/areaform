// Structural check of untrusted input against the schema-v1 Document shape. Invariants
// (references, geometry) are checked separately; this only guarantees the types are right.
// The published JSON Schema, ../schema/v1/document.json, must say the same: schemaJson.test.ts
// checks that the two agree.

export interface SchemaError {
    path: string;
    expected: string;
}

/** Returns the first mismatch, or null when the value fits. */
type Check = (value: unknown, path: string) => SchemaError | null;

const fail = (path: string, expected: string): SchemaError => ({ path, expected });

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON has no NaN or Infinity, so neither is a number here; they could only come from parsed data. */
const number: Check = (v, path) => (Number.isFinite(v) ? null : fail(path, 'number'));
const string: Check = (v, path) => (typeof v === 'string' ? null : fail(path, 'string'));
const boolean: Check = (v, path) => (typeof v === 'boolean' ? null : fail(path, 'boolean'));
const record: Check = (v, path) => (isRecord(v) ? null : fail(path, 'object'));

const oneOf =
    (...options: string[]): Check =>
    (v, path) =>
        typeof v === 'string' && options.includes(v)
            ? null
            : fail(path, options.map((o) => `'${o}'`).join(' | '));

const array =
    (item: Check): Check =>
    (v, path) => {
        if (!Array.isArray(v)) return fail(path, 'array');
        for (let i = 0; i < v.length; i++) {
            const error = item(v[i], `${path}[${i}]`);
            if (error) return error;
        }
        return null;
    };

const tuple =
    (...items: Check[]): Check =>
    (v, path) => {
        if (!Array.isArray(v) || v.length !== items.length) {
            return fail(path, `array of ${items.length}`);
        }
        for (let i = 0; i < items.length; i++) {
            const error = items[i]!(v[i], `${path}[${i}]`);
            if (error) return error;
        }
        return null;
    };

const recordOf =
    (value: Check): Check =>
    (v, path) => {
        if (!isRecord(v)) return fail(path, 'object');
        for (const [key, item] of Object.entries(v)) {
            const error = value(item, `${path}.${key}`);
            if (error) return error;
        }
        return null;
    };

/** Properties ending in `?` are optional. Unknown extra properties are allowed. */
const object =
    (shape: Record<string, Check>): Check =>
    (v, path) => {
        if (!isRecord(v)) return fail(path, 'object');
        for (const [rawKey, check] of Object.entries(shape)) {
            const optional = rawKey.endsWith('?');
            const key = optional ? rawKey.slice(0, -1) : rawKey;
            const at = path ? `${path}.${key}` : key;
            if (!(key in v) || v[key] === undefined) {
                if (optional) continue;
                return fail(at, describe(check));
            }
            const error = check(v[key], at);
            if (error) return error;
        }
        return null;
    };

/** Picks the object shape by the value of a discriminating property. */
const tagged =
    (tag: string, variants: Record<string, Check>): Check =>
    (v, path) => {
        if (!isRecord(v)) return fail(path, 'object');
        // Own properties only: a tag such as `__proto__` or `toString` must not find the prototype's.
        const key = String(v[tag]);
        const variant = Object.hasOwn(variants, key) ? variants[key] : undefined;
        if (!variant) return oneOf(...Object.keys(variants))(v[tag], `${path}.${tag}`);
        return variant(v, path);
    };

/** What a missing property should have been, for the error message. */
function describe(check: Check): string {
    return check(Symbol('missing'), '')?.expected ?? 'value';
}

const vec2 = tuple(number, number);
const ring = array(vec2);
const shape = object({ outer: ring, 'holes?': array(ring) });

const wallNode = object({ id: string, position: vec2 });
const wall = object({ id: string, a: string, b: string, thickness: number, 'height?': number });

const openingBase = {
    id: string,
    kind: oneOf('door', 'entrance', 'passage', 'emergency-exit'),
    width: number,
    'hinge?': oneOf('start', 'end'),
    'swing?': oneOf('left', 'right'),
};
const translations = recordOf(string);

const opening = tagged('host', {
    wall: object({ ...openingBase, host: string, wallId: string, offset: number }),
    free: object({ ...openingBase, host: string, position: vec2, angle: number }),
});

const zone = object({
    id: string,
    shape,
    'label?': string,
    'labels?': translations,
    'labelAnchor?': vec2,
    'labelSize?': number,
    'labelColor?': string,
    'category?': string,
    'restricted?': boolean,
    'walkAround?': boolean,
    'innerSpace?': object({
        space: string,
        'fit?': object({ x: number, y: number, rotation: number }),
    }),
    'style?': object({ 'fill?': string, 'stroke?': string, 'opacity?': number }),
    'data?': record,
});

const obstacle = object({ id: string, shape, kind: oneOf('column', 'shaft', 'void', 'other') });

const underlay = object({
    id: string,
    src: string,
    position: vec2,
    scale: number,
    rotation: number,
    opacity: number,
    locked: boolean,
    'size?': vec2,
});

const viewpoint = object({
    id: string,
    'name?': string,
    target: vec2,
    bearing: number,
    tilt: number,
    distance: number,
    'flight?': number,
    'pause?': number,
});

const level = object({
    id: string,
    name: string,
    'names?': translations,
    'group?': string,
    ordinal: number,
    elevation: number,
    height: number,
    outline: shape,
    wallNodes: array(wallNode),
    walls: array(wall),
    openings: array(opening),
    zones: array(zone),
    obstacles: array(obstacle),
    underlays: array(underlay),
    'viewpoints?': array(viewpoint),
});

const connection = object({
    id: string,
    kind: oneOf('stairs', 'elevator', 'escalator', 'ramp'),
    'name?': string,
    'names?': translations,
    stops: array(object({ levelId: string, shape, 'entry?': vec2 })),
    bidirectional: boolean,
    'accessible?': boolean,
});

const documentV1 = object({
    id: string,
    name: string,
    'names?': translations,
    'languages?': object({ default: string, 'others?': array(string) }),
    kind: string,
    units: oneOf('m'),
    grid: object({ step: number, snap: boolean }),
    'geo?': object({ origin: object({ lat: number, lng: number }), bearing: number }),
    levels: array(level),
    connections: array(connection),
    'meta?': record,
});

export function checkSchemaV1(value: unknown): SchemaError | null {
    return documentV1(value, '');
}
