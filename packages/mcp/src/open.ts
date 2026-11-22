import { fromJSON, type Repair } from '@areaform/core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readImportMeta } from './importMeta.ts';
import { PLAN_FILE } from './save.ts';
import { DraftError, type DraftSession } from './session.ts';

export interface OpenedDraft {
    plan: string;
    /** The Source image next to the plan, when its Underlay names one that is there. */
    source?: string;
    /** Elements dropped on load because they broke an Invariant. */
    repairs: Repair[];
    /** The schema version the plan was upgraded from, when it was older. */
    migratedFrom?: number;
}

/**
 * Reads a plan saved earlier, a Draft folder or its `plan.json`, into the session, so the agent
 * can change it through Commands and save it back. The plan is checked as on any load.
 */
export function openDraft(session: DraftSession, path: string): OpenedDraft {
    const target = resolve(path);
    if (!existsSync(target)) throw new DraftError(`${target} does not exist`);
    const plan = statSync(target).isDirectory() ? join(target, PLAN_FILE) : target;
    if (!existsSync(plan)) throw new DraftError(`${plan} does not exist`);

    const loaded = fromJSON(readFileSync(plan, 'utf8'));
    if (!loaded.ok) {
        throw new DraftError(
            `${plan} is not an Areaform Document: ${JSON.stringify(loaded.errors)}`,
        );
    }
    const { doc, repairs, migratedFrom } = loaded;

    // Only a relative `src` can name a file in the folder; a data URL or a link stays as it is.
    const underlayId = readImportMeta(doc)?.underlayId;
    const underlay = doc.levels[0]?.underlays.find((u) => u.id === underlayId);
    const file =
        underlay && !/^[a-z]+:/i.test(underlay.src) ? join(dirname(plan), underlay.src) : undefined;
    const source = file && existsSync(file) ? file : undefined;

    session.open(doc, source);
    return {
        plan,
        ...(source && { source }),
        repairs,
        ...(migratedFrom !== undefined && { migratedFrom }),
    };
}
