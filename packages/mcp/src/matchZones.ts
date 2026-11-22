import type { AreaformDocument, Id, Zone, ZoneUpdate } from '@areaform/core';
import { DraftError } from './session.ts';

/** A field of a Zone that rows can be matched on: its id, its label, or a key of its `data`. */
export type MatchField = 'id' | 'label' | `data.${string}`;

/** A field of a Zone that rows can set: its label, its category, or a key of its `data`. */
export type SetField = 'label' | 'category' | `data.${string}`;

/** One record from the person's own data, such as a row of an exhibitor list. */
export type Row = Record<string, unknown>;

export interface MatchOptions {
    /** The row field that names the Zone, such as `booth` or `id`. */
    key: string;
    /** The Zone field the key is compared with. */
    by: MatchField;
    /** Only Zones of this Zone Category, such as `booth`. */
    category?: string;
    /** Only Zones on this Level. */
    levelId?: Id;
    /**
     * Compare exactly, but for surrounding spaces. Otherwise case, spaces and the separators
     * `-`, `_`, `.` and `/` are ignored, so "A-12", "a 12" and "A12" are the same booth.
     */
    exact?: boolean;
    /** Zone field → the row field to set it from, for the proposed Commands. */
    set?: Partial<Record<SetField, string>>;
}

/** A Zone, by id and Level, with its label when it has one. */
export interface ZoneRef {
    zoneId: Id;
    levelId: Id;
    label?: string;
}

export interface ZoneMatch {
    counts: {
        rows: number;
        zones: number;
        matched: number;
        /** Matched Zones the rows would change, one Command each. */
        updates: number;
    };
    /** Rows that name exactly one Zone, which no other row names. */
    matched: (ZoneRef & { row: number; key: string })[];
    /** `zone.update` Commands setting the `set` fields of each matched Zone that differ. */
    commands: ZoneUpdate[];
    /** Rows whose key names no Zone. */
    unmatchedRows: { row: number; key: string }[];
    /** Rows with no usable key (missing, empty, or not a string or number). */
    rowsWithoutKey: number[];
    /** Rows whose key names several Zones. */
    ambiguous: { row: number; key: string; zones: ZoneRef[] }[];
    /** Zones that several rows name; none of those rows is matched. */
    duplicateRows: (ZoneRef & { rows: number[]; key: string })[];
    /** Zones in scope that no row names. */
    unmatchedZones: ZoneRef[];
}

const SEPARATORS = /[\s\-_./]+/g;

function keyOf(value: unknown, exact: boolean): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = exact ? String(value).trim() : String(value).replace(SEPARATORS, '').toLowerCase();
    return text === '' ? undefined : text;
}

function fieldOf(zone: Zone, field: MatchField): unknown {
    if (field === 'id') return zone.id;
    if (field === 'label') return zone.label;
    return zone.data?.[field.slice('data.'.length)];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The changes `row` makes to `zone` through `set`; fields the row lacks are left alone. */
function changesFor(zone: Zone, row: Row, set: MatchOptions['set'] = {}): ZoneUpdate['changes'] {
    const changes: ZoneUpdate['changes'] = {};
    let data = zone.data;
    for (const [field, rowField] of Object.entries(set) as [SetField, string][]) {
        const value = row[rowField];
        if (value === undefined || value === null) continue;
        if (field === 'label' || field === 'category') {
            if (zone[field] !== String(value)) changes[field] = String(value);
            continue;
        }
        const name = field.slice('data.'.length);
        // `zone.update` replaces `data` whole, so the other keys are carried over.
        if (!same(data?.[name], value)) data = { ...data, [name]: value };
    }
    if (data !== zone.data) changes.data = data;
    return changes;
}

/**
 * Matches the person's records to Zones of the plan by a key, and proposes the `zone.update`
 * Commands that copy fields of each record onto its Zone. Nothing is applied; whatever doesn't
 * match one to one is reported for the agent to resolve with the person.
 */
export function matchZones(doc: AreaformDocument, rows: Row[], options: MatchOptions): ZoneMatch {
    const { key, by, category, levelId, exact = false, set } = options;
    if (levelId !== undefined && !doc.levels.some((l) => l.id === levelId)) {
        throw new DraftError(`No Level has the id ${levelId}`);
    }

    const zones = doc.levels
        .filter((level) => levelId === undefined || level.id === levelId)
        .flatMap((level) =>
            level.zones
                .filter((zone) => category === undefined || zone.category === category)
                .map((zone) => ({ zone, levelId: level.id })),
        );
    const ref = ({ zone, levelId }: (typeof zones)[number]): ZoneRef => ({
        zoneId: zone.id,
        levelId,
        ...(zone.label !== undefined && { label: zone.label }),
    });

    const byKey = new Map<string, typeof zones>();
    for (const entry of zones) {
        const k = keyOf(fieldOf(entry.zone, by), exact);
        if (k !== undefined) byKey.set(k, [...(byKey.get(k) ?? []), entry]);
    }

    const result: ZoneMatch = {
        counts: { rows: rows.length, zones: zones.length, matched: 0, updates: 0 },
        matched: [],
        commands: [],
        unmatchedRows: [],
        rowsWithoutKey: [],
        ambiguous: [],
        duplicateRows: [],
        unmatchedZones: [],
    };

    // Rows naming exactly one Zone, grouped by that Zone, to find Zones named twice.
    const claims = new Map<Id, { entry: (typeof zones)[number]; rows: number[]; key: string }>();
    const named = new Set<Id>();
    rows.forEach((row, index) => {
        const raw = row[key];
        const k = keyOf(raw, exact);
        if (k === undefined) {
            result.rowsWithoutKey.push(index);
            return;
        }
        const shown = String(raw).trim();
        const found = byKey.get(k) ?? [];
        for (const entry of found) named.add(entry.zone.id);
        if (found.length === 0) result.unmatchedRows.push({ row: index, key: shown });
        else if (found.length > 1) {
            result.ambiguous.push({ row: index, key: shown, zones: found.map(ref) });
        } else {
            const entry = found[0]!;
            const claim = claims.get(entry.zone.id);
            if (claim) claim.rows.push(index);
            else claims.set(entry.zone.id, { entry, rows: [index], key: shown });
        }
    });

    for (const { entry, rows: claimed, key: shown } of claims.values()) {
        if (claimed.length > 1) {
            result.duplicateRows.push({ ...ref(entry), rows: claimed, key: shown });
            continue;
        }
        const row = claimed[0]!;
        result.matched.push({ ...ref(entry), row, key: shown });
        const changes = changesFor(entry.zone, rows[row]!, set);
        if (Object.keys(changes).length > 0) {
            result.commands.push({
                type: 'zone.update',
                levelId: entry.levelId,
                zoneId: entry.zone.id,
                changes,
            });
        }
    }

    result.unmatchedZones = zones.filter((entry) => !named.has(entry.zone.id)).map(ref);
    result.matched.sort((a, b) => a.row - b.row);
    result.counts.matched = result.matched.length;
    result.counts.updates = result.commands.length;
    return result;
}
