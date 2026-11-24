import { Rejection } from '../checks/invariants.ts';
import { offersLanguage, sameLanguage, translationIn } from '../languages.ts';
import type { AreaformDocument, ContentLanguages, Id, Translations } from '../model.ts';
import { requireElement, updateElement, updateLevel } from './shared.ts';

/** Whose text a `text.set` changes: a Zone's label, or a Level's, Connection's or the Space's name. */
export type TextTarget =
    | { kind: 'space' }
    | { kind: 'level'; levelId: Id }
    | { kind: 'connection'; connectionId: Id }
    | { kind: 'zone'; levelId: Id; zoneId: Id };

/**
 * Sets one text in one Content Language (ADR-0011). In the default language it is the `label`
 * or `name` itself; in another offered language it is the translation beside it. An empty or
 * absent `text` removes a translation, or a Zone's label or a Connection's name; a Level and the
 * Space always keep a name in the default language. Rejected for a language the Space does not
 * offer, so the default must be known before the first translation.
 */
export interface TextSet {
    type: 'text.set';
    target: TextTarget;
    language: string;
    text?: string | undefined;
}

export type TextCommand = TextSet;

export function applyTextCommand(doc: AreaformDocument, command: TextSet): AreaformDocument {
    const { target, language } = command;
    const text = command.text || undefined;
    if (!offersLanguage(doc.languages, language)) {
        throw new Rejection([{ code: 'unknown-language', language }]);
    }
    const languages = doc.languages!;
    // The same text again changes nothing, so no empty undo step appears.
    if (currentText(doc, target, languages, language) === text) return doc;
    switch (target.kind) {
        case 'space':
            return withText(doc, 'name', 'names', doc.id, languages, language, text, true);
        case 'level':
            return updateLevel(doc, target.levelId, (level) =>
                withText(level, 'name', 'names', level.id, languages, language, text, true),
            );
        case 'connection': {
            requireElement(doc.connections, target.connectionId);
            return {
                ...doc,
                connections: doc.connections.map((c) =>
                    c.id === target.connectionId
                        ? withText(c, 'name', 'names', c.id, languages, language, text, false)
                        : c,
                ),
            };
        }
        case 'zone':
            return updateElement(doc, target.levelId, 'zones', target.zoneId, (zone) =>
                withText(zone, 'label', 'labels', zone.id, languages, language, text, false),
            );
    }
}

/** What the target's text in `language` is now; rejects a target that does not exist. */
function currentText(
    doc: AreaformDocument,
    target: TextTarget,
    languages: ContentLanguages,
    language: string,
): string | undefined {
    let text: string | undefined;
    let translations: Translations | undefined;
    if (target.kind === 'space') {
        ({ name: text, names: translations } = doc);
    } else if (target.kind === 'connection') {
        requireElement(doc.connections, target.connectionId);
        ({ name: text, names: translations } = doc.connections.find(
            (c) => c.id === target.connectionId,
        )!);
    } else {
        const level = doc.levels.find((l) => l.id === target.levelId);
        if (!level) throw new Rejection([{ code: 'unknown-level', levelId: target.levelId }]);
        if (target.kind === 'level') {
            ({ name: text, names: translations } = level);
        } else {
            requireElement(level.zones, target.zoneId);
            ({ label: text, labels: translations } = level.zones.find(
                (z) => z.id === target.zoneId,
            )!);
        }
    }
    if (sameLanguage(language, languages.default)) return text || undefined;
    return translationIn(translations, language);
}

/**
 * `element` with its text in `language` set to `text`: the field itself in the default language,
 * else the entry in the translations map, which is dropped when it empties. The same object when
 * nothing changes, so no empty undo step appears.
 */
function withText<T extends object>(
    element: T,
    field: 'label' | 'name',
    mapField: 'labels' | 'names',
    id: Id,
    languages: ContentLanguages,
    language: string,
    text: string | undefined,
    required: boolean,
): T {
    const record = element as Record<string, unknown>;
    if (sameLanguage(language, languages.default)) {
        if (text === undefined && required) throw new Rejection([{ code: 'required-text', id }]);
        if (record[field] === text) return element;
        const next = { ...record };
        if (text === undefined) delete next[field];
        else next[field] = text;
        return next as T;
    }
    const map = (record[mapField] as Translations | undefined) ?? {};
    // Stored under the tag as the Space offers it, whatever case it was asked in.
    const key =
        Object.keys(map).find((k) => sameLanguage(k, language)) ??
        languages.others!.find((tag) => sameLanguage(tag, language))!;
    if (map[key] === text) return element;
    const nextMap = { ...map };
    if (text === undefined) delete nextMap[key];
    else nextMap[key] = text;
    const next = { ...record, [mapField]: nextMap };
    if (Object.keys(nextMap).length === 0) delete next[mapField];
    return next as T;
}
