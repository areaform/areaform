// The Wayfinding Plugin (ADR-0017): a place card with **Directions**, Here, and the walking route
// drawn over the plan, across Levels through Connections. The navmesh code (`@areaform/wayfinding`, with Clipper2) is imported only
// when the first route is asked for, so the Plugin itself stays small.
import type { ElementRef, Vec2 } from '@areaform/core';
import type { FloorLine } from '@areaform/render-3d';
import type { NavMesh, SpaceRoute } from '@areaform/wayfinding';
import { isInside, placeOf } from '@areaform/wayfinding/place';
import { cardButton, fillPlaceCard } from '../placeCard.ts';
import type { ViewPlugin } from '../plugins.ts';
import type { View, ViewEvents } from '../view.ts';
import {
    onShopFloor,
    routePlan,
    sceneLevel as sceneLevelOf,
    shownOn,
    shownPoints as shownPointsOf,
    throughOf,
    throughPlace,
    type Through,
} from './through.ts';
import { tooltipText } from './tooltip.ts';
import {
    framed,
    levelName,
    parseHere,
    parseTo,
    rideText,
    walkSummary,
    zonePoint,
    type PlanPoint,
} from './wayfindingModel.ts';

export {
    levelName,
    parseHere,
    parseTo,
    rideText,
    walkSummary,
    zonePoint,
    type PlanPoint,
    type RideStep,
} from './wayfindingModel.ts';

export interface WayfindingOptions {
    /**
     * Where the visitor is at the start, e.g. from `?here=` on a printed QR code: a Zone's id, or
     * `<levelId>:<x>,<y>` in metres. The View opens on its Level, over the one it was given. Without
     * it, or when it names no Level or Zone of the plan or a spot outside the building, the View
     * keeps its Level and the Plugin asks when the first route is wanted.
     */
    here?: string;
    /**
     * A place to show at the start, e.g. from `?to=` on a link to one shop: a Zone's id. The View
     * opens on its Level with its card open; with Here as well, the route is drawn at once and shown
     * from its start, on Here's Level. An id that names no Zone is ignored (ADR-0028).
     */
    to?: string;
    /** How far routes keep from Walls and other things in the way, metres (default 0.3). */
    clearance?: number;
    /**
     * Start with step-free routes: only Connections marked accessible, no stairs or escalators
     * (ADR-0017, slice 3). Visitors switch it in the route panel either way.
     */
    stepFree?: boolean;
}

/**
 * The Wayfinding Plugin, with a handle for the host page: `show` opens a place as `to` does, e.g.
 * from a Kiosk's shop buttons. Give each View its own: one given to several shows on the View
 * that started it last.
 */
export interface WayfindingPlugin extends ViewPlugin {
    /**
     * Shows the Zone `zoneId` as a link with `to` does: with Here, the way to it at once, shown
     * from its start; without, its Level with its card open. False when the plan has no such
     * Zone, or the Plugin is not running yet.
     */
    show(zoneId: string): boolean;
}

/** Where a route goes, and what to call it. */
interface Target extends PlanPoint {
    title: string;
    /**
     * The unit whose shop the place is in, by its Zone id, when the shop's plan is laid into it:
     * a Through route from Here in the centre, in through the shop's entrance.
     */
    through?: string;
}

type Outcome = { kind: 'route'; route: SpaceRoute } | { kind: 'finding' } | { kind: 'none' };

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The route as an SVG path over the 2D plan. In 3D it is drawn in the scene instead. Empty until
 * the plan is on screen: a route from a link (`to`) can be found before that.
 */
function routePath(view: View, points: Vec2[]): string {
    const screen = points.map((p) => view.toScreen(p));
    if (screen.some((p) => p === null)) return '';
    return screen.map((p, i) => `${i ? 'L' : 'M'}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join('');
}

/** Dashes and gaps of the route in 3D, metres; and of the dotted way on outside. */
const DASH_3D: [number, number] = [0.8, 0.5];
const DOTS_3D: [number, number] = [0.1, 0.5];
/** How high above its point a pin is looked at to tell whether a Wall hides it, metres. */
const BEHIND_HEIGHT = 0.1;

/** The Wayfinding Plugin: `createView(container, { plugins: [wayfinding()] })`. */
export function wayfinding(options: WayfindingOptions = {}): WayfindingPlugin {
    /** The running Plugin's `show`, while it runs. */
    let shown: ((zoneId: string) => boolean) | null = null;
    const plugin: ViewPlugin = ({ view, overlay }) => {
        /** Here as the options give it: visitors stand inside the building, so one outside is asked again. */
        const startHere = (): PlanPoint | null => {
            const point = parseHere(options.here, view.getDocument());
            return point && isInside(view.getDocument(), point) ? point : null;
        };
        let here: PlanPoint | null = startHere();
        let target: Target | null = null;
        let outcome: Outcome | null = null;
        /** Waiting for the visitor to say where they are. */
        let asking = false;
        /** The last tap while asking was outside the building: say to pick a spot inside. */
        let refused = false;
        let stepFree = options.stepFree ?? false;
        /**
         * The place card: what was tapped and where; `refused` outside the building with no way
         * out, where it only says to pick a spot inside.
         */
        let card: (Target & { zoneId?: string; refused?: boolean }) | null = null;
        let destroyed = false;
        /** Units whose shop plan, laid in, the visitor went into, by the unit's Zone id. */
        const throughs = new Map<string, Through>();
        /** The unit the visitor is in, while a shop's plan laid into it is shown. */
        let inShop: Through | null = null;
        /** The Through the route's place is reached by, if any. */
        const throughFor = (place: Target | null) =>
            place?.through ? throughs.get(place.through) : undefined;
        const onShown = (levelId: string) => shownOn(inShop, levelId, view.getLevelId());
        const shownPoints = (leg: { levelId: string; points: Vec2[] }) =>
            shownPointsOf(inShop, leg);
        const sceneLevel = (levelId: string) => sceneLevelOf(inShop, levelId);
        /**
         * A place inside the shop shown, as the route goes to it: from Here in the centre when the
         * place is on the shop's ground floor; upstairs, with the shop's own Here.
         */
        const throughTarget = (place: Target): Target =>
            inShop && onShopFloor(inShop, place.levelId) ? throughPlace(inShop, place) : place;

        // --- The navmesh, built once per Level of the Document shown -------------------------

        let meshDoc = view.getDocument();
        const meshes = new Map<string, Promise<NavMesh>>();
        const library = () => import('@areaform/wayfinding');
        const meshFor = (levelId: string) => {
            if (view.getDocument() !== meshDoc) {
                meshDoc = view.getDocument();
                meshes.clear();
            }
            let mesh = meshes.get(levelId);
            if (!mesh) {
                const doc = meshDoc;
                mesh = library().then((w) =>
                    w.buildNavMesh(doc, levelId, {
                        ...(options.clearance !== undefined && { clearance: options.clearance }),
                    }),
                );
                meshes.set(levelId, mesh);
            }
            return mesh;
        };
        /**
         * The navmeshes a route between `a` and `b` may need: their Levels and every Level a
         * Connection stops on, built once each.
         */
        const meshesFor = async (a: string, b: string) => {
            const ids = new Set([a, b]);
            for (const connection of view.getDocument().connections)
                for (const stop of connection.stops) ids.add(stop.levelId);
            const built = new Map<string, NavMesh>();
            await Promise.all([...ids].map(async (id) => built.set(id, await meshFor(id))));
            return built;
        };

        // --- Elements ------------------------------------------------------------------------

        const layer = document.createElementNS(SVG, 'svg');
        layer.classList.add('af-route-layer');
        layer.setAttribute('aria-hidden', 'true');
        const casing = document.createElementNS(SVG, 'path');
        casing.classList.add('af-route-casing');
        const line = document.createElementNS(SVG, 'path');
        line.classList.add('af-route');
        /** The rest of the way to a place outside, from the door round the building. */
        const beyondCasing = document.createElementNS(SVG, 'path');
        beyondCasing.classList.add('af-route-casing', 'af-route-beyond-casing');
        const beyond = document.createElementNS(SVG, 'path');
        beyond.classList.add('af-route-beyond');
        layer.append(beyondCasing, beyond, casing, line);

        const pin = (className: string) => {
            const el = document.createElement('div');
            el.className = `af-pin ${className}`;
            el.hidden = true;
            return el;
        };
        const herePin = pin('af-pin-here');
        const hereLabel = document.createElement('span');
        herePin.append(hereLabel);
        const toPin = pin('af-pin-to');
        /** Where the route changes Level: a button to the Level it goes on to, or came from. */
        const changes = document.createElement('div');
        changes.className = 'af-route-changes';

        const placeCard = document.createElement('div');
        placeCard.className = 'af-place-card';
        placeCard.hidden = true;

        const panel = document.createElement('div');
        panel.className = 'af-route-panel';
        panel.setAttribute('role', 'status');
        panel.hidden = true;

        overlay.append(layer, changes, toPin, herePin, placeCard, panel);

        const button = cardButton;
        const t = () => view.getTranslator();

        // --- Drawing -------------------------------------------------------------------------

        const place = (el: HTMLElement, at: PlanPoint | null, fade = true) => {
            const screen = at && onShown(at.levelId) ? view.toScreen(at.point) : null;
            el.hidden = screen === null;
            if (screen) el.style.transform = `translate(${screen[0]}px, ${screen[1]}px)`;
            // In 3D, a pin behind a Wall fades, still there to tell where the place is; the place
            // card, which is read and pressed, does not.
            const scene = fade && view.getView() === '3d' ? view.renderer3d() : null;
            el.classList.toggle(
                'af-behind',
                !!(screen && scene?.isHidden(at!.point, BEHIND_HEIGHT)),
            );
        };

        /** Moves everything drawn over the plan to where the plan now is. */
        const position = () => {
            const route = outcome?.kind === 'route' ? outcome.route : null;
            place(herePin, here);
            // The destination pin stands where the route ends: at a booth's edge, not inside it;
            // outside the building, at the place itself, past the door.
            place(
                toPin,
                route ? (route.outside ?? route.to) : outcome?.kind === 'none' ? target : null,
            );
            place(placeCard, card, false);
            if (card === null) placeCard.hidden = true;
            for (const marker of changes.children as HTMLCollectionOf<HTMLElement>)
                place(marker, JSON.parse(marker.dataset.at!) as PlanPoint);
            // In 3D the route is in the scene (`drawScene`), where Walls in front of it hide it.
            const flat = view.getView() === '2d';
            const d = (flat ? (route?.legs ?? []) : [])
                .filter((leg) => onShown(leg.levelId))
                .map(shownPoints)
                .filter((points) => points.length > 1)
                .map((points) => routePath(view, points))
                .join('');
            casing.setAttribute('d', d);
            line.setAttribute('d', d);
            const outside = route?.outside;
            const on =
                flat && outside && outside.levelId === view.getLevelId()
                    ? routePath(view, [route.to.point, ...outside.way])
                    : '';
            beyondCasing.setAttribute('d', on);
            beyond.setAttribute('d', on);
            layer.style.display = d || on ? '' : 'none';
        };

        const drawCard = () => {
            if (!card) {
                placeCard.hidden = true;
                placeCard.replaceChildren();
                return;
            }
            const fill = (body: Node[]) =>
                fillPlaceCard(placeCard, {
                    title: card!.title,
                    body,
                    closeLabel: t().t('placeCard.close'),
                    onClose: () => {
                        card = null;
                        draw();
                    },
                });
            if (card.refused) {
                const note = document.createElement('p');
                note.textContent = t().t('wayfinding.pickInside');
                return fill([note]);
            }
            const go = button(
                t().t(card.zoneId ? 'wayfinding.directions' : 'wayfinding.directionsHere'),
                () => {
                    const chosen = card!;
                    card = null;
                    target = { levelId: chosen.levelId, point: chosen.point, title: chosen.title };
                    // Inside a shop laid into its unit, from Here in the centre: no need to ask.
                    if (!here && inShop?.from) target = throughTarget(target);
                    if (here || target.through) void findRoute();
                    else asking = true;
                    draw();
                },
                'af-primary',
            );
            // Other Plugins' buttons for a Zone, such as **See inside** for a unit with a shop's plan.
            const more = card.zoneId
                ? view.placeCard.buttons({ id: card.zoneId, levelId: card.levelId }).map((extra) =>
                      button(extra.label, () => {
                          card = null;
                          draw();
                          extra.run();
                      }),
                  )
                : [];
            fill([go, ...more]);
        };

        const drawPanel = () => {
            if (!asking && !target) {
                panel.hidden = true;
                panel.replaceChildren();
                return;
            }
            panel.hidden = false;
            const rows: Node[] = [];
            if (target) {
                const heading = document.createElement('strong');
                heading.textContent = t().t('wayfinding.to', { place: target.title });
                rows.push(heading);
            }
            if (asking) {
                const prompt = document.createElement('p');
                prompt.textContent = t().t('wayfinding.whereAreYou');
                rows.push(prompt);
                if (refused) {
                    const note = document.createElement('p');
                    note.className = 'af-note';
                    note.textContent = t().t('wayfinding.pickInside');
                    rows.push(note);
                }
                rows.push(zoneList());
                rows.push(
                    button(t().t('wayfinding.cancel'), () => {
                        asking = false;
                        refused = false;
                        if (!here) target = null;
                        draw();
                    }),
                );
            } else if (outcome) {
                const text = document.createElement('p');
                text.textContent =
                    outcome.kind === 'route'
                        ? walkSummary(outcome.route.length, t(), outcome.route.seconds)
                        : t().t(
                              outcome.kind === 'finding'
                                  ? 'wayfinding.finding'
                                  : stepFree
                                    ? 'wayfinding.noStepFreeRoute'
                                    : 'wayfinding.noRoute',
                          );
                rows.push(text);
                // Only a Space with Connections has steps to avoid.
                if ((throughFor(target)?.doc ?? view.getDocument()).connections.length > 0)
                    rows.push(stepFreeSwitch());
                if (outcome.kind === 'route' && (outcome.route.legs.length > 1 || target?.through))
                    rows.push(stepList(outcome.route));
                rows.push(
                    button(t().t('wayfinding.changeStart'), () => {
                        asking = true;
                        draw();
                    }),
                    button(t().t('wayfinding.clear'), () => {
                        target = null;
                        outcome = null;
                        draw();
                    }),
                );
            }
            const focused = document.activeElement === stepFreeBox;
            panel.replaceChildren(...rows);
            if (focused) stepFreeBox.focus();
        };

        const stepFreeBox = document.createElement('input');
        stepFreeBox.type = 'checkbox';
        stepFreeBox.addEventListener('change', () => {
            stepFree = stepFreeBox.checked;
            void findRoute();
        });
        const stepFreeLabel = document.createElement('label');
        stepFreeLabel.className = 'af-step-free';
        const stepFreeText = document.createElement('span');
        stepFreeLabel.append(stepFreeBox, stepFreeText);
        /** Step-free: lifts and ramps marked accessible only. */
        const stepFreeSwitch = () => {
            stepFreeBox.checked = stepFree;
            stepFreeText.textContent = t().t('wayfinding.stepFree');
            return stepFreeLabel;
        };

        /** The named Zones of the Level shown, to pick as Here. */
        const zoneList = () => {
            const select = document.createElement('select');
            select.setAttribute('aria-label', t().t('wayfinding.pickPlace'));
            const first = new Option(t().t('wayfinding.pickPlace'), '');
            first.disabled = true;
            first.selected = true;
            select.append(first);
            const doc = view.getDocument();
            const level = doc.levels.find((l) => l.id === view.getLevelId());
            const named = (level?.zones ?? [])
                .map((zone) => ({
                    zone,
                    text: titleOf({ kind: 'zone', id: zone.id, levelId: level!.id }),
                }))
                .filter((z): z is { zone: typeof z.zone; text: string } => z.text !== null)
                .sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true }));
            for (const { zone, text } of named) select.append(new Option(text, zone.id));
            select.addEventListener('change', () => {
                const zone = level?.zones.find((z) => z.id === select.value);
                if (zone && level) setHere({ levelId: level.id, point: zonePoint(zone) });
            });
            return select;
        };

        /** Shows another Level; the View tells Plugins only of the visitor's own switches. */
        const goTo = (levelId: string) => {
            view.setLevel(levelId);
            draw();
            frame();
        };

        /** Room kept clear around what is framed, pixels: the pins stand above their points. */
        const FRAME_MARGIN = 48;
        /**
         * In 2D, moves the plan so the route on the Level shown, its pins and the way on outside
         * are all in view above the route panel, which would otherwise hide the end of a route by
         * the bottom of the plan.
         */
        const frame = () => {
            const renderer = view.renderer();
            const route = outcome?.kind === 'route' ? outcome.route : null;
            if (!renderer || !route || view.getView() !== '2d') return;
            const levelId = view.getLevelId();
            const points = route.legs.filter((l) => onShown(l.levelId)).flatMap(shownPoints);
            if (here?.levelId === levelId) points.push(here.point);
            if (route.outside?.levelId === levelId) points.push(...route.outside.way);
            const box = view.element.getBoundingClientRect();
            const bottom = panel.hidden ? box.bottom : panel.getBoundingClientRect().top;
            const camera = framed(renderer.getCamera(), points, {
                left: FRAME_MARGIN,
                top: FRAME_MARGIN,
                right: box.width - FRAME_MARGIN,
                bottom: bottom - box.top - FRAME_MARGIN / 2,
            });
            if (camera) renderer.setCamera(camera);
        };

        const say = (ride: NonNullable<SpaceRoute['legs'][number]['ride']>) =>
            rideText(
                throughFor(target)?.doc ?? view.getDocument(),
                ride,
                t(),
                view.getContentLanguage(),
            );

        /** Each change of Level, in order; a step shows the Level where it starts. */
        const stepList = (route: SpaceRoute) => {
            const list = document.createElement('ol');
            list.className = 'af-route-steps';
            list.setAttribute('aria-label', t().t('wayfinding.steps'));
            const levels = new Set(view.getDocument().levels.map((l) => l.id));
            for (const leg of route.legs) {
                if (!leg.ride) continue;
                const item = document.createElement('li');
                // Inside a shop, the centre's floors are not there to show: the step is only said.
                if (levels.has(leg.levelId)) {
                    const go = button(say(leg.ride), () => goTo(leg.levelId));
                    if (leg.levelId === view.getLevelId()) go.setAttribute('aria-current', 'step');
                    item.append(go);
                } else item.textContent = say(leg.ride);
                list.append(item);
            }
            // Into the shop at the end: "Enter Volt", the step the visitor is on once inside.
            const via = throughFor(target);
            if (via) {
                const item = document.createElement('li');
                item.textContent = t().t('wayfinding.enter', { name: via.name });
                if (inShop === via) item.setAttribute('aria-current', 'step');
                list.append(item);
            }
            return list;
        };

        /** At each Connection taken: where to get on, and on the next Level where the visitor arrives. */
        const drawChanges = () => {
            const markers: HTMLElement[] = [];
            const route = outcome?.kind === 'route' ? outcome.route : null;
            const doc = view.getDocument();
            const language = view.getContentLanguage();
            route?.legs.forEach((leg, i) => {
                const next = route.legs[i + 1];
                if (!leg.ride || !next) return;
                const ride = leg.ride;
                const on = button(
                    `${ride.up ? '↑' : '↓'} ${levelName(doc, ride.toLevelId, language)}`,
                    () => goTo(ride.toLevelId),
                    'af-route-change',
                );
                on.setAttribute('aria-label', say(ride));
                on.dataset.at = JSON.stringify({ levelId: leg.levelId, point: leg.points.at(-1) });
                const off = button(
                    t().t('wayfinding.from', { level: levelName(doc, leg.levelId, language) }),
                    () => goTo(leg.levelId),
                    'af-route-change',
                );
                off.dataset.at = JSON.stringify({ levelId: next.levelId, point: next.points[0] });
                markers.push(on, off);
            });
            changes.replaceChildren(...markers);
        };

        /**
         * The route in the 3D scene, in the colours and widths the 2D one is drawn with (so a
         * host's CSS styles both): every leg, each shown with its Level.
         */
        const drawScene = () => {
            const scene = view.renderer3d();
            if (!scene) return;
            const route = outcome?.kind === 'route' ? outcome.route : null;
            const strokeOf = (el: Element) => {
                const style = getComputedStyle(el);
                return {
                    color: style.stroke,
                    width: parseFloat(style.strokeWidth) || 1,
                    opacity: parseFloat(style.strokeOpacity) || 1,
                };
            };
            const edge = { ...strokeOf(casing), opacity: 1 };
            const lines: FloorLine[] = (route?.legs ?? []).map((leg) => ({
                levelId: sceneLevel(leg.levelId),
                points: shownPoints(leg),
                ...strokeOf(line),
                dash: DASH_3D,
                casing: edge,
            }));
            if (route?.outside)
                lines.push({
                    levelId: route.outside.levelId,
                    points: [route.to.point, ...route.outside.way],
                    ...strokeOf(beyond),
                    dash: DOTS_3D,
                    casing: { ...strokeOf(beyondCasing), opacity: 1 },
                });
            scene.setLines(lines);
        };

        const draw = () => {
            hereLabel.textContent = t().t('wayfinding.youAreHere');
            drawChanges();
            drawCard();
            drawPanel();
            position();
            drawScene();
            // A card, a route or a question being read: the camera does not fly off on its own.
            view.holdMotion('wayfinding', card !== null || outcome !== null || asking);
        };

        // --- Routes --------------------------------------------------------------------------

        let asked = 0;
        const findRoute = async () => {
            // A Here picked inside the shop: the route stays in the shop's own plan.
            let via = throughFor(target);
            if (via && target && here && here.levelId === via.shopLevelId) {
                target = { levelId: via.shopLevelId, point: target.point, title: target.title };
                via = undefined;
            }
            // Into a shop laid into its unit: from Here in the centre, on the plan with the shop in.
            const from = via ? (here ?? via.from) : here;
            if (!from || !target) return;
            const ask = ++asked;
            outcome = { kind: 'finding' };
            draw();
            const to = target;
            const doc = via ? routePlan(via, view.getHomeDocument()) : view.getDocument();
            const [meshes, w] = await Promise.all([
                via ? new Map<string, NavMesh>() : meshesFor(from.levelId, to.levelId),
                library(),
            ]);
            if (destroyed || ask !== asked) return;
            const meshOf = (id: string) => {
                const kept = meshes.get(id) ?? via?.meshes.get(id);
                if (kept) return kept;
                const built = w.buildNavMesh(doc, id, {
                    ...(options.clearance !== undefined && { clearance: options.clearance }),
                });
                via?.meshes.set(id, built);
                return built;
            };
            const route = w.findSpaceRoute(doc, from, to, meshOf, { stepFree });
            outcome = route ? { kind: 'route', route } : { kind: 'none' };
            // A route over several Levels is shown from its start, unless the visitor is inside a
            // shop, where only the shop's floor is there to show.
            const start = route?.legs[0]?.levelId;
            if (!inShop && start && start !== view.getLevelId()) view.setLevel(start);
            draw();
            frame();
        };

        const setHere = (point: PlanPoint) => {
            here = point;
            asking = false;
            refused = false;
            if (target) void findRoute();
            else draw();
        };

        // --- Taps on the plan ----------------------------------------------------------------

        const titleOf = (ref: ElementRef) =>
            tooltipText(view.getDocument(), ref, t(), view.getContentLanguage())?.title ?? null;

        const tapped = (ref: ElementRef | null, point: Vec2) => {
            const levelId = view.getLevelId();
            const zone =
                ref?.kind === 'zone'
                    ? view
                          .getDocument()
                          .levels.find((l) => l.id === levelId)
                          ?.zones.find((z) => z.id === ref.id)
                    : undefined;
            if (asking) {
                if (zone) return setHere({ levelId, point: zonePoint(zone) });
                // Here is where the visitor stands: inside the building.
                refused = !isInside(view.getDocument(), { levelId, point });
                return refused ? draw() : setHere({ levelId, point });
            }
            // A tap elsewhere while the card is open only closes it.
            if (card && !zone) {
                card = null;
                return draw();
            }
            card = zone
                ? {
                      levelId,
                      point: zonePoint(zone),
                      title:
                          titleOf({ kind: 'zone', id: zone.id, levelId }) ??
                          t().t('wayfinding.thisSpot'),
                      zoneId: zone.id,
                  }
                : placeOf(view.getDocument(), { levelId, point }).kind === 'nowhere'
                  ? // Outside, with no way out drawn: no route could reach it.
                    {
                        levelId,
                        point,
                        title: t().t('wayfinding.thisSpot'),
                        refused: true,
                    }
                  : { levelId, point, title: t().t('wayfinding.thisSpot') };
            draw();
        };

        const offs = [
            view.on('elementClick', ({ ref, point }) => tapped(ref, point)),
            view.on('backgroundClick', ({ point }) => tapped(null, point)),
            view.on('camera2dChange', position),
            view.on('camera3dChange', position),
            view.on('ready3d', () => {
                drawScene();
                position();
            }),
            view.on('viewChange', position),
            view.on('levelChange', () => {
                card = null;
                draw();
                frame();
            }),
        ];
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || (!card && !asking)) return;
            card = null;
            if (asking) {
                asking = false;
                refused = false;
                if (!here) target = null;
            }
            draw();
        };
        view.element.addEventListener('keydown', onKey);
        // A 3D View that changes size moves the plan on screen without a camera change.
        const resized = new ResizeObserver(() => position());
        resized.observe(overlay);

        /** No route, card or question: what a new place, or a reset, starts from. */
        const forget = () => {
            target = null;
            outcome = null;
            card = null;
            asking = false;
            refused = false;
        };

        /** Opens the place `zoneId` names, as a link with `to` does; false when there is none. */
        const show = (zoneId: string | undefined) => {
            const opened = parseTo(zoneId, view.getDocument());
            if (!opened) return false;
            const { levelId, zone } = opened;
            const title =
                titleOf({ kind: 'zone', id: zone.id, levelId }) ?? t().t('wayfinding.thisSpot');
            forget();
            if (!here && inShop?.from) {
                // A department, from Here in the centre: in through the shop's entrance.
                target = throughTarget({ levelId, point: zonePoint(zone), title });
                void findRoute();
            } else if (here) {
                // A link to one shop from a known spot: the route at once, shown from its start.
                target = { levelId, point: zonePoint(zone), title };
                void findRoute();
            } else {
                view.setLevel(levelId);
                card = { levelId, point: zonePoint(zone), title, zoneId: zone.id };
                draw();
            }
            return true;
        };

        /** How the Plugin opens, and goes back to on the View's `reset`. */
        const begin = () => {
            here = startHere();
            forget();
            stepFree = options.stepFree ?? false;
            // A route still being found is for the visitor before.
            asked += 1;
            // Opened from a QR code on another floor: show the floor the visitor stands on.
            if (here) view.setLevel(here.levelId);
            if (!show(options.to)) draw();
        };
        /**
         * What each Space shown had, by its id: inside a shop's plan the visitor has no Here or
         * route of the centre's, and back out they have them again (Inner Space, CONTEXT.md).
         */
        const spaces = new Map<string, { here: PlanPoint | null; target: Target | null }>();
        let spaceId = view.getDocument().id;
        const changeSpace = ({ doc, unit }: ViewEvents['spaceChange']) => {
            // A route into a shop goes on in the centre once the visitor comes back out.
            const carried = target?.through ? target : null;
            spaces.set(spaceId, { here, target });
            const homeHere = spaces.get(view.getHomeDocument().id)?.here ?? null;
            spaceId = doc.id;
            const kept = spaces.get(spaceId);
            forget();
            asked += 1;
            // Inside a shop laid into its unit, a Through route can go in from the centre.
            inShop = unit
                ? throughOf(
                      view.getHomeDocument(),
                      unit,
                      doc,
                      view.getLevelId(),
                      homeHere,
                      view.getContentLanguage(),
                  )
                : null;
            if (inShop) throughs.set(unit!.zoneId, inShop);
            here = kept?.here ?? null;
            target = (doc.id === view.getHomeDocument().id && carried) || (kept?.target ?? null);
            if (target && (here || target.through)) void findRoute();
            else draw();
        };
        offs.push(
            view.on('reset', () => {
                spaces.clear();
                throughs.clear();
                spaceId = view.getDocument().id;
                begin();
            }),
            view.on('spaceChange', changeSpace),
            // The card is this Plugin's: others' buttons go on it, drawn again when they change.
            view.placeCard.host(() => {
                if (card) draw();
            }),
        );
        begin();
        shown = (zoneId) => !destroyed && show(zoneId);
        return () => {
            destroyed = true;
            shown = null;
            view.holdMotion('wayfinding', false);
            for (const off of offs) off();
            view.renderer3d()?.setLines([]);
            view.element.removeEventListener('keydown', onKey);
            resized.disconnect();
            layer.remove();
            herePin.remove();
            toPin.remove();
            changes.remove();
            placeCard.remove();
            panel.remove();
        };
    };
    return Object.assign(plugin, { show: (zoneId: string) => shown?.(zoneId) ?? false });
}
