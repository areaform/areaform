// What the Editor knows of Inner Spaces (Inner Space, CONTEXT.md): where their plans come from,
// which the host says, and the Problems they make, a unit's plan that visitors cannot see or that
// no longer fits the unit. Plain functions, so the Problems are tested without a browser.
import {
    fitsUnit,
    placeDocument,
    withInnerSpace,
    type AreaformDocument,
    type InnerSpaceRef,
    type Level,
    type Zone,
} from '@areaform/core';
import type { InnerSpaceProblem } from './problems.ts';

/** What the host tells the Editor about Inner Spaces; without it, a Space's id is typed in. */
export interface InnerSpaceSource {
    /** The Space's plan as visitors see it, or null when it is not published or not there. */
    load(space: string): Promise<AreaformDocument | null>;
    /** Reads a pasted link or id as a Space's id; null when it names none. As typed, without it. */
    parse?(text: string): string | null;
    /** The Spaces to choose from, such as the Organisation's own. */
    choices?(): Promise<{ space: string; name: string }[]>;
    /** Makes a new Space for the unit, its Outline the unit's shape, and says how it fits. */
    makeForUnit?(unit: { zone: Zone; levelId: string }): Promise<InnerSpaceRef>;
    /**
     * Visitors who went into each unit's Inner Space in the last `days`, by the unit's Zone id,
     * for the owner to show a tenant what being there brings.
     */
    opens?(): Promise<{ days: number; counts: Record<string, number> }>;
}

/** How long a plan once loaded is taken as it is: a shop may publish, or change it, meanwhile. */
export const INNER_PLAN_SECONDS = 30;

/**
 * The host's source with each plan loaded once for a while, shared by **Inside** and the
 * Problems, then asked for again.
 */
export function cachedInnerSpaces(
    source: InnerSpaceSource,
    now: () => number = Date.now,
): InnerSpaceSource {
    const plans = new Map<string, { at: number; plan: Promise<AreaformDocument | null> }>();
    return {
        ...source,
        load(space) {
            const kept = plans.get(space);
            if (kept && now() - kept.at < INNER_PLAN_SECONDS * 1000) return kept.plan;
            const plan = source.load(space).catch(() => null);
            plans.set(space, { at: now(), plan });
            return plan;
        },
    };
}

/** The Zones no route reaches on a Level, by id, as `@areaform/wayfinding` finds them. */
export type Unreached = (doc: AreaformDocument, level: Level) => { ref: { id: string } }[];

/**
 * Whether no visitor can get into the shop laid into its unit: none of its Zones is reached once
 * its ground floor is merged into the unit's Level, so its entrance meets no way in from the centre.
 */
export function shopClosed(
    doc: AreaformDocument,
    unit: { levelId: string; zoneId: string },
    placed: AreaformDocument,
    unreached: Unreached,
): boolean {
    const prefix = `${unit.zoneId}/`;
    const joined = withInnerSpace(doc, unit, placed);
    // Visitors arrive by the centre's own ways in: the shop's Openings still let them through,
    // but are not where they come from, as emergency exits are not.
    const merged = {
        ...joined,
        levels: joined.levels.map((l) => ({
            ...l,
            openings: l.openings.map((o) =>
                o.id.startsWith(prefix) ? { ...o, kind: 'emergency-exit' as const } : o,
            ),
        })),
    };
    const level = merged.levels.find((l) => l.id === unit.levelId);
    const shopZones = level?.zones.filter((z) => z.id.startsWith(prefix)) ?? [];
    if (!level || shopZones.length === 0) return false;
    const missed = new Set(unreached(merged, level).map((z) => z.ref.id));
    return shopZones.every((z) => missed.has(z.id));
}

/**
 * Units whose Inner Space is not published (or gone), whose plan no longer fits them, or, given
 * `unreached`, whose shop visitors cannot get into from the centre.
 */
export async function innerSpaceProblems(
    doc: AreaformDocument,
    load: (space: string) => Promise<AreaformDocument | null>,
    unreached?: Unreached,
): Promise<InnerSpaceProblem[]> {
    const found: InnerSpaceProblem[] = [];
    for (const level of doc.levels)
        for (const zone of level.zones) {
            const ref = zone.innerSpace;
            if (!ref) continue;
            const plan = await load(ref.space);
            const at = { kind: 'zone' as const, id: zone.id, levelId: level.id };
            if (!plan) found.push({ code: 'inner-space-unpublished', ref: at });
            else if (ref.fit && !fitsUnit(zone.shape, plan, ref.fit))
                found.push({ code: 'inner-space-misfit', ref: at });
            else if (
                ref.fit &&
                unreached &&
                shopClosed(
                    doc,
                    { levelId: level.id, zoneId: zone.id },
                    placeDocument(plan, ref.fit),
                    unreached,
                )
            )
                found.push({ code: 'inner-space-closed', ref: at });
        }
    return found;
}
