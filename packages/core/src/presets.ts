/** A Zone Category a Preset suggests; `id` is what `Zone.category` stores. */
export interface PresetCategory {
    id: string;
    /** What the editor shows, e.g. "Meeting room". */
    label: string;
    /** Exclusive Category: its Zones must not overlap any Zone in an Exclusive Category (a Diagnostic). */
    exclusive?: boolean;
    /** Zones given this category start as Restricted Zones. */
    restricted?: boolean;
    /** Zones given this category start as Walk-around Zones: routes go around them, not through. */
    walkAround?: boolean;
}

/**
 * Defaults for a Space Kind: the Grid Step and Level height copied into a new Space, and the
 * Zone Categories the editor suggests. Colours for the categories come from the renderer's Theme.
 */
export interface Preset {
    /** The Space Kind's name for people, e.g. "Exhibition". */
    label: string;
    gridStep: number;
    levelHeight: number;
    categories: PresetCategory[];
    /** The category the Zone tool starts with, one of `categories`; none when absent. */
    zoneCategory?: string;
}

/** The Preset of a Space Kind that has none of its own. */
export const genericPreset: Preset = {
    label: 'Generic',
    gridStep: 1,
    levelHeight: 3,
    categories: [
        { id: 'room', label: 'Room' },
        { id: 'aisle', label: 'Aisle', restricted: true },
        { id: 'cafe', label: 'Café' },
    ],
};

/** The built-in Presets, by Space Kind. Extend or replace them with a host's own. */
export const defaultPresets: Record<string, Preset> = {
    exhibition: {
        label: 'Exhibition',
        gridStep: 1,
        levelHeight: 6,
        categories: [
            { id: 'booth', label: 'Booth', exclusive: true, walkAround: true },
            { id: 'aisle', label: 'Aisle', restricted: true },
            { id: 'stage', label: 'Stage' },
            { id: 'lounge', label: 'Lounge' },
            { id: 'registration', label: 'Registration' },
            { id: 'storage', label: 'Storage' },
            { id: 'wc', label: 'WC' },
            { id: 'cafe', label: 'Café' },
            { id: 'info', label: 'Info' },
            { id: 'first-aid', label: 'First aid' },
        ],
        zoneCategory: 'booth',
    },
    office: {
        label: 'Office',
        gridStep: 0.5,
        levelHeight: 3,
        categories: [
            { id: 'room', label: 'Room', exclusive: true },
            { id: 'meeting-room', label: 'Meeting room', exclusive: true },
            { id: 'open-space', label: 'Open space' },
            { id: 'kitchen', label: 'Kitchen' },
            { id: 'wc', label: 'WC' },
            { id: 'corridor', label: 'Corridor', restricted: true },
        ],
    },
    store: {
        label: 'Store',
        gridStep: 0.5,
        levelHeight: 3.5,
        categories: [
            { id: 'department', label: 'Department' },
            { id: 'checkout', label: 'Checkout' },
            { id: 'fitting-room', label: 'Fitting room', exclusive: true },
            { id: 'stockroom', label: 'Stockroom' },
            { id: 'aisle', label: 'Aisle', restricted: true },
        ],
    },
    warehouse: {
        label: 'Warehouse',
        gridStep: 1,
        levelHeight: 8,
        categories: [
            { id: 'bay', label: 'Bay', exclusive: true, walkAround: true },
            { id: 'aisle', label: 'Aisle', restricted: true },
            // Forklift traffic; Roads cross at junctions, so they are not exclusive.
            { id: 'road', label: 'Road', restricted: true },
            { id: 'loading-dock', label: 'Loading dock' },
            { id: 'staging', label: 'Staging' },
            { id: 'office', label: 'Office' },
        ],
        zoneCategory: 'bay',
    },
    cafe: {
        label: 'Café',
        gridStep: 0.1,
        levelHeight: 3.2,
        categories: [
            // A table with its chairs: what guests book, so tables must not overlap.
            { id: 'table', label: 'Table', exclusive: true, walkAround: true },
            { id: 'dining-room', label: 'Dining room' },
            { id: 'terrace', label: 'Terrace' },
            { id: 'bar', label: 'Bar', walkAround: true },
            { id: 'kitchen', label: 'Kitchen', exclusive: true },
            { id: 'wc', label: 'WC' },
            { id: 'storage', label: 'Storage' },
        ],
        zoneCategory: 'table',
    },
    mall: {
        label: 'Shopping centre',
        gridStep: 0.5,
        levelHeight: 4.5,
        categories: [
            // A shop's unit: what the centre lets, so units must not overlap; shoppers walk round.
            { id: 'unit', label: 'Unit', exclusive: true, walkAround: true },
            { id: 'anchor', label: 'Anchor store', walkAround: true },
            { id: 'food-court', label: 'Food court' },
            { id: 'mall', label: 'Mall' },
            { id: 'wc', label: 'WC' },
            { id: 'parking', label: 'Parking' },
            { id: 'car-ramp', label: 'Car ramp', restricted: true },
            { id: 'service', label: 'Service', restricted: true },
        ],
        zoneCategory: 'unit',
    },
    flat: {
        label: 'Flat',
        gridStep: 0.5,
        levelHeight: 2.7,
        categories: [
            { id: 'living', label: 'Living room', exclusive: true },
            { id: 'bedroom', label: 'Bedroom', exclusive: true },
            { id: 'kitchen', label: 'Kitchen', exclusive: true },
            { id: 'bathroom', label: 'Bathroom', exclusive: true },
            { id: 'hall', label: 'Hall', exclusive: true },
        ],
    },
};

/** The Preset of a Space Kind among `presets`; Kinds without one get `genericPreset`. */
export function presetFor(kind: string, presets: Record<string, Preset> = defaultPresets): Preset {
    return Object.hasOwn(presets, kind) ? presets[kind]! : genericPreset;
}

/** The ids of a Preset's Exclusive Categories. */
export function exclusiveCategories(preset: Preset): string[] {
    return preset.categories.filter((c) => c.exclusive).map((c) => c.id);
}
