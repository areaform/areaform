// The Inner Space Plugin (Inner Space, CONTEXT.md): a unit Zone that names another Space, such as
// a shop's own plan in a shopping centre's unit, gets **See inside** on its place card. Going in,
// the camera turns to the unit (in 2D, pans and zooms to it), the plan fades, and the shop's plan
// comes in on that spot, laid in by the Zone's `fit` (else on its own, framed whole); the Level
// switcher shows the shop's Levels, and a button at the top, named after the host's own plan,
// goes back out. A visitor's next move, or the View's `reset`, ends a move in or out where it is.
// The host loads each plan (`loadInnerSpace`), so a developer wires it to their own files and
// `embed.js` to hosted Spaces.
import {
    placeDocument,
    textIn,
    type AreaformDocument,
    type InnerSpaceRef,
    type Zone,
} from '@areaform/core';
import { cardButton, fillPlaceCard, type PlaceZone } from '../placeCard.ts';
import type { ViewPlugin } from '../plugins.ts';
import { tooltipText } from './tooltip.ts';
import { zonePoint } from './wayfindingModel.ts';

export interface InnerSpaceOptions {
    /**
     * The plan of the Space a unit names, or null when there is none to show: unpublished,
     * deleted, or not allowed here. Asked once per Space, when its unit's card first opens.
     */
    loadInnerSpace(ref: InnerSpaceRef, unit: PlaceZone): Promise<AreaformDocument | null>;
    /** A visitor went into the unit's Inner Space, e.g. to count it for the centre. */
    onEnter?(unit: PlaceZone): void;
}

/** The Inner Space Plugin, with a handle for the host page. Give each View its own. */
export interface InnerSpacePlugin extends ViewPlugin {
    /**
     * Goes into the Inner Space of the unit `zoneId`, on the host's own plan, as **See inside**
     * does, e.g. for a link to a department (`?inside=`). False when it has none to show.
     */
    enter(zoneId: string): Promise<boolean>;
    /** Back out to the host's own plan, as **← back** does. */
    leave(): Promise<void>;
}

/** Milliseconds the plan takes to fade out, and in again. */
const FADE_MS = 250;
/** Seconds the camera takes to turn to the unit before going in. */
const TURN_SECONDS = 0.8;

/** The unit Zone `zoneId` names on the plan, with its Level, and its Inner Space. */
function unitOf(doc: AreaformDocument, zoneId: string) {
    for (const level of doc.levels) {
        const zone = level.zones.find((z) => z.id === zoneId);
        if (zone?.innerSpace) return { zone, levelId: level.id, ref: zone.innerSpace };
    }
    return null;
}

export function innerSpace(options: InnerSpaceOptions): InnerSpacePlugin {
    let running: { enter(id: string): Promise<boolean>; leave(): Promise<void> } | null = null;
    const plugin: ViewPlugin = ({ view, overlay }) => {
        const t = () => view.getTranslator();
        /** Each Space's plan as it loads, by its id: null when it cannot be shown. */
        const plans = new Map<string, Promise<AreaformDocument | null>>();
        const loaded = new Map<string, AreaformDocument | null>();
        const load = (ref: InnerSpaceRef, unit: PlaceZone) => {
            let plan = plans.get(ref.space);
            if (!plan) {
                plan = options.loadInnerSpace(ref, unit).catch((error: unknown) => {
                    console.error('[Areaform]', error);
                    return null;
                });
                plans.set(ref.space, plan);
                void plan.then((doc) => {
                    loaded.set(ref.space, doc);
                    view.placeCard.changed();
                    if (ownFor) drawOwnCard(ownFor);
                });
            }
            return plan;
        };
        /** The unit whose own card is open, while it is (see `drawOwnCard`). */
        let ownFor: PlaceZone | null = null;
        /** The unit gone into, while its Inner Space is shown. */
        let inside: { zone: Zone; levelId: string } | null = null;
        let destroyed = false;
        /**
         * Counts moves in and out: each waits on the camera and the fade, and a later one, a
         * `reset` or the end of the Plugin, makes it stop where it is.
         */
        let moves = 0;
        const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
        const fade = (out: boolean) =>
            new Promise<void>((resolve) => {
                view.element.classList.toggle('af-inner-fade', out);
                if (reduced()) resolve();
                else setTimeout(resolve, FADE_MS);
            });

        // --- Elements --------------------------------------------------------------------------

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'af-inner-back';
        back.hidden = true;
        back.addEventListener('click', (e) => {
            e.stopPropagation();
            void leave();
        });
        // The unit's outline, kept over the shop's plan so the visitor sees where they went in.
        const svgNs = 'http://www.w3.org/2000/svg';
        const outline = document.createElementNS(svgNs, 'svg');
        outline.setAttribute('class', 'af-inner-unit');
        const outlinePath = document.createElementNS(svgNs, 'path');
        outline.append(outlinePath);
        outline.style.display = 'none';
        /** The card shown when no other Plugin shows one, e.g. without Directions. */
        const ownCard = document.createElement('div');
        ownCard.className = 'af-place-card';
        ownCard.hidden = true;
        // The own card joins the overlay only when it is first shown, so a plan with Wayfinding has one.
        overlay.append(outline, back);

        const drawBack = () => {
            back.hidden = !inside;
            if (!inside) return;
            const home = view.getHomeDocument();
            const name = textIn(home.name, home.names, home.languages, view.getContentLanguage());
            back.textContent = t().t('innerSpace.back', { name: name ?? home.name });
            back.setAttribute(
                'aria-label',
                t().t('innerSpace.backLabel', { name: name ?? home.name }),
            );
        };
        const drawOutline = () => {
            // Only a fitted plan lies on the unit; one on its own is elsewhere in its own plan.
            const ring = inside?.zone.innerSpace?.fit ? inside.zone.shape.outer : null;
            const points = ring?.map((p) => view.toScreen(p));
            if (!points || points.some((p) => p === null)) {
                outline.style.display = 'none';
                return;
            }
            outline.style.display = '';
            outlinePath.setAttribute(
                'd',
                `M${(points as [number, number][]).map(([x, y]) => `${x},${y}`).join('L')}Z`,
            );
        };

        // --- Going in and out ------------------------------------------------------------------

        const enter = async (zoneId: string) => {
            if (destroyed || inside) return false;
            const home = view.getHomeDocument();
            if (view.getDocument() !== home) return false;
            const unit = unitOf(home, zoneId);
            if (!unit) return false;
            const move = ++moves;
            /** Whether this move still stands: nothing came after it, and it is still home. */
            const current = () =>
                move === moves && !destroyed && view.getDocument() === home && !inside;
            const plan = await load(unit.ref, { id: unit.zone.id, levelId: unit.levelId });
            if (!plan || !current()) return false;
            const fit = unit.ref.fit;
            drawOwnCard(null);
            if (!reduced()) await view.lookAt(zoneId, { seconds: TURN_SECONDS });
            if (!current()) return false;
            await fade(true);
            if (!current()) {
                view.element.classList.remove('af-inner-fade');
                return false;
            }
            inside = { zone: unit.zone, levelId: unit.levelId };
            view.showSpace(fit ? placeDocument(plan, fit) : plan, undefined, {
                zoneId: unit.zone.id,
                levelId: unit.levelId,
                fitted: fit !== undefined,
            });
            options.onEnter?.({ id: unit.zone.id, levelId: unit.levelId });
            // Laid into the unit, the camera is already on it; on its own, the shop is framed whole.
            if (!fit) view.fit();
            view.holdMotion('innerSpace', true);
            drawBack();
            drawOutline();
            await fade(false);
            return true;
        };

        const leave = async () => {
            if (!inside) return;
            const unit = inside;
            const move = ++moves;
            await fade(true);
            if (move !== moves || destroyed || inside !== unit) {
                // A `reset` came first: already home, and the plan in sight again.
                view.element.classList.remove('af-inner-fade');
                return;
            }
            // `spaceChange` clears what was inside.
            view.showSpace(null, unit.levelId);
            await view.lookAt(unit.zone.id, { seconds: 0 });
            await fade(false);
        };

        // --- The place card --------------------------------------------------------------------

        const button = (zone: PlaceZone) => {
            if (view.getDocument() !== view.getHomeDocument()) return null;
            const unit = unitOf(view.getDocument(), zone.id);
            if (!unit) return null;
            // Asked for when the card first opens; the button comes once the plan is there.
            if (!loaded.has(unit.ref.space)) {
                void load(unit.ref, zone);
                return null;
            }
            return loaded.get(unit.ref.space)
                ? { label: t().t('innerSpace.seeInside'), run: () => void enter(zone.id) }
                : null;
        };

        /** Without a Plugin showing the place card, a unit with a shop's plan shows its own. */
        const drawOwnCard = (zone: PlaceZone | null) => {
            ownFor = zone;
            const found = zone && button(zone);
            if (!zone || !found) {
                ownCard.hidden = true;
                ownCard.replaceChildren();
                ownCard.remove();
                return;
            }
            if (!ownCard.isConnected) overlay.append(ownCard);
            const unit = unitOf(view.getDocument(), zone.id)!;
            const title = tooltipText(
                view.getDocument(),
                { kind: 'zone', ...zone },
                t(),
                view.getContentLanguage(),
            )?.title;
            fillPlaceCard(ownCard, {
                title: title ?? '',
                body: [cardButton(found.label, found.run, 'af-primary')],
                closeLabel: t().t('placeCard.close'),
                onClose: () => drawOwnCard(null),
            });
            const screen = view.toScreen(zonePoint(unit.zone));
            ownCard.hidden = screen === null;
            if (screen) ownCard.style.transform = `translate(${screen[0]}px, ${screen[1]}px)`;
        };
        /** What is drawn over the plan moves with it. */
        const follow = () => {
            drawOutline();
            if (ownFor) drawOwnCard(ownFor);
        };

        const offs = [
            view.placeCard.add(button),
            view.on('zoneClick', ({ id, levelId }) => {
                if (!view.placeCard.hosted()) drawOwnCard({ id, levelId });
            }),
            view.on('backgroundClick', () => drawOwnCard(null)),
            view.on('levelChange', () => drawOwnCard(null)),
            view.on('camera2dChange', follow),
            view.on('camera3dChange', follow),
            view.on('viewChange', drawOutline),
            // A reset while the camera still turns to the unit, before any Space changed.
            view.on('reset', () => {
                moves += 1;
                view.element.classList.remove('af-inner-fade');
            }),
            view.on('spaceChange', ({ inner }) => {
                if (inner) return;
                // Back on the host's own plan, by **← back** or the View's `reset`, which also ends
                // a move in or out still on its way.
                inside = null;
                moves += 1;
                view.element.classList.remove('af-inner-fade');
                view.holdMotion('innerSpace', false);
                drawBack();
                drawOutline();
            }),
        ];
        running = { enter, leave };
        return () => {
            destroyed = true;
            moves += 1;
            running = null;
            for (const off of offs) off();
            view.holdMotion('innerSpace', false);
            view.element.classList.remove('af-inner-fade');
            if (inside) view.showSpace(null, inside.levelId);
            outline.remove();
            back.remove();
            ownCard.remove();
        };
    };
    return Object.assign(plugin, {
        enter: (zoneId: string) => running?.enter(zoneId) ?? Promise.resolve(false),
        leave: () => running?.leave() ?? Promise.resolve(),
    });
}
