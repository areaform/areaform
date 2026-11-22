import { normalizeShape } from '../geometry.ts';
import { newId } from '../ids.ts';
import type { AreaformDocument, Id, Obstacle } from '../model.ts';
import {
    addElement,
    deleteElement,
    updateElement,
    withChanges,
    type Changes,
    type Input,
} from './shared.ts';

export interface ObstacleAdd {
    type: 'obstacle.add';
    levelId: Id;
    obstacle: Input<Obstacle>;
}

export interface ObstacleUpdate {
    type: 'obstacle.update';
    levelId: Id;
    obstacleId: Id;
    changes: Changes<Obstacle>;
}

export interface ObstacleDelete {
    type: 'obstacle.delete';
    levelId: Id;
    obstacleId: Id;
}

export type ObstacleCommand = ObstacleAdd | ObstacleUpdate | ObstacleDelete;

export function applyObstacleCommand(
    doc: AreaformDocument,
    command: ObstacleCommand,
): AreaformDocument {
    switch (command.type) {
        case 'obstacle.add':
            return addElement(doc, command.levelId, 'obstacles', {
                ...command.obstacle,
                id: command.obstacle.id ?? newId(),
                shape: normalizeShape(command.obstacle.shape),
            });
        case 'obstacle.update': {
            const { changes } = command;
            const normalized = changes.shape
                ? { ...changes, shape: normalizeShape(changes.shape) }
                : changes;
            return updateElement(doc, command.levelId, 'obstacles', command.obstacleId, (o) =>
                withChanges(o, normalized),
            );
        }
        case 'obstacle.delete':
            return deleteElement(doc, command.levelId, 'obstacles', command.obstacleId);
    }
}
