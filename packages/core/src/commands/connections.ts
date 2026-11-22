import { normalizeShape } from '../geometry.ts';
import { newId } from '../ids.ts';
import type { Connection, AreaformDocument, Id, Stop } from '../model.ts';
import { requireElement, withChanges, type Changes, type Input } from './shared.ts';

export interface ConnectionAdd {
    type: 'connection.add';
    connection: Input<Connection>;
}

export interface ConnectionUpdate {
    type: 'connection.update';
    connectionId: Id;
    changes: Changes<Connection>;
}

export interface ConnectionDelete {
    type: 'connection.delete';
    connectionId: Id;
}

export type ConnectionCommand = ConnectionAdd | ConnectionUpdate | ConnectionDelete;

export function applyConnectionCommand(
    doc: AreaformDocument,
    command: ConnectionCommand,
): AreaformDocument {
    switch (command.type) {
        case 'connection.add': {
            const connection: Connection = {
                ...command.connection,
                id: command.connection.id ?? newId(),
                stops: command.connection.stops.map(normalizeStop),
            };
            return { ...doc, connections: [...doc.connections, connection] };
        }
        case 'connection.update': {
            requireElement(doc.connections, command.connectionId);
            const { changes } = command;
            const normalized = changes.stops
                ? { ...changes, stops: changes.stops.map(normalizeStop) }
                : changes;
            return {
                ...doc,
                connections: doc.connections.map((c) =>
                    c.id === command.connectionId ? withChanges(c, normalized) : c,
                ),
            };
        }
        case 'connection.delete':
            requireElement(doc.connections, command.connectionId);
            return {
                ...doc,
                connections: doc.connections.filter((c) => c.id !== command.connectionId),
            };
    }
}

function normalizeStop(stop: Stop): Stop {
    return { ...stop, shape: normalizeShape(stop.shape) };
}
