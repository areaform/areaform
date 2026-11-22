import { describe, expect, it } from 'vitest';
import {
    CURRENT_SCHEMA_VERSION,
    createSpace,
    fromJSON,
    migrate,
    toJSON,
    type Migrations,
} from './index.ts';

/** Stand-ins for a future history: v1 named it `title`, v2 `name`, v3 added `tags`. */
const history: Migrations = {
    1: (data) => {
        const { title, ...rest } = data;
        return { ...rest, name: title };
    },
    2: (data) => ({ ...data, tags: [] }),
};

describe('migrate', () => {
    it('upgrades step by step to the target version, stamping each new version', () => {
        const result = migrate(
            { schemaVersion: 1, title: 'Hall A' },
            { migrations: history, target: 3 },
        );

        expect(result).toEqual({
            ok: true,
            data: { schemaVersion: 3, name: 'Hall A', tags: [] },
            from: 1,
        });
    });

    it('starts from whatever version the data has', () => {
        const result = migrate(
            { schemaVersion: 2, name: 'Hall A' },
            { migrations: history, target: 3 },
        );

        expect(result).toMatchObject({ ok: true, data: { schemaVersion: 3, tags: [] }, from: 2 });
    });

    it('leaves the input untouched', () => {
        const input = { schemaVersion: 1, title: 'Hall A', meta: { a: 1 } };
        const copy = JSON.parse(JSON.stringify(input)) as typeof input;

        migrate(input, {
            migrations: {
                1: (data) => {
                    (data.meta as { a: number }).a = 2;
                    return data;
                },
            },
            target: 2,
        });

        expect(input).toEqual(copy);
    });

    it('returns current data as it is', () => {
        const input = { schemaVersion: 3, name: 'Hall A' };

        const result = migrate(input, { migrations: history, target: 3 });

        expect(result).toEqual({ ok: true, data: input, from: 3 });
        expect(result.ok && result.data).toBe(input);
    });

    it('refuses data from a newer version, which cannot be downgraded', () => {
        expect(migrate({ schemaVersion: 4 }, { migrations: history, target: 3 })).toEqual({
            ok: false,
            error: { code: 'newer-version', version: 4 },
        });
    });

    it('refuses versions it has no way up from', () => {
        for (const schemaVersion of [0, 1.5, '1', null]) {
            expect(migrate({ schemaVersion }, { migrations: history, target: 3 })).toEqual({
                ok: false,
                error: { code: 'unsupported-version', version: schemaVersion },
            });
        }
        // A gap in the history: nothing upgrades v2.
        expect(
            migrate({ schemaVersion: 2 }, { migrations: { 1: history[1]! }, target: 3 }),
        ).toEqual({ ok: false, error: { code: 'unsupported-version', version: 2 } });
    });
});

describe('fromJSON and schema versions', () => {
    it('loads a current Document without reporting a migration', () => {
        const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [10, 10] });

        const loaded = fromJSON(toJSON(doc));

        expect(loaded.ok).toBe(true);
        expect(loaded).not.toHaveProperty('migratedFrom');
    });

    it('tells a Document from a newer library apart from a broken one', () => {
        const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [10, 10] });
        const future = { ...JSON.parse(toJSON(doc)), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };

        expect(fromJSON(future)).toEqual({
            ok: false,
            errors: [{ code: 'newer-version', version: CURRENT_SCHEMA_VERSION + 1 }],
        });
    });
});
