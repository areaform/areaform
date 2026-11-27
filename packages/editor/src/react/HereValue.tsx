// Here for visitors (ADR-0017): the value for `?here=` with a Copy button, and the host's link.
import { useEffect, useState } from 'react';
import type { EditorController, HerePick } from '../interaction/controller.ts';
import { hereValue } from '../document/here.ts';
import { lookAtPointLine } from '../document/pageLines.ts';
import { useI18n } from './i18n.ts';

/** Makes a link that opens the published plan with routes starting at `here`, e.g. for a QR code. */
export type HereLink = (here: string) => string;

/** A text to copy: shown in a read-only field (so it can also be selected by hand) with Copy. */
export function Copyable({
    value,
    label,
    copyLabel,
}: {
    value: string;
    label: string;
    copyLabel: string;
}) {
    const i18n = useI18n();
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <div className="af-buttons af-copyable">
            <input
                className="af-input"
                readOnly
                value={value}
                aria-label={label}
                onFocus={(e) => e.target.select()}
            />
            <button
                type="button"
                className="af-button"
                onClick={() => {
                    void navigator.clipboard?.writeText(value).then(() => setCopied(true));
                }}
            >
                {copied ? i18n.t('here.copied') : copyLabel}
            </button>
        </div>
    );
}

/** The value for `?here=`, and the link with it when the host makes links. */
export function HereValue({ value, link }: { value: string; link?: HereLink | undefined }) {
    const i18n = useI18n();
    return (
        <>
            <Copyable value={value} label={i18n.t('here.value')} copyLabel={i18n.t('here.copy')} />
            {link && (
                <Copyable
                    value={link(value)}
                    label={i18n.t('here.link')}
                    copyLabel={i18n.t('here.copyLink')}
                />
            )}
        </>
    );
}

/**
 * While picking a point: asks for a click, then shows the value for the point clicked: for `?here=`,
 * or a `lookAt` line for a page that moves the camera.
 */
export function HerePrompt({
    controller,
    levelId,
    pick,
    link,
}: {
    controller: EditorController;
    levelId: string;
    pick: HerePick;
    link?: HereLink | undefined;
}) {
    const i18n = useI18n();
    return (
        <div className="af-modal" role="dialog" aria-label={i18n.t('here.heading')}>
            <p>{i18n.t(pick.for === 'page' ? 'page.clickPoint' : 'here.clickPoint')}</p>
            {pick.point &&
                (pick.for === 'page' ? (
                    <Copyable
                        value={lookAtPointLine(pick.point)}
                        label={i18n.t('page.point')}
                        copyLabel={i18n.t('here.copy')}
                    />
                ) : (
                    <HereValue value={hereValue(levelId, pick.point)} link={link} />
                ))}
            <div className="af-buttons">
                <button className="af-button" onClick={() => controller.setTool('select')}>
                    {i18n.t('here.done')}
                </button>
            </div>
        </div>
    );
}
