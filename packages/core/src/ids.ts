import type { Id } from './model.ts';

// Core ships without DOM or Node typings; this is the one runtime global it relies on.
declare const crypto: { randomUUID(): string };

export function newId(): Id {
    return crypto.randomUUID();
}
