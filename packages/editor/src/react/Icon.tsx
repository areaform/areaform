// The View's button icons (ADR-0012) as a React element.
import { ICON_BODIES, type IconName } from '@areaform/view';

export { iconNames, type IconName } from '@areaform/view';

/**
 * A button icon, `--af-icon-size` across (16px by default). It is hidden from assistive
 * technology, so give its button an `aria-label`.
 */
export function Icon({ name }: { name: IconName }) {
    return (
        <svg
            className="af-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            dangerouslySetInnerHTML={{ __html: ICON_BODIES[name] }}
        />
    );
}
