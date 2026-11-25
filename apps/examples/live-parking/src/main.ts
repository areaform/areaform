// A live car park: the plan's spots coloured by a feed of bay sensors, free spaces per Level, and
// the free spot that gets a driver from the gate to the lift soonest, with the drive to it and the
// walk from it drawn on the plan. Plain TypeScript and the View; no framework.
import { fromJSON, type ElementRef, type Id, type Zone } from '@areaform/core';
import {
    categoryIcons,
    defaultTheme,
    type Style,
    type StyleResolver,
    type Theme,
} from '@areaform/render-2d';
import { createView } from '@areaform/view';
import '@areaform/view/styles.css';
import { simulatedFeed, type SensorEvent } from './feed.ts';
import {
    bestFree,
    freeByLevel,
    spotsOf,
    stateOf,
    tripsOf,
    type Need,
    type Spot,
    type SpotState,
} from './parking.ts';
import { routeLayer } from './route.ts';
import './styles.css';

const response = await fetch('./plan.json');
const loaded = fromJSON(await response.text());
if (!loaded.ok) throw new Error('The plan does not load');
const doc = loaded.doc;

// --- Your data ---------------------------------------------------------------------------------

const spots = spotsOf(doc);
const spotById = new Map(spots.map((s) => [s.id, s]));
/** Spots held for permit holders, e.g. from your booking system. */
const reserved = new Set<Id>(['P0-A01', 'P0-A02', 'P0-A03']);
/** The last report of each sensor, kept up to date by the feed. */
const readings = new Map<string, { occupied: boolean; at: number }>();
const state = (spot: Spot) => stateOf(spot, readings, reserved, Date.now());
/** The drive to each spot and the walk from it: found once, since the plan does not change. */
const trips = tripsOf(doc, spots);

// --- The plan ----------------------------------------------------------------------------------

const COLOURS: Record<SpotState, Style> = {
    free: { fill: '#b9e4c2', stroke: '#2e8b57', strokeWidth: 1 },
    occupied: { fill: '#d9d9d4', stroke: '#a5a59e', strokeWidth: 1 },
    reserved: { fill: '#dcd3f3', stroke: '#7c62c9', strokeWidth: 1 },
    silent: { fill: '#ffffff', stroke: '#c2c2ba', strokeWidth: 1, opacity: 0.7 },
};

// Icons for the two kinds of spot visitors look for; drawn in one colour, like the built-in ones.
const BOLT =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
const WHEELCHAIR =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4" r="2" fill="#000"/><path d="M11 7v6h5l2 6"/><path d="M11 10h4"/><path d="M8 11.5a5 5 0 1 0 7.5 6"/></svg>';

const theme: Theme = {
    ...defaultTheme,
    categoryIcons: { ...categoryIcons, ev: BOLT, accessible: WHEELCHAIR },
};
/**
 * The rest of the floor. Lanes and the gate are Restricted Zones (nothing is put there), drawn as
 * tarmac rather than as a warning; walkways as pavement.
 */
const FLOOR: Record<string, Style> = {
    lane: { fill: '#ebebe6', stroke: '#ebebe6' },
    gate: { fill: '#f6e3bf', stroke: '#d9a441', strokeWidth: 1 },
    walkway: { fill: '#f8f8f5', stroke: '#f8f8f5' },
};

/** Colours from the sensors, drawn over the plan and never saved in it. */
const styleResolver: StyleResolver = (ref, element) => {
    if (ref.kind !== 'zone') return undefined;
    const spot = spotById.get(ref.id);
    if (spot) return COLOURS[state(spot)];
    return FLOOR[(element as Zone).category ?? ''];
};

const route = routeLayer();
const view = createView(document.getElementById('plan')!, {
    doc,
    theme,
    controls: true,
    plugins: [route.plugin],
    styleResolver,
});

// --- The panel ---------------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const levelList = $<HTMLUListElement>('levels');
const suggestion = $<HTMLParagraphElement>('suggestion');
const card = $<HTMLElement>('card');
const levelName = (levelId: Id) => doc.levels.find((l) => l.id === levelId)?.name ?? levelId;
const refOf = (spot: Spot): ElementRef => ({ kind: 'zone', id: spot.id, levelId: spot.levelId });

let need: Need = 'spot';
let suggested: Spot | null = null;
let picked: Spot | null = null;

/**
 * A row per Level, top floor first, made once: the feed only changes the numbers in them, so a
 * button keeps its place and its keyboard focus while cars come and go.
 */
const levelRows = new Map(
    [...doc.levels].reverse().map((level) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'level';
        button.innerHTML = `<span class="level__name"></span><span class="level__free"></span><meter min="0"></meter>`;
        button.querySelector('.level__name')!.textContent = level.name;
        button.addEventListener('click', () => view.setLevel(level.id));
        item.append(button);
        levelList.append(item);
        return [
            level.id,
            {
                button,
                free: button.querySelector<HTMLElement>('.level__free')!,
                meter: button.querySelector('meter')!,
            },
        ];
    }),
);

function drawLevels() {
    for (const { levelId, free, total } of freeByLevel(doc, spots, state)) {
        const row = levelRows.get(levelId)!;
        row.button.setAttribute('aria-current', String(levelId === view.getLevelId()));
        row.free.textContent = `${free} free of ${total}`;
        row.meter.max = total;
        row.meter.value = free;
    }
}

const NEEDS: Record<Need, string> = {
    spot: 'spot',
    ev: 'charging spot',
    accessible: 'accessible spot',
};

const steps = $<HTMLOListElement>('steps');

/** A step of the trip: pressing it shows its Level. */
function step(levelId: Id, text: string): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.dataset.level = levelId;
    button.setAttribute('aria-current', String(levelId === view.getLevelId()));
    button.addEventListener('click', () => view.setLevel(levelId));
    item.append(button);
    return item;
}

/** Picks the best free spot again; `why` says why the old one went. */
function suggest(why?: string) {
    suggested = bestFree(spots, trips, state, need);
    const trip = suggested && trips.get(suggested.id);
    if (!suggested || !trip) {
        suggestion.textContent = `No ${NEEDS[need]} is free right now.`;
        steps.replaceChildren();
        route.show(null);
        view.highlight([]);
        return;
    }
    const minutes = Math.max(1, Math.round(trip.seconds / 60));
    suggestion.textContent = `${why ? `${why} ` : ''}Park at ${suggested.label} on ${levelName(suggested.levelId)}: about ${minutes} min from the gate to the lift.`;
    const legs = trip.drive.legs;
    steps.replaceChildren(
        ...legs.map((leg, i) =>
            step(
                leg.levelId,
                leg.ride
                    ? `${i === 0 ? 'From the gate, drive' : 'Drive'} to the ramp, up to ${levelName(leg.ride.toLevelId)}`
                    : `${i === 0 ? 'From the gate, drive' : 'Drive'} ${Math.round(leg.length)} m to ${suggested!.label}`,
            ),
        ),
        step(suggested.levelId, `Walk ${Math.round(trip.walk.length)} m to the lift`),
    );
    // Asked for, the trip is shown from its start, at the gate, as directions are. Offered again
    // because the spot was taken, it stays on the Level the driver is looking at.
    if (!why) view.setLevel(legs[0]!.levelId);
    view.highlight([refOf(suggested)]);
    route.show({
        // The drive ends beside the spot; drawn on into it, as the car pulls in.
        drive: legs.map(({ levelId, points }, i) => ({
            levelId,
            points: i === legs.length - 1 ? [...points, suggested!.middle] : points,
        })),
        walk: { levelId: suggested.levelId, points: trip.walk.points },
    });
}

const STATES: Record<SpotState, string> = {
    free: 'Free',
    occupied: 'Taken',
    reserved: 'Reserved for permit holders',
    silent: 'No signal from its sensor',
};
const KINDS: Record<string, string> = { ev: 'EV charging', accessible: 'Accessible' };

function drawCard() {
    card.hidden = !picked;
    if (!picked) return;
    const reading = readings.get(picked.sensorId);
    const ago = reading
        ? `${Math.max(0, Math.round((Date.now() - reading.at) / 1000))} s ago`
        : 'never';
    const trip = trips.get(picked.id);
    const facts = [
        ['State', STATES[state(picked)]],
        ...(KINDS[picked.category] ? [['Kind', KINDS[picked.category]!]] : []),
        ['Drive from the gate', trip ? `${Math.round(trip.drive.length)} m` : '—'],
        ['Walk to the lift', trip ? `${Math.round(trip.walk.length)} m` : '—'],
        ['Sensor', picked.sensorId],
        ['Last report', ago],
    ];
    card.innerHTML = '<h2></h2><dl></dl>';
    card.querySelector('h2')!.textContent = `${levelName(picked.levelId)} · ${picked.label}`;
    card.querySelector('dl')!.append(
        ...facts.flatMap(([term, value]) => {
            const dt = document.createElement('dt');
            const dd = document.createElement('dd');
            dt.textContent = term!;
            dd.textContent = value!;
            return [dt, dd];
        }),
    );
}

$<HTMLButtonElement>('find').addEventListener('click', () => suggest());
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="need"]'))
    input.addEventListener('change', () => {
        need = input.value as Need;
        if (suggested) suggest();
    });

view.on('elementClick', (e) => {
    picked = (e.ref.kind === 'zone' && spotById.get(e.ref.id)) || null;
    drawCard();
});
view.on('backgroundClick', () => {
    picked = null;
    drawCard();
});
view.on('levelChange', (levelId) => {
    drawLevels();
    for (const button of steps.querySelectorAll('button'))
        button.setAttribute('aria-current', String(button.dataset.level === levelId));
});

// --- The feed ----------------------------------------------------------------------------------

let frame = 0;
function onEvent(event: SensorEvent) {
    readings.set(event.sensorId, { occupied: event.occupied, at: event.at });
    // Many events can arrive at once (the first report of every sensor): draw once per frame.
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        // Setting the resolver again draws the plan with what it says now.
        view.setStyleResolver(styleResolver);
        drawLevels();
        drawCard();
        // The spot we sent the driver to was just taken: offer the next one.
        // Labels repeat on every Level, so the message names the Level too.
        if (suggested && state(suggested) !== 'free')
            suggest(`${suggested.label} on ${levelName(suggested.levelId)} was just taken.`);
    });
}

simulatedFeed(
    spots.map((s) => s.sensorId),
    onEvent,
    // Two broken sensors, as every real car park has.
    { silent: ['s-p1-c05', 's-p2-a08'] },
);
drawLevels();
