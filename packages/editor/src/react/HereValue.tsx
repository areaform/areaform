// Here for visitors (ADR-0017): the value for `?here=` with a Copy button, and the host's link.
import { useEffect, useState } from 'react';
import type { EditorController, HerePick } from '../controller.ts';
import { hereValue } from '../here.ts';
import { useI18n } from './i18n.ts';

/** Makes a link that opens the published plan with routes starting at `here`, e.g. for a QR code. */
export type HereLink = (here: string) => string;

/** A text to copy: shown in a read-only field (so it can also be selected by hand) with Copy. */
function Copyable({
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

/** While picking Here: asks for a click, then shows the value for the point clicked. */
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
            <p>{i18n.t('here.clickPoint')}</p>
            {pick.point && <HereValue value={hereValue(levelId, pick.point)} link={link} />}
            <div className="af-buttons">
                <button className="af-button" onClick={() => controller.setTool('select')}>
                    {i18n.t('here.done')}
                </button>
            </div>
        </div>
    );
}
