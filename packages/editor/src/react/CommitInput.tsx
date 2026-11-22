import { useEffect, useState } from 'react';

/**
 * A text field that commits on blur or Enter, so typing a label is one undo step, not one per
 * keystroke. Escape reverts. Numbers are text with `inputMode="decimal"` rather than
 * `type="number"`, which the browser would show in its own language, not the interface's.
 */
export function CommitInput(props: {
    value: string;
    onCommit: (value: string) => void;
    /** A number: a keyboard with digits and the decimal separator on touch screens. */
    inputMode?: 'decimal';
    /** The id of a `<datalist>` of suggestions. */
    list?: string;
    placeholder?: string;
    'aria-label'?: string;
}) {
    const { value, onCommit, ...rest } = props;
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        if (draft !== value) onCommit(draft);
    };
    return (
        <input
            className="af-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setDraft(value);
            }}
            {...rest}
        />
    );
}
