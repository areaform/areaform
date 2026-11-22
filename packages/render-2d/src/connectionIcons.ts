// Plan icons for the four kinds of Connection. Each is a 24 × 24 SVG drawn in white strokes, so the
// renderer can tint it to the Theme's colour; replace any of them through `Theme.connectionIcons`.
import type { Connection } from '@areaform/core';

/**
 * The inside of each default icon: the shapes within its 24 × 24 `<svg>`, drawn as round 2-unit
 * strokes. The editor wraps them in its own `<svg>` so its toolbar shows the same glyphs.
 */
export const connectionIconBodies: Record<Connection['kind'], string> = {
    // A flight of steps rising to the right.
    stairs: '<path d="M3 20 H8 V15 H13 V10 H18 V5 H21"/>',
    // A lift car with up and down arrows.
    elevator:
        '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 10 L12 7 L15 10"/><path d="M9 14 L12 17 L15 14"/>',
    // A moving handrail between two landings, and the way it runs.
    escalator:
        '<path d="M2 19 H7 L17 7 H22"/><path d="M5 15 L13 5.5"/><path d="M15 15 L19 15 L19 11"/>',
    // A wedge, with an arrow up the slope.
    ramp: '<path d="M3 19 H21 V9 Z"/><path d="M9 13 L15 10.5"/><path d="M12.5 9.5 L15 10.5 L14 13"/>',
};

const icon = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** The default icon for each Connection kind, as SVG markup. */
export const connectionIcons = Object.fromEntries(
    Object.entries(connectionIconBodies).map(([kind, body]) => [kind, icon(body)]),
) as Record<Connection['kind'], string>;
