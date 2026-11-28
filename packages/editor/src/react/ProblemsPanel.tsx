import {
    diagnose,
    type AreaformDocument,
    type Connection,
    type Level,
    type Preset,
} from '@areaform/core';
import type { UnreachableZone } from '@areaform/wayfinding';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    INNER_PLAN_SECONDS,
    innerSpaceProblems,
    type InnerSpaceSource,
} from '../document/innerSpaces.ts';
import {
    problemLevel,
    problemText,
    type InnerSpaceProblem,
    type Problem,
} from '../document/problems.ts';
import { useI18n } from './i18n.ts';

/** Wait after the last change before checking again, so typing or a drag is checked once. */
const DIAGNOSE_DELAY_MS = 300;
/** The route check builds a navmesh per changed Level, so it waits a little longer. */
const ROUTES_DELAY_MS = 800;
/** The most Problems listed; the rest are counted. */
const SHOWN = 100;

/**
 * The plan's Problems: `core`'s Diagnostics, the Zones visitors cannot reach (ADR-0017), and,
 * with the host's `innerSpaces`, units whose Inner Space is not published or no longer fits
 * (Inner Space, CONTEXT.md). The route check imports `@areaform/wayfinding` on first use and redoes only the
 * Levels that changed; each Inner Space's plan is asked for once.
 */
export function useProblems(
    doc: AreaformDocument,
    presets: Record<string, Preset> | undefined,
    enabled = true,
    innerSpaces?: InnerSpaceSource,
): Problem[] {
    const [diagnostics, setDiagnostics] = useState<Problem[]>([]);
    const [unreachable, setUnreachable] = useState<UnreachableZone[]>([]);
    const checked = useRef(
        new Map<string, { level: Level; connections: Connection[]; result: UnreachableZone[] }>(),
    );

    useEffect(() => {
        if (!enabled) return;
        const timer = setTimeout(
            () => setDiagnostics(diagnose(doc, presets ? { presets } : {})),
            DIAGNOSE_DELAY_MS,
        );
        return () => clearTimeout(timer);
    }, [doc, presets, enabled]);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            const wayfinding = await import('@areaform/wayfinding');
            const found: UnreachableZone[] = [];
            for (const level of doc.levels) {
                if (cancelled) return;
                const last = checked.current.get(level.id);
                if (last && last.level === level && last.connections === doc.connections) {
                    found.push(...last.result);
                    continue;
                }
                const result = wayfinding.unreachableZonesOn(doc, level);
                checked.current.set(level.id, { level, connections: doc.connections, result });
                found.push(...result);
                // Let the page breathe between Levels.
                await new Promise((resolve) => setTimeout(resolve));
            }
            if (!cancelled) setUnreachable(found);
        }, ROUTES_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [doc, enabled]);

    const [inner, setInner] = useState<InnerSpaceProblem[]>([]);
    // Asked again now and then, as the host's cached plans expire: a shop publishes, or changes
    // its plan, while the centre's Editor is open.
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!enabled || !innerSpaces) return;
        const timer = setInterval(() => setTick((n) => n + 1), INNER_PLAN_SECONDS * 1000);
        return () => clearInterval(timer);
    }, [enabled, innerSpaces]);
    useEffect(() => {
        if (!enabled || !innerSpaces) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            // Whether visitors get into each shop needs a navmesh: imported on first use, as above.
            const wayfinding = await import('@areaform/wayfinding');
            const found = await innerSpaceProblems(
                doc,
                (space) => innerSpaces.load(space),
                (merged, level) => wayfinding.unreachableZonesOn(merged, level),
            );
            if (!cancelled) setInner(found);
        }, DIAGNOSE_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [doc, enabled, innerSpaces, tick]);

    return useMemo(
        () => [...diagnostics, ...unreachable, ...(innerSpaces ? inner : [])],
        [diagnostics, unreachable, inner, innerSpaces],
    );
}

/** The Problems in the plan, each a button that shows its Element. */
export function ProblemsPanel({
    doc,
    problems,
    onShow,
}: {
    doc: AreaformDocument;
    problems: Problem[];
    onShow: (problem: Problem) => void;
}) {
    const i18n = useI18n();
    if (problems.length === 0) return <p className="af-muted">{i18n.t('problems.none')}</p>;
    const levels = doc.levels.length > 1;
    return (
        <>
            <ul className="af-problems">
                {problems.slice(0, SHOWN).map((problem, i) => {
                    const levelId = problemLevel(problem);
                    const level = levelId && doc.levels.find((l) => l.id === levelId);
                    return (
                        <li key={`${problem.code}:${problem.ref.id}:${i}`}>
                            <button type="button" onClick={() => onShow(problem)}>
                                {problemText(doc, problem, i18n)}
                                {levels && level && <span className="af-muted">{level.name}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {problems.length > SHOWN && (
                <p className="af-muted">
                    {i18n.t('problems.more', { count: problems.length - SHOWN })}
                </p>
            )}
        </>
    );
}
