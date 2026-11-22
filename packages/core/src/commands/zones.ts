import { normalizeShape } from '../geometry.ts';
import { newId } from '../ids.ts';
import type { AreaformDocument, Id, Zone } from '../model.ts';
import {
    addElement,
    deleteElement,
    updateElement,
    withChanges,
    type Changes,
    type Input,
} from './shared.ts';

export interface ZoneAdd {
    type: 'zone.add';
    levelId: Id;
    zone: Input<Zone>;
}

export type ZoneChanges = Changes<Zone>;

export interface ZoneUpdate {
    type: 'zone.update';
    levelId: Id;
    zoneId: Id;
    changes: ZoneChanges;
}

export interface ZoneDelete {
    type: 'zone.delete';
    levelId: Id;
    zoneId: Id;
}

export type ZoneCommand = ZoneAdd | ZoneUpdate | ZoneDelete;

export function applyZoneCommand(doc: AreaformDocument, command: ZoneCommand): AreaformDocument {
    switch (command.type) {
        case 'zone.add':
            return addElement(doc, command.levelId, 'zones', {
                ...command.zone,
                id: command.zone.id ?? newId(),
                shape: normalizeShape(command.zone.shape),
            });
        case 'zone.update': {
            const { changes } = command;
            const normalized = changes.shape
                ? { ...changes, shape: normalizeShape(changes.shape) }
                : changes;
            return updateElement(doc, command.levelId, 'zones', command.zoneId, (zone) =>
                withChanges(zone, normalized),
            );
        }
        case 'zone.delete':
            return deleteElement(doc, command.levelId, 'zones', command.zoneId);
    }
}
