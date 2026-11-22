// Schema migrations (ADR-0006): stored Documents are upgraded one version at a time, as raw JSON
// data, before the schema check. Only breaking changes bump the version; optional additions do not.

/** The schema version this library reads and writes. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Raw Document data as parsed from JSON, before it is checked against the schema. */
export type DocumentData = Record<string, unknown>;

/** Upgrades data of one version to the next; it need not set `schemaVersion` itself. */
export type Migration = (data: DocumentData) => DocumentData;

/** `migrations[n]` upgrades version n to n + 1. */
export type Migrations = Readonly<Record<number, Migration>>;

/** Every migration this library knows; empty until a schema v2 exists. */
export const MIGRATIONS: Migrations = {};

export type MigrationError =
    /** A Document written by a newer library: update the library to open it. */
    | { code: 'newer-version'; version: number }
    /** No known way to upgrade this version (not a positive whole number, or a missing step). */
    | { code: 'unsupported-version'; version: unknown };

export type MigrationResult =
    { ok: true; data: DocumentData; from: number } | { ok: false; error: MigrationError };

export interface MigrateOptions {
    migrations?: Migrations;
    target?: number;
}

/**
 * Upgrades Document data to the current schema version (or `target`). Current data comes back
 * as it is; older data is copied first, so the input is never changed.
 */
export function migrate(data: DocumentData, options: MigrateOptions = {}): MigrationResult {
    const { migrations = MIGRATIONS, target = CURRENT_SCHEMA_VERSION } = options;
    const version = data.schemaVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return { ok: false, error: { code: 'unsupported-version', version } };
    }
    if (version > target) return { ok: false, error: { code: 'newer-version', version } };
    if (version === target) return { ok: true, data, from: version };

    // The data came from JSON, so a JSON round trip copies it exactly.
    let current = JSON.parse(JSON.stringify(data)) as DocumentData;
    for (let step = version; step < target; step++) {
        const upgrade = migrations[step];
        if (!upgrade) return { ok: false, error: { code: 'unsupported-version', version: step } };
        current = { ...upgrade(current), schemaVersion: step + 1 };
    }
    return { ok: true, data: current, from: version };
}
