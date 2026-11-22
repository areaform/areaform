import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A button in the top bar with a list under it, such as File. Actions live in menus so the bar
 * stays one short row: a wrapped bar moves the plan, which breaks drags in the e2e tests.
 * `children` gets `close`, for an item to call before it acts.
 */
export function Menu({
    label,
    title,
    align = 'start',
    children,
}: {
    label: string;
    title?: string;
    align?: 'start' | 'end';
    children: (close: () => void) => ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!open) return;
        // Closes on Escape, or on a press outside the menu.
        const close = (event: Event) => {
            const keep =
                event instanceof KeyboardEvent
                    ? event.key !== 'Escape'
                    : root.current?.contains(event.target as Node);
            if (!keep) setOpen(false);
        };
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);

    return (
        <span className="menu" ref={root}>
            <button
                className="bar-button"
                aria-haspopup="menu"
                aria-expanded={open}
                title={title}
                onClick={() => setOpen((was) => !was)}
            >
                {label}
                <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M3 4.5 6 7.5 9 4.5" />
                </svg>
            </button>
            {open && (
                <span className="menu-list" role="menu" aria-label={label} data-align={align}>
                    {children(() => setOpen(false))}
                </span>
            )}
        </span>
    );
}

/** A thin line between groups of items in a menu. */
export function MenuSeparator() {
    return <span className="menu-separator" role="separator" />;
}
