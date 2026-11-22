import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toGeoJSON, toJSON } from '@areaform/core';
import { readImportMeta } from './importMeta.ts';
import { DraftError, type DraftSession } from './session.ts';

export const PLAN_FILE = 'plan.json';
export const GEOJSON_FILE = 'plan.geojson';

export interface SavedDraft {
    plan: string;
    /** The copied Source image, when one is attached. */
    source?: string;
}

/**
 * Writes the Draft folder: `plan.json`, and the Source image under the relative name its
 * Underlay's `src` gives, so the folder can be moved and opened as a whole.
 */
export function saveDraft(
    session: DraftSession,
    dir: string,
    { overwrite = false }: { overwrite?: boolean } = {},
): SavedDraft {
    const doc = session.document();
    const folder = resolve(dir);
    const plan = join(folder, PLAN_FILE);
    if (existsSync(plan) && !overwrite) {
        throw new DraftError(`${plan} already exists; pass overwrite to replace it`);
    }

    const underlayId = readImportMeta(doc)?.underlayId;
    const underlay = doc.levels[0]!.underlays.find((u) => u.id === underlayId);
    const sourceFile = session.sourceFile();
    if (underlay && sourceFile && !existsSync(sourceFile)) {
        throw new DraftError(`The Source image ${sourceFile} is gone; attach it again`);
    }

    mkdirSync(folder, { recursive: true });
    writeFileSync(plan, `${toJSON(doc, { indent: 2 })}\n`);
    if (!underlay || !sourceFile) return { plan };
    const source = join(folder, underlay.src);
    if (resolve(sourceFile) !== source) copyFileSync(sourceFile, source);
    return { plan, source };
}

/**
 * Writes `plan.geojson` into the folder, for map and GIS tools: longitude and latitude when the
 * Draft has a georeference (`geo`), metres on the plan's own plane otherwise.
 */
export function saveGeoJSON(
    session: DraftSession,
    dir: string,
    { overwrite = false }: { overwrite?: boolean } = {},
): { geojson: string; coordinateSystem: 'wgs84' | 'local' } {
    const collection = toGeoJSON(session.document());
    const folder = resolve(dir);
    const geojson = join(folder, GEOJSON_FILE);
    if (existsSync(geojson) && !overwrite) {
        throw new DraftError(`${geojson} already exists; pass overwrite to replace it`);
    }
    mkdirSync(folder, { recursive: true });
    writeFileSync(geojson, `${JSON.stringify(collection, null, 2)}\n`);
    return { geojson, coordinateSystem: collection.coordinateSystem };
}
