import type { Connection } from '@areaform/core';

/**
 * The parts of the 3D look the 2D Theme has no say in. Zones, Obstacles and Openings take their
 * colours from the 2D Theme, so a host's category colours apply in both views. Colours are CSS.
 */
export interface Theme3D {
    background: string;
    /** The top of the floor; the 2D Theme's Outline fill when absent. */
    floor?: string;
    /** The edge of the floor slab. */
    slab: string;
    /** The faces of Walls. */
    wall: string;
    /** The tops of Walls; the 2D Theme's Wall fill when absent, so from above it reads like the plan. */
    wallTop?: string;
    /**
     * Each Stop is a block in its Connection's colour, `height` metres tall (the Level's height when
     * absent), with the Connection's icon on top in `icon` (the 2D Theme's icon colour when absent).
     */
    connections: Record<Connection['kind'], { color: string; height?: number; icon?: string }>;
    /** Zone names on the floor; the 2D Theme's label fill when absent. A Zone's `labelColor` wins. */
    label?: string;
}

export const defaultTheme3D: Theme3D = {
    background: '#f1f1ed',
    slab: '#cfcfca',
    wall: '#e4e3dd',
    connections: {
        stairs: { color: '#b9a3dc', height: 0.4, icon: '#3f2a63' },
        escalator: { color: '#a58fcf', height: 0.4, icon: '#3f2a63' },
        ramp: { color: '#cbbbe6', height: 0.15, icon: '#3f2a63' },
        elevator: { color: '#7b5ea7', icon: '#ffffff' },
    },
};
