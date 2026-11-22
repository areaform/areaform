// What a new Connection starts with, by kind (ADR-0017, slice 3).
import type { Connection } from '@areaform/core';

/**
 * Lifts and ramps start marked accessible, so step-free routes use them; stairs and escalators do
 * not. The owner can change it, e.g. for a lift too small for a wheelchair, or stairs with a lift
 * for one.
 */
export const startsAccessible = (kind: Connection['kind']) =>
    kind === 'elevator' || kind === 'ramp';
