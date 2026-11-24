// The sidebar's Viewpoints section (ADR-0025): the cameras saved on the Level shown, in tour order.
// In 3D, the camera as it is becomes a Viewpoint, **Go to** flies to a row's camera and **Use this
// view** saves the camera in its place, and the tour plays in place until the plan is touched. In 2D the list stays, and the plan
// shows each one as a numbered mark.
import type { Changes, Editor, Level, Viewpoint } from '@areaform/core';
import { poseOfCamera, type Pose, type Renderer3D } from '@areaform/render-3d';
import { onInteraction, ORBIT_TURNS_PER_MINUTE } from '@areaform/view';
import { useEffect, useState, type RefObject } from 'react';
import { formatDecimal, parseDecimal } from '../interaction/units.ts';
import { nextViewpointName } from '../document/viewpoints.ts';
import { CommitInput } from './CommitInput.tsx';
import { useI18n } from './i18n.ts';

export function ViewpointsPanel({
    editor,
    level,
    renderer3d,
    stage,
}: {
    editor: Editor;
    level: Level;
    /** The 3D view while it is shown. */
    renderer3d: Renderer3D | null;
    /** The plan's stage: touching it stops a tour or a flight, as on a client's page. */
    stage: RefObject<HTMLElement | null>;
}) {
    const i18n = useI18n();
    const viewpoints = level.viewpoints ?? [];
    /** The camera flies: a whole tour, or to one Viewpoint. */
    const [flying, setFlying] = useState<'tour' | 'one' | null>(null);

    const stop = () => {
        renderer3d?.stopTour();
        setFlying(null);
    };
    // A touch of the plan ends the flight, as on a client's page, so the camera is the person's
    // again. The Editor's plan takes every gesture.
    useEffect(() => {
        const element = stage.current;
        if (!flying || !element) return;
        return onInteraction(element, () => 'greedy', stop);
    }, [flying, stage, renderer3d]);
    // Another Level, another 3D view or a changed list: the flight is over.
    useEffect(() => stop, [renderer3d, level.id, level.viewpoints]);

    const here = (): Pose | null =>
        renderer3d ? tidy(poseOfCamera(renderer3d.getCamera())) : null;
    const add = () => {
        const pose = here();
        if (!pose) return;
        editor.exec({
            type: 'viewpoint.add',
            levelId: level.id,
            viewpoint: {
                name: nextViewpointName(level, (number) =>
                    i18n.t('viewpoint.defaultName', { number }),
                ),
                ...pose,
            },
        });
    };
    const update = (viewpoint: Viewpoint, changes: Changes<Viewpoint>) =>
        editor.exec({
            type: 'viewpoint.update',
            levelId: level.id,
            viewpointId: viewpoint.id,
            changes,
        });
    const move = (viewpoint: Viewpoint, index: number) =>
        editor.exec({
            type: 'viewpoint.move',
            levelId: level.id,
            viewpointId: viewpoint.id,
            index,
        });
    const goTo = (viewpoint: Viewpoint) => {
        renderer3d?.playTour([{ ...viewpoint, pause: 0 }]);
        setFlying('one');
    };
    const play = () => {
        renderer3d?.playTour(viewpoints, { orbitAfter: ORBIT_TURNS_PER_MINUTE });
        setFlying('tour');
    };
    const seconds = (text: string): number | undefined => {
        const value = parseDecimal(text);
        return value === undefined || value < 0 ? undefined : value;
    };

    return (
        <div className="af-viewpoints">
            {viewpoints.length === 0 ? (
                <p className="af-muted">
                    {renderer3d ? i18n.t('viewpoint.none') : i18n.t('viewpoint.open3d')}
                </p>
            ) : (
                <ol className="af-viewpoint-list">
                    {viewpoints.map((viewpoint, i) => {
                        const number = i + 1;
                        return (
                            <li key={viewpoint.id} className="af-viewpoint">
                                <div className="af-row">
                                    <span className="af-viewpoint-number" aria-hidden="true">
                                        {number}
                                    </span>
                                    <CommitInput
                                        aria-label={i18n.t('viewpoint.name', { number })}
                                        value={viewpoint.name ?? ''}
                                        onCommit={(name) =>
                                            update(viewpoint, { name: name.trim() || undefined })
                                        }
                                    />
                                </div>
                                <div className="af-row">
                                    <label className="af-viewpoint-time">
                                        <span>{i18n.t('viewpoint.flight')}</span>
                                        <CommitInput
                                            aria-label={i18n.t('viewpoint.flightField', { number })}
                                            inputMode="decimal"
                                            placeholder={formatDecimal(3, i18n)}
                                            value={
                                                viewpoint.flight === undefined
                                                    ? ''
                                                    : formatDecimal(viewpoint.flight, i18n)
                                            }
                                            onCommit={(text) =>
                                                update(viewpoint, { flight: seconds(text) })
                                            }
                                        />
                                        <span className="af-muted">
                                            {i18n.t('viewpoint.seconds')}
                                        </span>
                                    </label>
                                    <label className="af-viewpoint-time">
                                        <span>{i18n.t('viewpoint.pause')}</span>
                                        <CommitInput
                                            aria-label={i18n.t('viewpoint.pauseField', { number })}
                                            inputMode="decimal"
                                            placeholder={formatDecimal(2, i18n)}
                                            value={
                                                viewpoint.pause === undefined
                                                    ? ''
                                                    : formatDecimal(viewpoint.pause, i18n)
                                            }
                                            onCommit={(text) =>
                                                update(viewpoint, { pause: seconds(text) })
                                            }
                                        />
                                        <span className="af-muted">
                                            {i18n.t('viewpoint.seconds')}
                                        </span>
                                    </label>
                                </div>
                                <div className="af-buttons">
                                    {renderer3d && (
                                        <>
                                            <button
                                                className="af-button"
                                                onClick={() => goTo(viewpoint)}
                                            >
                                                {i18n.t('viewpoint.goTo')}
                                            </button>
                                            <button
                                                className="af-button"
                                                title={i18n.t('viewpoint.useViewTitle')}
                                                onClick={() => {
                                                    const pose = here();
                                                    if (pose) update(viewpoint, pose);
                                                }}
                                            >
                                                {i18n.t('viewpoint.useView')}
                                            </button>
                                        </>
                                    )}
                                    <button
                                        className="af-button"
                                        aria-label={i18n.t('viewpoint.earlier')}
                                        title={i18n.t('viewpoint.earlier')}
                                        disabled={i === 0}
                                        onClick={() => move(viewpoint, i - 1)}
                                    >
                                        ↑
                                    </button>
                                    <button
                                        className="af-button"
                                        aria-label={i18n.t('viewpoint.later')}
                                        title={i18n.t('viewpoint.later')}
                                        disabled={i === viewpoints.length - 1}
                                        onClick={() => move(viewpoint, i + 1)}
                                    >
                                        ↓
                                    </button>
                                    <button
                                        className="af-button"
                                        aria-label={i18n.t('viewpoint.delete', { number })}
                                        title={i18n.t('viewpoint.delete', { number })}
                                        onClick={() =>
                                            editor.exec({
                                                type: 'viewpoint.delete',
                                                levelId: level.id,
                                                viewpointId: viewpoint.id,
                                            })
                                        }
                                    >
                                        ×
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
            {renderer3d && (
                <div className="af-buttons">
                    <button className="af-button" onClick={add}>
                        {i18n.t('viewpoint.add')}
                    </button>
                    {viewpoints.length > 0 &&
                        (flying === 'tour' ? (
                            <button className="af-button" aria-pressed="true" onClick={stop}>
                                {i18n.t('viewpoint.stop')}
                            </button>
                        ) : (
                            <button className="af-button" onClick={play}>
                                {i18n.t('viewpoint.play')}
                            </button>
                        ))}
                </div>
            )}
        </div>
    );
}

/** Rounded to what matters: centimetres and tenths of a degree, so saved plans read cleanly. */
function tidy(pose: Pose): Pose {
    const round = (value: number, step: number) => Math.round(value / step) * step;
    const fix = (value: number, digits: number) => Number(value.toFixed(digits));
    return {
        target: [fix(round(pose.target[0], 0.01), 2), fix(round(pose.target[1], 0.01), 2)],
        bearing: fix(round(pose.bearing, 0.1), 1) % 360,
        tilt: fix(round(pose.tilt, 0.1), 1),
        distance: fix(round(pose.distance, 0.01), 2),
    };
}
