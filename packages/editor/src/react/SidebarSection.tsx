import { useId, type ReactNode } from 'react';

/** The sidebar's sections that can be folded shut: all but Problems, which is a warning. */
export type SidebarSection = 'properties' | 'levels' | 'viewpoints' | 'languages' | 'location';

/** Folded at the start when the host names none: all but Properties, the one used most. */
export const DEFAULT_FOLDED_SECTIONS: readonly SidebarSection[] = [
    'levels',
    'viewpoints',
    'languages',
    'location',
];

/**
 * One section of the sidebar: a heading and what is under it. A foldable one has its heading as
 * the toggle; folded, its content stays mounted but hidden, so what was typed in it is kept.
 */
export function Section({
    title,
    after,
    open = true,
    onToggle,
    children,
}: {
    title: string;
    /** Shown after the title in the heading, e.g. the Problems count. */
    after?: ReactNode;
    open?: boolean;
    /** Makes the section foldable. */
    onToggle?: () => void;
    children: ReactNode;
}) {
    const id = useId();
    return (
        <section className="af-section" data-folded={open ? undefined : ''}>
            <h2 className="af-heading">
                {onToggle ? (
                    <button
                        type="button"
                        className="af-section-toggle"
                        aria-expanded={open}
                        aria-controls={id}
                        onClick={onToggle}
                    >
                        <svg
                            className="af-section-chevron"
                            viewBox="0 0 12 12"
                            aria-hidden="true"
                            focusable="false"
                        >
                            <path d="M3 4.5 6 7.5 9 4.5" />
                        </svg>
                        {title}
                        {after}
                    </button>
                ) : (
                    <>
                        {title}
                        {after}
                    </>
                )}
            </h2>
            <div id={id} className="af-section-body" hidden={!open}>
                {children}
            </div>
        </section>
    );
}
