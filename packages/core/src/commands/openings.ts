import { newId } from '../ids.ts';
import type { AreaformDocument, FreeOpening, HostedOpening, Id, Opening } from '../model.ts';
import {
    addElement,
    deleteElement,
    updateElement,
    withChanges,
    type Changes,
    type Input,
} from './shared.ts';

export interface OpeningAdd {
    type: 'opening.add';
    levelId: Id;
    opening: Input<Opening>;
}

/** Changes for either kind of Opening; whether it is hosted or free cannot change. */
export type OpeningChanges =
    Changes<Omit<HostedOpening, 'host'>> | Changes<Omit<FreeOpening, 'host'>>;

export interface OpeningUpdate {
    type: 'opening.update';
    levelId: Id;
    openingId: Id;
    changes: OpeningChanges;
}

export interface OpeningDelete {
    type: 'opening.delete';
    levelId: Id;
    openingId: Id;
}

export type OpeningCommand = OpeningAdd | OpeningUpdate | OpeningDelete;

export function applyOpeningCommand(
    doc: AreaformDocument,
    command: OpeningCommand,
): AreaformDocument {
    switch (command.type) {
        case 'opening.add': {
            const opening = { ...command.opening, id: command.opening.id ?? newId() } as Opening;
            return addElement(doc, command.levelId, 'openings', opening);
        }
        case 'opening.update':
            return updateElement(doc, command.levelId, 'openings', command.openingId, (o) =>
                withChanges(o, command.changes as Changes<Opening>),
            );
        case 'opening.delete':
            return deleteElement(doc, command.levelId, 'openings', command.openingId);
    }
}
