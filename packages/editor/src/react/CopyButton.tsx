// A button that puts a text on the clipboard and says Copied for a moment: the lines and values
// the Editor gives a client's page (ADR-0030).
import { useEffect, useState } from 'react';
import { useI18n } from './i18n.ts';

export function CopyButton({
    text,
    label,
    title,
}: {
    /** The text, made when pressed, e.g. from the camera as it is then. */
    text: () => string;
    label: string;
    title?: string;
}) {
    const i18n = useI18n();
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <button
            type="button"
            className="af-button"
            {...(title && { title })}
            onClick={() => {
                void navigator.clipboard?.writeText(text()).then(() => setCopied(true));
            }}
        >
            {copied ? i18n.t('here.copied') : label}
        </button>
    );
}
