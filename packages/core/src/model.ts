// Document model, schema version 1. See CONTEXT.md for the meaning of each term.

export type Id = string;

/** Metres, Space-local, Y-up (ADR-0002). */
export type Vec2 = [number, number];

/** Closed ring, first point not repeated. Outer rings CCW, holes CW. */
export type Ring = Vec2[];

export interface Shape {
    outer: Ring;
    holes?: Ring[];
}

/** Texts in Content Languages other than the default, by BCP 47 tag, e.g. `{ pl: 'Stoisko 1' }`. */
export type Translations = Record<string, string>;

/**
 * The Content Languages a Space's own text is written in (ADR-0011). `label` and `name` fields
 * are in `default`; `others` are offered as translations. Tags are BCP 47 (`pl`, `pt-BR`).
 */
export interface ContentLanguages {
    default: string;
    others?: string[];
}

/**
 * Where a Space lies on Earth: the latitude and longitude, in degrees, of the plan's origin
 * `[0, 0]`, and `bearing`, the compass direction of the plan's +Y axis in degrees clockwise
 * from north (0: up on the plan is north; 90: east).
 */
export interface Georeference {
    origin: { lat: number; lng: number };
    bearing: number;
}

export interface AreaformDocument {
    schemaVersion: 1;
    id: Id;
    name: string;
    /** `name` in other Content Languages. */
    names?: Translations;
    /** Absent in Documents made before Content Languages: the default language is then unknown. */
    languages?: ContentLanguages;
    kind: string;
    units: 'm';
    grid: { step: number; snap: boolean };
    /** Where the Space lies on Earth; absent when it has not been placed. */
    geo?: Georeference;
    levels: Level[];
    connections: Connection[];
    meta?: Record<string, unknown>;
}

export interface Level {
    id: Id;
    name: string;
    /** `name` in other Content Languages. */
    names?: Translations;
    group?: string;
    ordinal: number;
    elevation: number;
    height: number;
    outline: Shape;
    wallNodes: WallNode[];
    walls: Wall[];
    openings: Opening[];
    zones: Zone[];
    obstacles: Obstacle[];
    underlays: Underlay[];
    /** The cameras saved on this Level, in the order a tour flies through them (ADR-0025). */
    viewpoints?: Viewpoint[];
}

/**
 * The most a Viewpoint may tilt from straight down, degrees: the 3D view stops the camera just above
 * the floor, so it never looks from underneath.
 */
export const MAX_VIEWPOINT_TILT = 87;

/**
 * A camera saved on a Level for the 3D view: the floor point it looks at, from which side and how
 * steeply, and how far away. Unlike the rest of the format its angles are compass degrees, so a
 * person or an AI can write one by hand ("from the south-east, 45° down").
 */
export interface Viewpoint {
    id: Id;
    /** Shown in the Editor's list, e.g. "Entrance A". */
    name?: string;
    /** The point on the floor it looks at, metres. */
    target: Vec2;
    /** Degrees, the compass direction it looks towards: 0 north (+Y), 90 east (+X). */
    bearing: number;
    /** Degrees from straight down (0) towards level with the floor, at most `MAX_VIEWPOINT_TILT`. */
    tilt: number;
    /** Metres from the target. */
    distance: number;
    /** Seconds a tour takes to fly here; 3 when absent. */
    flight?: number;
    /** Seconds a tour stays here; 2 when absent. */
    pause?: number;
}

export interface WallNode {
    id: Id;
    position: Vec2;
}

/** Centre-line edge between two Wall Nodes (ADR-0001). */
export interface Wall {
    id: Id;
    a: Id;
    b: Id;
    thickness: number;
    height?: number;
}

export type OpeningKind = 'door' | 'entrance' | 'passage' | 'emergency-exit';

interface OpeningBase {
    id: Id;
    kind: OpeningKind;
    width: number;
    /**
     * For doors, the jamb the leaf hangs from: `start` is the end nearer the Wall's `a` node (or,
     * for a free Opening, the end behind its angle). Absent means `start`.
     */
    hinge?: 'start' | 'end';
    /**
     * For doors, the side the leaf opens to, looking from `start` to `end`. Absent means `left`.
     */
    swing?: 'left' | 'right';
}

export interface HostedOpening extends OpeningBase {
    host: 'wall';
    wallId: Id;
    /** Metres from the Wall's `a` node to the Opening's centre. */
    offset: number;
}

export interface FreeOpening extends OpeningBase {
    host: 'free';
    position: Vec2;
    /** Radians, CCW from +X. */
    angle: number;
}

export type Opening = HostedOpening | FreeOpening;

export interface Zone {
    id: Id;
    shape: Shape;
    label?: string;
    /** `label` in other Content Languages. */
    labels?: Translations;
    labelAnchor?: Vec2;
    /** Font height of the label, metres: the largest it is drawn; it shrinks to fit inside the Zone. */
    labelSize?: number;
    /** Colour of the label text (a CSS colour); the renderer's Theme decides when absent. */
    labelColor?: string;
    category?: string;
    restricted?: boolean;
    /** Walk-around Zone: visitors' routes go around it, not through it (ADR-0017). */
    walkAround?: boolean;
    /**
     * Inner Space: the Space shown inside this Zone, such as a shop's own plan in a shopping
     * centre's unit (Inner Space, CONTEXT.md). Only the outer Space's owner names it.
     */
    innerSpace?: InnerSpaceRef;
    style?: { fill?: string; stroke?: string; opacity?: number };
    data?: Record<string, unknown>;
}

/** A Zone's Inner Space: which Space it is, and where its plan lies in the outer one. */
export interface InnerSpaceRef {
    /** The Space's id: a hosted `sp_…` id, or the host's own name for a plan it loads itself. */
    space: string;
    /** Where the Inner Space's coordinates lie in this Space's; absent, it is shown on its own. */
    fit?: InnerSpaceFit;
}

/**
 * Places an Inner Space's point `p` at `rotate(p, rotation) + [x, y]` in the outer Space: both are
 * in metres, so there is no scale. `rotation` in radians, counter-clockwise.
 */
export interface InnerSpaceFit {
    x: number;
    y: number;
    rotation: number;
}

export interface Obstacle {
    id: Id;
    shape: Shape;
    kind: 'column' | 'shaft' | 'void' | 'other';
}

export interface Connection {
    id: Id;
    kind: 'stairs' | 'elevator' | 'escalator' | 'ramp';
    name?: string;
    /** `name` in other Content Languages. */
    names?: Translations;
    stops: Stop[];
    bidirectional: boolean;
    accessible?: boolean;
}

export interface Stop {
    levelId: Id;
    shape: Shape;
    entry?: Vec2;
}

/**
 * A reference image. Pixels grow right and down; a pixel maps to the plan as
 * `position + rotate(rotation) · [x · scale, −y · scale]`, so `position` is where the
 * image's top-left corner lies.
 */
export interface Underlay {
    id: Id;
    /** URL or asset id, resolved by the host; the core never stores image data. */
    src: string;
    position: Vec2;
    /** Metres per image pixel. */
    scale: number;
    /** Radians, CCW. */
    rotation: number;
    opacity: number;
    /** Locked Underlays cannot be picked or moved on the canvas. */
    locked: boolean;
    /**
     * Image size in pixels, recorded when the image is added. Without it the Underlay still
     * renders but cannot be picked on the canvas (its extent is unknown).
     */
    size?: Vec2;
}
