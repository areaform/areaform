// The visitor's way between Levels, in the plan's top-left corner: names stacked like lift
// buttons, the top floor first, folded into one button on a narrow View.
import { textIn, type AreaformDocument, type Id, type Level } from '@areaform/core';
import type { Translator } from './i18n/translator.ts';
import { CHOOSES_VIEW } from './motion.ts';

export interface LevelSwitcher {
    readonly element: HTMLElement;
    /** Draws the list again, for a new Document, Level, language or translator. */
    update(state: LevelSwitcherState): void;
}

export interface LevelSwitcherState {
    doc: AreaformDocument;
    levelId: Id;
    /** The Content Language the names are shown in. */
    language: string | undefined;
    i18n: Translator;
}

/**
 * The Level a visitor sees first: the one at elevation 0 (the ground floor), else the lowest.
 * With Level Groups, the first such Level in the Document's order.
 */
export function startingLevel(doc: AreaformDocument): Level {
    const ground = doc.levels.find((l) => l.elevation === 0);
    if (ground) return ground;
    return doc.levels.reduce((low, l) => (l.elevation < low.elevation ? l : low));
}

/** Levels in groups, top floor first; one unnamed group when the plan has no Level Groups. */
export function groupsOf(
    doc: AreaformDocument,
    other: string,
): { name?: string; levels: Level[] }[] {
    const topDown = (levels: Level[]) => [...levels].sort((a, b) => b.ordinal - a.ordinal);
    if (!doc.levels.some((l) => l.group !== undefined)) return [{ levels: topDown(doc.levels) }];
    const names = [...new Set(doc.levels.flatMap((l) => (l.group === undefined ? [] : [l.group])))];
    const groups: { name?: string; levels: Level[] }[] = names.sort().map((name) => ({
        name,
        levels: topDown(doc.levels.filter((l) => l.group === name)),
    }));
    const ungrouped = doc.levels.filter((l) => l.group === undefined);
    if (ungrouped.length) groups.push({ name: other, levels: topDown(ungrouped) });
    return groups;
}

/** Hidden while the plan has one Level; `onSelect` gets the Level a visitor picks. */
export function createLevelSwitcher(
    onSelect: (levelId: Id) => void,
    initial: LevelSwitcherState,
): LevelSwitcher {
    const element = document.createElement('nav');
    element.className = 'af-level-switcher';
    element.setAttribute(CHOOSES_VIEW, '');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'af-button af-level-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'af-level-list';
    element.append(toggle, list);

    // The toggle only shows on a narrow View (see styles.css); on a wide one the list is always open.
    const setOpen = (open: boolean) => {
        element.classList.toggle('af-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!element.classList.contains('af-open')));

    const update = ({ doc, levelId, language, i18n }: LevelSwitcherState) => {
        element.hidden = doc.levels.length < 2;
        element.setAttribute('aria-label', i18n.t('levelSwitcher.label'));
        toggle.setAttribute('aria-label', i18n.t('levelSwitcher.choose'));
        const name = (l: Level) => textIn(l.name, l.names, doc.languages, language) ?? l.name;
        const current = doc.levels.find((l) => l.id === levelId);
        toggle.textContent = `${current ? name(current) : ''} ▾`;

        list.replaceChildren(
            ...groupsOf(doc, i18n.t('levelSwitcher.other')).map((group) => {
                const box = document.createElement('div');
                box.setAttribute('role', 'group');
                if (group.name !== undefined) {
                    box.setAttribute('aria-label', group.name);
                    const heading = document.createElement('div');
                    heading.className = 'af-level-group';
                    heading.textContent = group.name;
                    box.append(heading);
                }
                for (const level of group.levels) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'af-button af-level-button';
                    button.textContent = name(level);
                    button.setAttribute('aria-pressed', String(level.id === levelId));
                    button.addEventListener('click', () => {
                        setOpen(false);
                        onSelect(level.id);
                    });
                    box.append(button);
                }
                return box;
            }),
        );
    };
    update(initial);
    return { element, update };
}
