// The tooltip card (ADR-0012), the first Plugin: the hovered Element's name, in the visitor's
// Content Language, and what kind of place it is, beside the pointer.
import { textIn, type AreaformDocument, type ElementRef } from '@areaform/core';
import { categoryLabel, type Translator } from '../i18n/translator.ts';
import type { ViewPlugin } from '../plugins.ts';
import type { View } from '../view.ts';

/** What a tooltip card says: a name, and what kind of place or thing it is. */
export interface TooltipText {
    title: string;
    detail?: string;
}

export interface TooltipOptions {
    /**
     * What the card shows for an Element: text, or an element of your own; `null` shows no card.
     * `undefined` falls back to the built-in text (`tooltipText`).
     */
    content?: (hover: { ref: ElementRef; view: View }) => string | Node | null | undefined;
}

/** Room between the pointer and the card, CSS pixels. */
const OFFSET = 14;

/** The tooltip card Plugin: `createView(container, { plugins: [tooltip()] })`. */
export function tooltip(options: TooltipOptions = {}): ViewPlugin {
    return ({ view, overlay }) => {
        const card = document.createElement('div');
        card.className = 'af-tooltip';
        card.setAttribute('role', 'tooltip');
        card.hidden = true;
        overlay.append(card);

        const place = (x: number, y: number) => {
            const room = overlay.getBoundingClientRect();
            const { width, height } = card.getBoundingClientRect();
            // Below and right of the pointer, flipped to stay inside the View.
            const left = x + OFFSET + width > room.width ? x - OFFSET - width : x + OFFSET;
            const top = y + OFFSET + height > room.height ? y - OFFSET - height : y + OFFSET;
            card.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`;
        };
        const hide = () => {
            card.hidden = true;
            card.replaceChildren();
        };
        const offHover = view.on('elementHover', ({ ref, screen }) => {
            const content = ref && contentFor(ref, view, options);
            if (!content) return hide();
            card.replaceChildren(content);
            card.hidden = false;
            place(screen[0], screen[1]);
        });
        // Hover reports a new Element only; the card follows the pointer in between.
        const follow = (e: PointerEvent) => {
            if (card.hidden) return;
            const room = overlay.getBoundingClientRect();
            place(e.clientX - room.left, e.clientY - room.top);
        };
        view.element.addEventListener('pointermove', follow);
        view.element.addEventListener('pointerleave', hide);
        const offView = view.on('viewChange', hide);
        return () => {
            offHover();
            offView();
            view.element.removeEventListener('pointermove', follow);
            view.element.removeEventListener('pointerleave', hide);
            card.remove();
        };
    };
}

function contentFor(ref: ElementRef, view: View, options: TooltipOptions): Node | null {
    const own = options.content?.({ ref, view });
    if (own === null) return null;
    if (own instanceof Node) return own;
    if (typeof own === 'string') return document.createTextNode(own);
    const text = tooltipText(
        view.getDocument(),
        ref,
        view.getTranslator(),
        view.getContentLanguage(),
    );
    if (!text) return null;
    const fragment = document.createDocumentFragment();
    const title = document.createElement('strong');
    title.textContent = text.title;
    fragment.append(title);
    if (text.detail) {
        const detail = document.createElement('span');
        detail.textContent = text.detail;
        fragment.append(detail);
    }
    return fragment;
}

const capitalised = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * The built-in card for an Element: a Zone's name in `language` and its category; a Connection's
 * name and kind; an Obstacle's or Opening's kind. Null for Elements without anything to say.
 */
export function tooltipText(
    doc: AreaformDocument,
    ref: ElementRef,
    i18n: Translator,
    language?: string,
): TooltipText | null {
    if (ref.kind === 'stop' || ref.kind === 'connection') {
        const connection = doc.connections.find((c) => c.id === ref.id);
        if (!connection) return null;
        const kind = capitalised(i18n.t(`connectionKind.${connection.kind}`));
        const name = textIn(connection.name, connection.names, doc.languages, language);
        return name ? { title: name, detail: kind } : { title: kind };
    }
    if (!('levelId' in ref)) return null;
    const level = doc.levels.find((l) => l.id === ref.levelId);
    if (ref.kind === 'zone') {
        const zone = level?.zones.find((z) => z.id === ref.id);
        if (!zone) return null;
        const name = textIn(zone.label, zone.labels, doc.languages, language);
        const category =
            zone.category !== undefined
                ? capitalised(categoryLabel(i18n, zone.category, zone.category))
                : undefined;
        if (!name) return category ? { title: category } : null;
        // A café named "Café" needs no second line saying so.
        const repeats = category?.toLocaleLowerCase() === name.toLocaleLowerCase();
        return category && !repeats ? { title: name, detail: category } : { title: name };
    }
    if (ref.kind === 'obstacle') {
        const obstacle = level?.obstacles.find((o) => o.id === ref.id);
        return obstacle ? { title: capitalised(i18n.t(`obstacleKind.${obstacle.kind}`)) } : null;
    }
    if (ref.kind === 'opening') {
        const opening = level?.openings.find((o) => o.id === ref.id);
        return opening ? { title: capitalised(i18n.t(`openingKind.${opening.kind}`)) } : null;
    }
    return null;
}
