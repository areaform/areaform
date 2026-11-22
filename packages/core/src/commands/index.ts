import type { AreaformDocument } from '../model.ts';
import { applyConnectionCommand, type ConnectionCommand } from './connections.ts';
import { applyLevelCommand, type LevelCommand } from './levels.ts';
import { applyObstacleCommand, type ObstacleCommand } from './obstacles.ts';
import { applyOpeningCommand, type OpeningCommand } from './openings.ts';
import { applySpaceCommand, type SpaceCommand } from './space.ts';
import { applyTextCommand, type TextCommand } from './texts.ts';
import { applyUnderlayCommand, type UnderlayCommand } from './underlays.ts';
import { applyViewpointCommand, type ViewpointCommand } from './viewpoints.ts';
import { applyWallCommand, type WallCommand } from './walls.ts';
import { applyZoneCommand, type ZoneCommand } from './zones.ts';

export type { Changes, Input, OptionalKeys } from './shared.ts';
export type { SpaceCommand, SpaceUpdate } from './space.ts';
export type { TextCommand, TextSet, TextTarget } from './texts.ts';
export type {
    LevelAdd,
    LevelCommand,
    LevelDelete,
    LevelDuplicate,
    LevelMove,
    LevelSetOutline,
    LevelUpdate,
} from './levels.ts';
export type {
    WallAdd,
    WallCommand,
    WallDelete,
    WallEnd,
    WallNodeMerge,
    WallNodeMove,
    WallSplit,
    WallsFromOutline,
    WallUpdate,
} from './walls.ts';
export type {
    OpeningAdd,
    OpeningChanges,
    OpeningCommand,
    OpeningDelete,
    OpeningUpdate,
} from './openings.ts';
export type { ZoneAdd, ZoneChanges, ZoneCommand, ZoneDelete, ZoneUpdate } from './zones.ts';
export type { ObstacleAdd, ObstacleCommand, ObstacleDelete, ObstacleUpdate } from './obstacles.ts';
export type {
    UnderlayAdd,
    UnderlayCalibrate,
    UnderlayCommand,
    UnderlayDelete,
    UnderlayUpdate,
} from './underlays.ts';
export type {
    ViewpointAdd,
    ViewpointCommand,
    ViewpointDelete,
    ViewpointMove,
    ViewpointUpdate,
} from './viewpoints.ts';
export type {
    ConnectionAdd,
    ConnectionCommand,
    ConnectionDelete,
    ConnectionUpdate,
} from './connections.ts';

/** Several Commands applied in order as one; rejected as a whole if any is rejected. */
export interface Batch {
    type: 'batch';
    commands: Command[];
}

export type Command =
    | Batch
    | SpaceCommand
    | LevelCommand
    | WallCommand
    | OpeningCommand
    | ZoneCommand
    | ObstacleCommand
    | UnderlayCommand
    | ViewpointCommand
    | ConnectionCommand
    | TextCommand;

type Routed = Exclude<Command, Batch>;
type CommandOf<T extends Routed['type']> = Extract<Routed, { type: T }>;

/**
 * The handler for every Command type. Typed as a total map, so a new Command type does not
 * compile until it is routed here.
 */
const handlers: {
    [T in Routed['type']]: (doc: AreaformDocument, command: CommandOf<T>) => AreaformDocument;
} = {
    'space.update': applySpaceCommand,
    'level.add': applyLevelCommand,
    'level.update': applyLevelCommand,
    'level.setOutline': applyLevelCommand,
    'level.move': applyLevelCommand,
    'level.duplicate': applyLevelCommand,
    'level.delete': applyLevelCommand,
    'wall.add': applyWallCommand,
    'wall.update': applyWallCommand,
    'wall.delete': applyWallCommand,
    'wallNode.move': applyWallCommand,
    'wallNode.merge': applyWallCommand,
    'wall.split': applyWallCommand,
    'walls.fromOutline': applyWallCommand,
    'opening.add': applyOpeningCommand,
    'opening.update': applyOpeningCommand,
    'opening.delete': applyOpeningCommand,
    'zone.add': applyZoneCommand,
    'zone.update': applyZoneCommand,
    'zone.delete': applyZoneCommand,
    'obstacle.add': applyObstacleCommand,
    'obstacle.update': applyObstacleCommand,
    'obstacle.delete': applyObstacleCommand,
    'underlay.add': applyUnderlayCommand,
    'underlay.update': applyUnderlayCommand,
    'underlay.calibrate': applyUnderlayCommand,
    'underlay.delete': applyUnderlayCommand,
    'viewpoint.add': applyViewpointCommand,
    'viewpoint.update': applyViewpointCommand,
    'viewpoint.delete': applyViewpointCommand,
    'viewpoint.move': applyViewpointCommand,
    'connection.add': applyConnectionCommand,
    'connection.update': applyConnectionCommand,
    'connection.delete': applyConnectionCommand,
    'text.set': applyTextCommand,
};

/** Calls the handler for `command.type`; generic, so each handler gets its own Command type. */
function route<T extends Routed['type']>(
    doc: AreaformDocument,
    command: CommandOf<T> & { type: T },
): AreaformDocument {
    // Commands can arrive from JSON or other clients with a type this version does not know
    // (or one like `toString` that only the prototype has).
    if (!Object.hasOwn(handlers, command.type)) {
        throw new Error(`Unknown command type: ${command.type}`);
    }
    return handlers[command.type](doc, command);
}

/**
 * Applies a Command, returning a new Document. Never mutates its input, and never copies an
 * unchanged Level or Element (ADR-0005). Throws Rejection when the Command cannot be applied.
 */
export function apply(doc: AreaformDocument, command: Command): AreaformDocument {
    if (command.type === 'batch') {
        return command.commands.reduce((next, inner) => apply(next, inner), doc);
    }
    return route(doc, command);
}
