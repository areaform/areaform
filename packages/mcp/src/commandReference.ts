import type { Command } from '@areaform/core';

/** Stands for the Level id `create_draft` returns. */
export const LEVEL = '<levelId>';

/**
 * One example of each Command an import uses, with what its fields mean. The agent sees them in
 * `apply_commands`; a test applies them in this order to a new Draft, so they can't drift from
 * the core.
 */
export const COMMAND_EXAMPLES: { note: string; command: Command }[] = [
    {
        note: "The Level's footprint. A ring is [x, y] points in metres, Y up, the first point not repeated; `holes` (rings) are optional.",
        command: {
            type: 'level.setOutline',
            levelId: LEVEL,
            outline: {
                outer: [
                    [0, 0],
                    [30, 0],
                    [30, 20],
                    [0, 20],
                ],
            },
        },
    },
    {
        note: 'A Wall from a to b (points, or { nodeId } of an existing Wall Node), thickness in metres. Walls ending at the same point share a Wall Node; a Wall crossing another splits it.',
        command: {
            type: 'wall.add',
            levelId: LEVEL,
            id: 'wall-south',
            a: [0, 0],
            b: [30, 0],
            thickness: 0.3,
        },
    },
    {
        note: 'Walls along every Outline edge no Wall covers yet.',
        command: { type: 'walls.fromOutline', levelId: LEVEL, thickness: 0.3 },
    },
    {
        note: "An Opening in a Wall. kind: door | entrance | passage | emergency-exit. offset: metres along the Wall from its a to the Opening's centre. Doors may add hinge: start | end and swing: left | right.",
        command: {
            type: 'opening.add',
            levelId: LEVEL,
            opening: {
                id: 'entrance-1',
                kind: 'entrance',
                width: 3,
                host: 'wall',
                wallId: 'wall-south',
                offset: 20,
            },
        },
    },
    {
        note: 'An Opening where no Wall is drawn: position is its centre, angle (radians, CCW from +X) the direction across its width.',
        command: {
            type: 'opening.add',
            levelId: LEVEL,
            opening: {
                id: 'passage-1',
                kind: 'passage',
                width: 2,
                host: 'free',
                position: [15, 10],
                angle: 0,
            },
        },
    },
    {
        note: "A Zone. category: one of the Preset's Zone Categories (create_draft lists them); restricted: true for a walkable area where nothing may be placed (aisles, fire lanes); walkAround: true for a Zone visitors' routes go around, not through (booths, bays; set from the category when it says so); label is shown on the plan.",
        command: {
            type: 'zone.add',
            levelId: LEVEL,
            zone: {
                id: 'booth-A1',
                label: 'A1',
                category: 'booth',
                shape: {
                    outer: [
                        [2, 2],
                        [5, 2],
                        [5, 5],
                        [2, 5],
                    ],
                },
            },
        },
    },
    {
        note: 'Something that blocks movement. kind: column | shaft | void | other.',
        command: {
            type: 'obstacle.add',
            levelId: LEVEL,
            obstacle: {
                id: 'column-1',
                kind: 'column',
                shape: {
                    outer: [
                        [9.7, 9.7],
                        [10.3, 9.7],
                        [10.3, 10.3],
                        [9.7, 10.3],
                    ],
                },
            },
        },
    },
    {
        note: "Changes to a Zone's fields (label, category, restricted, walkAround, shape, …); opening.update, obstacle.update and wall.update (thickness) work the same way with their own id field.",
        command: {
            type: 'zone.update',
            levelId: LEVEL,
            zoneId: 'booth-A1',
            changes: { label: 'A2' },
        },
    },
    {
        note: "The Content Languages the plan's text is in: label and name fields are in the default; others are offered as translations. BCP 47 tags. Set it when the source shows which language its names are in.",
        command: {
            type: 'space.update',
            changes: { languages: { default: 'en', others: ['pl'] } },
        },
    },
    {
        note: "One text in one Content Language: target is { kind: 'zone', levelId, zoneId }, { kind: 'level', levelId }, { kind: 'connection', connectionId } or { kind: 'space' }. In the default language it sets the label or name itself; an empty text removes a translation.",
        command: {
            type: 'text.set',
            target: { kind: 'zone', levelId: LEVEL, zoneId: 'booth-A1' },
            language: 'pl',
            text: 'Stoisko A2',
        },
    },
    {
        note: "A camera for the 3D view's tour, last in the Level's order (or at index). target is the floor point it looks at; bearing and tilt are degrees: bearing is the compass direction it looks towards (0 north, 90 east), tilt goes from 0 (straight down) to 87 (just above the floor). Get the distance from frame_viewpoint rather than guessing it. viewpoint.update, viewpoint.move (to index) and viewpoint.delete take a viewpointId.",
        command: {
            type: 'viewpoint.add',
            levelId: LEVEL,
            viewpoint: {
                id: 'entrance-view',
                name: 'Entrance',
                target: [5, 1],
                bearing: 0,
                tilt: 55,
                distance: 18,
                flight: 3,
                pause: 2,
            },
        },
    },
    {
        note: 'Deletes; opening.delete, obstacle.delete and wall.delete (which takes its Openings with it) work the same way.',
        command: { type: 'zone.delete', levelId: LEVEL, zoneId: 'booth-A1' },
    },
];

/** The examples as text for a tool description. */
export function commandReference(): string {
    return COMMAND_EXAMPLES.map(
        ({ note, command }) => `- ${command.type}: ${note}\n  ${JSON.stringify(command)}`,
    ).join('\n');
}
