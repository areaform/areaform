// Writes public/plan.json: a made-up car park of three Levels, P0 to P2, each with 40 spots in four
// rows around two driving lanes, a lift and stairs at the west end and a car ramp at the east end.
// Cars come in through the gate on P0. Every bit of floor is a lane, a spot or a walkway, so the
// example knows where cars may drive: on lanes only (see `drivingPlan` in src/parking.ts).
// A plan is usually drawn in the Editor; this one is made by code so it can be read and changed
// here. Run it with `pnpm plan` after a change. It imports nothing, so plain Node runs it.
import { writeFileSync } from 'node:fs';

type Vec2 = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): { outer: Vec2[] } => ({
    outer: [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ],
});

const WIDTH = 46;
const DEPTH = 32;
const STOREY = 3;
/** Spot rows: their letter and where they lie across the deck, metres. */
const ROWS = [
    { row: 'A', y0: 27, y1: 32 },
    { row: 'B', y0: 16, y1: 21 },
    { row: 'C', y0: 11, y1: 16 },
    { row: 'D', y0: 0, y1: 5 },
];
const SPOT_WIDTH = 2.5;
const SPOTS_PER_ROW = 10;
const FIRST_SPOT_X = 10;

/** Spots for drivers with a disabled badge: the two closest to the lift on every Level. */
const ACCESSIBLE = new Set(['B01', 'C01']);
/** Spots with a charger, on P0 and P1. */
const EV = new Set(['A07', 'A08', 'A09', 'A10']);

const LIFT = rect(1, 16, 4, 19.5);
const STAIRS = rect(1, 11.5, 5, 15);
/** The ramp, with a lane round it; cars get on and off at its west side. */
const RAMP = rect(39, 13, 45, 19);
const RAMP_ENTRY: Vec2 = [39, 16];

function level(ordinal: number) {
    const id = `p${ordinal}`;
    const name = `P${ordinal}`;
    const corners: Vec2[] = [
        [0, 0],
        [WIDTH, 0],
        [WIDTH, DEPTH],
        [0, DEPTH],
    ];
    const wallNodes = corners.map((position, i) => ({ id: `${id}-n${i}`, position }));
    // An open deck: parapets, not walls to the ceiling.
    const walls = corners.map((_, i) => ({
        id: `${id}-w${i}`,
        a: `${id}-n${i}`,
        b: `${id}-n${(i + 1) % 4}`,
        thickness: 0.25,
        height: 1.1,
    }));
    // The ground floor's ways in: for cars from the street on the east, on foot on the west.
    const openings =
        ordinal === 0
            ? [
                  {
                      id: 'car-entrance',
                      kind: 'entrance',
                      host: 'wall',
                      wallId: `${id}-w1`,
                      // `offset` is to the Opening's middle: the width of the south lane, y 5 to 11.
                      offset: 8,
                      width: 6,
                  },
                  {
                      id: 'way-out',
                      kind: 'entrance',
                      host: 'wall',
                      wallId: `${id}-w3`,
                      offset: 23.5,
                      width: 1.5,
                  },
              ]
            : [];

    const spots = ROWS.flatMap(({ row, y0, y1 }) =>
        Array.from({ length: SPOTS_PER_ROW }, (_, i) => {
            const label = `${row}${String(i + 1).padStart(2, '0')}`;
            const x0 = FIRST_SPOT_X + i * SPOT_WIDTH;
            const category = ACCESSIBLE.has(label)
                ? 'accessible'
                : EV.has(label) && ordinal < 2
                  ? 'ev'
                  : 'spot';
            return {
                id: `${name}-${label}`,
                shape: rect(x0, y0, x0 + SPOT_WIDTH, y1),
                label,
                category,
                // People walk round parked cars, not through them.
                walkAround: true,
                data: { sensorId: `s-${id}-${label.toLowerCase()}` },
            };
        }),
    );
    const lanes = [
        { id: `${name}-lane-south`, shape: rect(0, 5, WIDTH, 11) },
        { id: `${name}-lane-north`, shape: rect(0, 21, WIDTH, 27) },
        { id: `${name}-lane-ramp`, shape: rect(35, 11, WIDTH, 21) },
    ].map((lane) => ({ ...lane, category: 'lane', restricted: true }));
    // The floor that is neither lane nor spot: for people on foot, round the lift and in the corners.
    const walkways = [
        rect(0, 11, 10, 21),
        rect(0, 0, 10, 5),
        rect(35, 0, WIDTH, 5),
        rect(0, 27, 10, DEPTH),
        rect(35, 27, WIDTH, DEPTH),
    ].map((shape, i) => ({ id: `${name}-walkway-${i}`, shape, category: 'walkway' }));
    // Where cars come in, inside the entrance on P0: every drive starts here.
    const gate =
        ordinal === 0
            ? [{ id: 'gate', shape: rect(42, 5, WIDTH, 11), label: 'Entry', category: 'gate' }]
            : [];

    // Columns down the middle, between the back-to-back rows.
    const columns = [10, 17.5, 25, 32.5].map((x, i) => ({
        id: `${id}-col-${i}`,
        kind: 'column',
        shape: rect(x - 0.25, 15.75, x + 0.25, 16.25),
    }));

    return {
        id,
        name,
        ordinal,
        elevation: ordinal * STOREY,
        height: 2.6,
        outline: { outer: corners },
        wallNodes,
        walls,
        openings,
        zones: [...lanes, ...gate, ...walkways, ...spots],
        obstacles: columns,
        underlays: [],
    };
}

const levels = [0, 1, 2].map(level);
const everyLevel = <T extends object>(shape: T, entry?: Vec2) =>
    levels.map((l) => ({ levelId: l.id, shape, ...(entry && { entry }) }));

const plan = {
    $schema: 'https://areaform.app/schema/v1/document.json',
    schemaVersion: 1,
    id: 'mill-street-car-park',
    name: 'Mill Street Car Park',
    kind: 'parking',
    units: 'm',
    grid: { step: 2.5, snap: true },
    levels,
    connections: [
        {
            id: 'lift',
            kind: 'elevator',
            name: 'Lift',
            stops: everyLevel(LIFT, [4, 17.75]),
            bidirectional: true,
            accessible: true,
        },
        {
            id: 'stairs',
            kind: 'stairs',
            name: 'Stairs',
            stops: everyLevel(STAIRS, [5, 13.25]),
            bidirectional: true,
        },
        // For cars. Not step-free for people on foot: there is no pavement on it.
        {
            id: 'ramp',
            kind: 'ramp',
            name: 'Car ramp',
            stops: everyLevel(RAMP, RAMP_ENTRY),
            bidirectional: true,
        },
    ],
};

const out = new URL('../public/plan.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(plan, null, 4)}\n`);
console.log(`Wrote ${out.pathname}`);
