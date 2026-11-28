// A unit Zone's **Inside** (Inner Space, CONTEXT.md): another Space shown inside it, such as a shop's own plan in a
// shopping centre's unit. The owner pastes its link, chooses one of their own Spaces, or makes one
// for the unit, then fits it into the unit: **Fit to the unit** turns and centres it, and the
// numbers correct it. Which Spaces there are, and their plans, are the host's to say.
import {
    fitToUnit,
    type AreaformDocument,
    type Editor,
    type InnerSpaceFit,
    type InnerSpaceRef,
    type Zone,
} from '@areaform/core';
import { useEffect, useState } from 'react';
import type { InnerSpaceSource } from '../document/innerSpaces.ts';
import { CommitInput } from './CommitInput.tsx';
import { useI18n } from './i18n.ts';
import { LengthInput } from './LengthInput.tsx';

/** The Inner Space's plan as last loaded: undefined while loading, null when it cannot be shown. */
export function useInnerPlan(source: InnerSpaceSource | undefined, space: string | undefined) {
    const [plan, setPlan] = useState<{ space: string; doc: AreaformDocument | null } | null>(null);
    useEffect(() => {
        if (!source || !space) return;
        let current = true;
        source.load(space).then(
            (doc) => current && setPlan({ space, doc }),
            () => current && setPlan({ space, doc: null }),
        );
        return () => {
            current = false;
        };
    }, [source, space]);
    return plan && plan.space === space ? plan.doc : undefined;
}

const DEGREES = 180 / Math.PI;

export function InsidePanel({
    editor,
    levelId,
    zone,
    source,
}: {
    editor: Editor;
    levelId: string;
    zone: Zone;
    source: InnerSpaceSource | undefined;
}) {
    const i18n = useI18n();
    const inner = zone.innerSpace;
    const plan = useInnerPlan(source, inner?.space);
    const [opened, setOpened] = useState<{ count: number; days: number } | null>(null);
    useEffect(() => {
        if (!inner || !source?.opens) return;
        let current = true;
        void source.opens().then(
            ({ days, counts }) => current && setOpened({ count: counts[zone.id] ?? 0, days }),
            () => current && setOpened(null),
        );
        return () => {
            current = false;
        };
    }, [inner, source, zone.id]);
    const [choices, setChoices] = useState<{ space: string; name: string }[]>([]);
    const [making, setMaking] = useState(false);
    /** Why **Make a plan for this unit** made none: the host's sentence, e.g. a plan's limit. */
    const [refused, setRefused] = useState<string | null>(null);
    useEffect(() => {
        if (inner || !source?.choices) return;
        let current = true;
        void source.choices().then((list) => current && setChoices(list));
        return () => {
            current = false;
        };
    }, [inner, source]);

    const set = (innerSpace: InnerSpaceRef | undefined) =>
        editor.exec({ type: 'zone.update', levelId, zoneId: zone.id, changes: { innerSpace } });
    /** Names a Space, fitted into the unit at once when its plan can be read. */
    const choose = async (space: string) => {
        set({ space });
        const doc = await source?.load(space).catch(() => null);
        if (doc) set({ space, fit: fitToUnit(zone.shape, doc) });
    };
    const setFit = (fit: Partial<InnerSpaceFit>) =>
        inner?.fit && set({ ...inner, fit: { ...inner.fit, ...fit } });

    if (!inner)
        return (
            <>
                <dt title={i18n.t('inside.hint')}>{i18n.t('inside.title')}</dt>
                <dd className="af-inside">
                    <CommitInput
                        value=""
                        placeholder={i18n.t('inside.paste')}
                        aria-label={i18n.t('inside.paste')}
                        onCommit={(text) => {
                            const space = source?.parse ? source.parse(text) : text.trim() || null;
                            if (space) void choose(space);
                        }}
                    />
                    {choices.length > 0 && (
                        <select
                            aria-label={i18n.t('inside.choose')}
                            value=""
                            onChange={(e) => e.target.value && void choose(e.target.value)}
                        >
                            <option value="">{i18n.t('inside.choose')}</option>
                            {choices.map((c) => (
                                <option key={c.space} value={c.space}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {source?.makeForUnit && (
                        <button
                            type="button"
                            className="af-button"
                            disabled={making}
                            onClick={() => {
                                setMaking(true);
                                setRefused(null);
                                source.makeForUnit!({ zone, levelId })
                                    .then(set)
                                    .catch((error: unknown) =>
                                        setRefused(
                                            error instanceof Error && error.message
                                                ? error.message
                                                : i18n.t('inside.makeFailed'),
                                        ),
                                    )
                                    .finally(() => setMaking(false));
                            }}
                        >
                            {i18n.t(making ? 'inside.making' : 'inside.make')}
                        </button>
                    )}
                    {refused && (
                        <span className="af-muted" role="alert">
                            {refused}
                        </span>
                    )}
                </dd>
            </>
        );

    return (
        <>
            <dt title={i18n.t('inside.hint')}>{i18n.t('inside.title')}</dt>
            <dd className="af-inside">
                <span>{plan?.name ?? inner.space}</span>
                {plan === null && source && (
                    <span className="af-muted">{i18n.t('inside.unpublished')}</span>
                )}
                {opened && <span className="af-muted">{i18n.t('inside.opened', opened)}</span>}
                <button
                    type="button"
                    className="af-button"
                    disabled={!plan}
                    onClick={() => plan && set({ ...inner, fit: fitToUnit(zone.shape, plan) })}
                >
                    {i18n.t('inside.fit')}
                </button>
                {inner.fit && (
                    <button
                        type="button"
                        className="af-button"
                        onClick={() => set({ space: inner.space })}
                    >
                        {i18n.t('inside.onItsOwn')}
                    </button>
                )}
                <button type="button" className="af-button" onClick={() => set(undefined)}>
                    {i18n.t('inside.remove')}
                </button>
            </dd>
            {inner.fit && (
                <>
                    <dt>{i18n.t('inside.x')}</dt>
                    <dd>
                        <LengthInput
                            metres={inner.fit.x}
                            label={i18n.t('inside.x')}
                            allowZeroOrLess
                            onCommit={(x) => setFit({ x })}
                        />
                    </dd>
                    <dt>{i18n.t('inside.y')}</dt>
                    <dd>
                        <LengthInput
                            metres={inner.fit.y}
                            label={i18n.t('inside.y')}
                            allowZeroOrLess
                            onCommit={(y) => setFit({ y })}
                        />
                    </dd>
                    <dt>{i18n.t('inside.turn')}</dt>
                    <dd>
                        <CommitInput
                            value={String(Math.round(inner.fit.rotation * DEGREES * 10) / 10)}
                            aria-label={i18n.t('inside.turn')}
                            onCommit={(text) => {
                                const degrees = Number(text.replace(',', '.'));
                                if (Number.isFinite(degrees))
                                    setFit({ rotation: degrees / DEGREES });
                            }}
                        />
                    </dd>
                </>
            )}
        </>
    );
}
