// The Problems list: Diagnostics from `core`, Zones visitors cannot reach (ADR-0017) and units
// whose Inner Space cannot be shown or no longer fits (Inner Space, CONTEXT.md), each as a sentence about the
// Element it concerns.
import {
    textIn,
    type AreaformDocument,
    type Diagnostic,
    type ElementRef,
    type Id,
} from '@areaform/core';
import type { UnreachableZone } from '@areaform/wayfinding';
import { categoryLabel, type Translator } from '../i18n/index.ts';

/**
 * A unit whose Inner Space visitors cannot see, as it is not published (or gone), or whose plan
 * changed and no longer fits the unit (Inner Space, CONTEXT.md).
 */
export interface InnerSpaceProblem {
    code: 'inner-space-unpublished' | 'inner-space-misfit' | 'inner-space-closed';
    ref: { kind: 'zone'; id: Id; levelId: Id };
}

/** Something in the plan to look at: a Diagnostic, a Zone no route reaches, or a unit's Inner Space. */
export type Problem = Diagnostic | UnreachableZone | InnerSpaceProblem;

const capitalised = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** What to call an Element in a Problem: a Zone by its name, other Elements by their kind. */
export function elementName(doc: AreaformDocument, ref: ElementRef, i18n: Translator): string {
    if (ref.kind === 'level') {
        const level = doc.levels.find((l) => l.id === ref.id);
        return i18n.t('problem.outline', { level: level?.name ?? ref.id });
    }
    if (ref.kind === 'connection' || ref.kind === 'stop') {
        const connection = doc.connections.find((c) => c.id === ref.id);
        if (!connection) return i18n.t('problem.element');
        return (
            textIn(connection.name, connection.names, doc.languages, undefined) ??
            capitalised(i18n.t(`connectionKind.${connection.kind}`))
        );
    }
    const level = doc.levels.find((l) => l.id === ref.levelId);
    switch (ref.kind) {
        case 'zone': {
            const zone = level?.zones.find((z) => z.id === ref.id);
            const name = zone && textIn(zone.label, zone.labels, doc.languages, undefined);
            if (name) return name;
            if (zone?.category !== undefined)
                return capitalised(categoryLabel(i18n, zone.category, zone.category));
            return i18n.t('problem.zone');
        }
        case 'opening': {
            const opening = level?.openings.find((o) => o.id === ref.id);
            return opening
                ? capitalised(i18n.t(`openingKind.${opening.kind}`))
                : i18n.t('problem.element');
        }
        case 'obstacle': {
            const obstacle = level?.obstacles.find((o) => o.id === ref.id);
            return obstacle
                ? capitalised(i18n.t(`obstacleKind.${obstacle.kind}`))
                : i18n.t('problem.element');
        }
        case 'wall':
            return i18n.t('problem.wall');
        case 'wallNode':
            return i18n.t('problem.wallNode');
        case 'underlay':
            return i18n.t('problem.underlay');
    }
}

/** A Problem as a sentence, e.g. "Visitors can't reach Hall B: no door or passage leads to it". */
export function problemText(doc: AreaformDocument, problem: Problem, i18n: Translator): string {
    const name = elementName(doc, problem.ref, i18n);
    const other = 'other' in problem ? elementName(doc, problem.other, i18n) : '';
    switch (problem.code) {
        case 'outside-outline':
            return i18n.t('problem.outsideOutline', { name });
        case 'opening-off-wall':
            return i18n.t('problem.openingOffWall', { name });
        case 'zones-overlap':
            return i18n.t('problem.zonesOverlap', { name, other });
        case 'walls-overlap':
            return i18n.t('problem.wallsOverlap');
        case 'hole-outside-outer':
            return i18n.t('problem.holeOutsideOuter', { name });
        case 'holes-overlap':
            return i18n.t('problem.holesOverlap', { name });
        case 'stop-misaligned':
            return i18n.t('problem.stopMisaligned', { name });
        case 'zone-unreachable':
            return i18n.t('problem.zoneUnreachable', { name });
        case 'inner-space-unpublished':
            return i18n.t('problem.innerSpaceUnpublished', { name });
        case 'inner-space-misfit':
            return i18n.t('problem.innerSpaceMisfit', { name });
        case 'inner-space-closed':
            return i18n.t('problem.innerSpaceClosed', { name });
    }
}

/** The Level a Problem is on, if any: where to go to see it. */
export function problemLevel(problem: Problem): string | undefined {
    const ref = problem.ref;
    if (ref.kind === 'level') return ref.id;
    return 'levelId' in ref ? ref.levelId : undefined;
}
