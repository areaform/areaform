// The place card a tap on a Zone opens, and the buttons other Plugins put on it (Inner Space,
// CONTEXT.md). The card is Wayfinding's, with **Directions**; another Plugin adds its own beside
// it, as the Inner Space Plugin adds **See inside** to a unit that has a shop's plan. One Plugin
// shows the card, the host; the others only say what goes on it, and that it changed. Any Plugin
// that draws a card draws it with `fillPlaceCard`, so they all look and close alike.
import type { Id } from '@areaform/core';

/** A Zone on its Level, as a place card shows it. */
export interface PlaceZone {
    id: Id;
    levelId: Id;
}

/** A button on the place card: its text, and what a press does once the card closes. */
export interface PlaceButton {
    label: string;
    run(): void;
}

/** What a Plugin puts on the card of `zone`: one button, or none. */
export type PlaceAction = (zone: PlaceZone) => PlaceButton | null;

export interface PlaceCard {
    /** Adds a button to the cards it names; returns how to take it away. */
    add(action: PlaceAction): () => void;
    /** The other Plugins' buttons for `zone`'s card, in the order they were added. */
    buttons(zone: PlaceZone): PlaceButton[];
    /** Tells the host what a button says may have changed, e.g. once a plan has loaded. */
    changed(): void;
    /** The Plugin that shows the card says so, to draw it again on `changed`; returns its end. */
    host(redraw: () => void): () => void;
    /** Whether a Plugin shows the card: without one, a Plugin needing it shows one of its own. */
    hosted(): boolean;
}

export function createPlaceCard(): PlaceCard {
    const actions = new Set<PlaceAction>();
    const hosts = new Set<() => void>();
    /** Has each host draw its card again. */
    const notify = () => {
        for (const redraw of hosts) redraw();
    };
    return {
        add(action) {
            actions.add(action);
            notify();
            return () => {
                actions.delete(action);
                notify();
            };
        },
        buttons: (zone) =>
            [...actions].flatMap((action) => {
                const button = action(zone);
                return button ? [button] : [];
            }),
        changed: notify,
        host(redraw) {
            // Each call's own entry, so the same function given twice is two hosts.
            const entry = () => redraw();
            hosts.add(entry);
            return () => hosts.delete(entry);
        },
        hosted: () => hosts.size > 0,
    };
}

/** A button on a card or panel over the plan: the press stays with it, not the plan under it. */
export function cardButton(text: string, onClick: () => void, className = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return b;
}

/** Fills a place card: the place's name, what goes under it, and × to close it. */
export function fillPlaceCard(
    card: HTMLElement,
    content: { title: string; body: Node[]; closeLabel: string; onClose: () => void },
): void {
    const title = document.createElement('strong');
    title.textContent = content.title;
    const close = cardButton('×', content.onClose, 'af-close');
    close.setAttribute('aria-label', content.closeLabel);
    card.replaceChildren(title, ...content.body, close);
}
