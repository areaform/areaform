import { useEffect, useState } from 'react';

/** How long a message stays, milliseconds; it waits while the pointer is over it. */
const SHOWN_FOR = 8000;

/**
 * A message about what just happened ("Imported.", "Saved."), over the bottom of the plan, out of
 * the top bar: that bar is one row of fixed height, and a long message would widen or wrap it. It
 * goes by itself, or with ×; a screen reader reads it as it comes (`role="status"`).
 */
export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
    const [hovered, setHovered] = useState(false);
    useEffect(() => {
        if (!message || hovered) return;
        const timer = setTimeout(onClose, SHOWN_FOR);
        return () => clearTimeout(timer);
    }, [message, hovered, onClose]);
    if (!message) return null;
    return (
        <div
            className="toast"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <span role="status">{message}</span>
            <button className="toast-close" aria-label="Close the message" onClick={onClose}>
                ×
            </button>
        </div>
    );
}
