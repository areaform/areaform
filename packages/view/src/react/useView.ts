// Internal: a View for a React component, created once and kept in step with its props.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createView, type View, type ViewEvents, type ViewOptions } from '../view.ts';

/** The props a component turns into View event handlers. */
export type ViewHandlers = { [E in keyof ViewEvents]?: ((e: ViewEvents[E]) => void) | undefined };

/**
 * Creates a View in the returned ref's element when it mounts, with `options` as they are then,
 * and calls the latest `handlers` for its events. Destroyed on unmount.
 */
export function useView(options: ViewOptions, handlers: ViewHandlers) {
    const holder = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<View | null>(null);
    const latest = useRef({ options, handlers });
    useLayoutEffect(() => {
        latest.current = { options, handlers };
    });
    useEffect(() => {
        const created = createView(holder.current!, latest.current.options);
        for (const event of EVENTS)
            created.on(event, (e) =>
                (latest.current.handlers[event] as ((e: unknown) => void) | undefined)?.(e),
            );
        setView(created);
        return () => created.destroy();
    }, []);
    return { holder, view };
}

const EVENTS: (keyof ViewEvents)[] = [
    'elementClick',
    'backgroundClick',
    'elementHover',
    'viewChange',
    'levelChange',
    'gridChange',
    'zoomChange',
    'camera3dChange',
    'ready',
    'ready3d',
];

/** No box of its own, so the View fills what the host gives the component, as a div would. */
export const HOLDER_STYLE = { display: 'contents' } as const;
