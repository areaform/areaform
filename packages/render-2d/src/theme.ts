import type { Connection } from '@areaform/core';
import { categoryIcons } from './icons/categoryIcons.ts';
import { connectionIcons } from './icons/connectionIcons.ts';

/** A look for an item. Colours are CSS strings; `strokeWidth` is in screen pixels. */
export interface Style {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
}

export interface Theme {
    outline: Style;
    zone: Style;
    /** Defaults per Zone Category, layered over `zone`. */
    categories: Record<string, Style>;
    restricted: Style;
    obstacle: Style;
    stop: Style;
    /** Colour of Connection icons (`stroke`) drawn in each Stop. */
    connectionIcon: Style;
    /** The SVG icon drawn in a Stop for each Connection kind (24 × 24, white, tinted). */
    connectionIcons: Record<Connection['kind'], string>;
    /** Largest Connection icon, metres; smaller Stops get a smaller icon. */
    connectionIconSize: number;
    /**
     * The SVG icon drawn above a Zone's name, by Zone Category id: a one-colour silhouette in the
     * name's colour, whatever colours the SVG uses. `''` leaves a category without one.
     */
    categoryIcons: Record<string, string>;
    /** Largest Zone icon, metres: twice the name's height, at most this. */
    zoneIconSize: number;
    /** Widest host logo on a Zone, metres; a logo is as tall as an icon would be. */
    zoneLogoSize: number;
    wall: Style;
    opening: Style;
    /** Merged over `opening` for emergency exits. */
    emergencyExit: Style;
    label: Style;
    /** Grid lines (`stroke`, `opacity`); every fifth line is drawn twice as strong. */
    grid: Style;
    /** The rulers along the canvas's edges: strip (`fill`, `opacity`), ticks and numbers (`stroke`). */
    ruler: Style;
    /** The mark at the origin, 0/0 (`stroke`, `strokeWidth`). */
    origin: Style;
    highlight: Style;
    /** Default label height, metres. */
    labelSize: number;
    /** Labels smaller than this on screen are not drawn. */
    minLabelPx: number;
    /** Openings and Obstacles smaller than this on screen are not drawn. */
    minFeaturePx: number;
    /** Depth drawn for a free Opening, which has no Wall to take a thickness from. */
    freeOpeningDepth: number;
}

export const defaultTheme: Theme = {
    outline: { fill: '#f7f6f2', stroke: '#9a9a96', strokeWidth: 1 },
    zone: { fill: '#dbe7f5', stroke: '#7d99bd', strokeWidth: 1, opacity: 1 },
    // A colour for every category the built-in Presets suggest, by family. Restricted Zones
    // (aisles, corridors, roads) are drawn in `restricted` over these.
    categories: {
        // Units that must not overlap: amber.
        booth: { fill: '#ffe8a8', stroke: '#c79a2c' },
        bay: { fill: '#fbe2b4', stroke: '#c08a34' },
        'fitting-room': { fill: '#fdebc2', stroke: '#c9a04a' },
        table: { fill: '#ffe8a8', stroke: '#c79a2c' },
        unit: { fill: '#ffe8a8', stroke: '#c79a2c' },
        anchor: { fill: '#e6ece0', stroke: '#93a283' },
        // Ways through: greys.
        aisle: { fill: '#eeeeea', stroke: '#c9c9c4' },
        corridor: { fill: '#eeeeea', stroke: '#c9c9c4' },
        hall: { fill: '#ebebe6', stroke: '#bdbdb6' },
        road: { fill: '#e2e2dd', stroke: '#a3a39c' },
        mall: { fill: '#f0efea', stroke: '#cfcec8' },
        parking: { fill: '#e4e6e8', stroke: '#9aa1a8' },
        'car-ramp': { fill: '#dcdfe2', stroke: '#8d949b' },
        // Rooms to work in: greens.
        room: { fill: '#e3f0e1', stroke: '#86a982' },
        'meeting-room': { fill: '#d6ead3', stroke: '#6f9a6a' },
        'open-space': { fill: '#edf5ea', stroke: '#a1bf97' },
        office: { fill: '#e3f0e1', stroke: '#86a982' },
        // Water: blues.
        kitchen: { fill: '#dcebf6', stroke: '#6f9cc2' },
        wc: { fill: '#d4e5f3', stroke: '#6390b8' },
        bathroom: { fill: '#d4e5f3', stroke: '#6390b8' },
        // Living and gathering: warm.
        living: { fill: '#f6e4d4', stroke: '#c08b5e' },
        bedroom: { fill: '#f4dfe4', stroke: '#b67f8d' },
        lounge: { fill: '#f6e4d4', stroke: '#c08b5e' },
        cafe: { fill: '#f6e4d4', stroke: '#c08b5e' },
        'dining-room': { fill: '#f8ece0', stroke: '#c9a283' },
        bar: { fill: '#ecd2bb', stroke: '#a8714a' },
        terrace: { fill: '#e6efd8', stroke: '#8fa56f' },
        'food-court': { fill: '#f8e6d6', stroke: '#c68f62' },
        stage: { fill: '#fbdcbc', stroke: '#d08a45' },
        // Serving visitors: teals.
        registration: { fill: '#d4eee8', stroke: '#5ea596' },
        info: { fill: '#d4eee8', stroke: '#5ea596' },
        'first-aid': { fill: '#dcefe0', stroke: '#4f9a66' },
        checkout: { fill: '#d4eee8', stroke: '#5ea596' },
        department: { fill: '#e2f1ec', stroke: '#86b3a3' },
        // Goods behind the scenes: tans.
        storage: { fill: '#ece3d5', stroke: '#a8957a' },
        stockroom: { fill: '#ece3d5', stroke: '#a8957a' },
        staging: { fill: '#f1eadf', stroke: '#b5a58c' },
        'loading-dock': { fill: '#e5d9c6', stroke: '#9a8669' },
        service: { fill: '#ece3d5', stroke: '#a8957a' },
    },
    restricted: { fill: '#f6dcdc', stroke: '#c46a6a' },
    obstacle: { fill: '#8f8f8a', stroke: '#6b6b67', strokeWidth: 1 },
    stop: { fill: '#e6dcf3', stroke: '#7b5ea7', strokeWidth: 1.5 },
    connectionIcon: { stroke: '#5b3f8a' },
    connectionIcons,
    connectionIconSize: 1.2,
    categoryIcons,
    zoneIconSize: 1.2,
    zoneLogoSize: 2.4,
    wall: { fill: '#3b3b38' },
    opening: { fill: '#f7f6f2', stroke: '#3b3b38', strokeWidth: 1 },
    emergencyExit: { stroke: '#1f8a4c' },
    label: { fill: '#2b2b29' },
    grid: { stroke: '#8a8a84', opacity: 0.22, strokeWidth: 1 },
    ruler: { fill: '#ffffff', stroke: '#5f5f5a', opacity: 0.92 },
    origin: { stroke: '#d0453a', strokeWidth: 1.5 },
    highlight: { stroke: '#ff6a00', strokeWidth: 3 },
    labelSize: 0.6,
    minLabelPx: 8,
    minFeaturePx: 2,
    freeOpeningDepth: 0.3,
};

/** Merges styles left to right; later defined values win, undefined values are skipped. */
export function mergeStyles(...styles: (Style | undefined)[]): Style {
    const merged: Style = {};
    for (const style of styles) {
        if (!style) continue;
        for (const [key, value] of Object.entries(style) as [keyof Style, never][]) {
            if (value !== undefined) merged[key] = value;
        }
    }
    return merged;
}
