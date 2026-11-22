import type { AreaformDocument } from '../model.ts';
import { withChanges, type Changes } from './shared.ts';

/**
 * Changes the Space's own properties: its name and its translations, Space Kind, grid, geo
 * anchor, Content Languages or host `meta`. Changing the default language only says which
 * language the existing texts are in; removing a language keeps its texts, hidden (ADR-0011).
 */
export interface SpaceUpdate {
    type: 'space.update';
    changes: Changes<
        Pick<
            AreaformDocument,
            'id' | 'name' | 'names' | 'kind' | 'grid' | 'geo' | 'languages' | 'meta'
        >
    >;
}

export type SpaceCommand = SpaceUpdate;

export function applySpaceCommand(doc: AreaformDocument, command: SpaceCommand): AreaformDocument {
    // Levels and Connections keep their identity, so renderers redraw nothing (ADR-0005).
    return withChanges<AreaformDocument>(doc, command.changes);
}
