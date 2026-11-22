// The sidebar's "Where is it?" section: the Space's place on Earth (`geo`), given as the latitude
// and longitude of the middle of the plan, which people can copy from a map, and which way up on
// the plan faces. GeoJSON exports use it.
import type { AreaformDocument, Editor, Georeference } from '@areaform/core';
import { useState } from 'react';
import { formatLatLng, middleLatLng, parseLatLng, placeMiddle } from '../location.ts';
import { formatDecimal, parseDecimal } from '../units.ts';
import { CommitInput } from './CommitInput.tsx';
import { useI18n } from './i18n.ts';

export function LocationPanel({ editor, doc }: { editor: Editor; doc: AreaformDocument }) {
    const i18n = useI18n();
    const [placing, setPlacing] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    // Typed before the plan is placed: used when it is.
    const [pendingBearing, setPendingBearing] = useState(0);
    const setGeo = (geo: Georeference | undefined) =>
        editor.exec({ type: 'space.update', changes: { geo } });
    const middle = middleLatLng(doc);
    const bearing = doc.geo?.bearing ?? pendingBearing;

    if (!doc.geo && !placing)
        return (
            <div className="af-location">
                <p className="af-muted">{i18n.t('location.unset')}</p>
                <button className="af-button" onClick={() => setPlacing(true)}>
                    {i18n.t('location.place')}
                </button>
            </div>
        );

    return (
        <div className="af-location">
            <dl className="af-props">
                <dt>{i18n.t('location.middle')}</dt>
                <dd>
                    <CommitInput
                        aria-label={i18n.t('location.middleField')}
                        placeholder="52.22977, 21.01178"
                        value={middle ? formatLatLng(middle) : ''}
                        onCommit={(text) => {
                            const at = parseLatLng(text);
                            if (!at) return setNote(i18n.t('location.invalid'));
                            setNote(null);
                            setGeo(placeMiddle(doc, at, bearing));
                            setPlacing(false);
                        }}
                    />
                    <p className="af-muted">{note ?? i18n.t('location.middleHint')}</p>
                </dd>
                <dt>{i18n.t('location.bearing')}</dt>
                <dd>
                    <div className="af-row">
                        <CommitInput
                            aria-label={i18n.t('location.bearingField')}
                            inputMode="decimal"
                            value={formatDecimal(bearing, i18n)}
                            onCommit={(text) => {
                                const degrees = parseDecimal(text);
                                // Turned around the middle, which stays where it was placed.
                                if (degrees === undefined) return;
                                if (middle) setGeo(placeMiddle(doc, middle, degrees));
                                else setPendingBearing(degrees);
                            }}
                        />
                        <span className="af-muted">{i18n.t('location.degreesFromNorth')}</span>
                        <NorthArrow bearing={bearing} title={i18n.t('location.north')} />
                    </div>
                </dd>
            </dl>
            {doc.geo && (
                <button
                    className="af-button"
                    onClick={() => {
                        setGeo(undefined);
                        setPlacing(false);
                    }}
                >
                    {i18n.t('location.remove')}
                </button>
            )}
        </div>
    );
}

/** Where north is on the plan as drawn: up, turned back by the bearing. */
function NorthArrow({ bearing, title }: { bearing: number; title: string }) {
    return (
        <svg className="af-north" viewBox="-12 -12 24 24" role="img" aria-label={title}>
            <title>{title}</title>
            <path
                d="M0 -11 L6 7 L0 3 L-6 7 Z"
                fill="currentColor"
                transform={`rotate(${-bearing})`}
            />
        </svg>
    );
}
