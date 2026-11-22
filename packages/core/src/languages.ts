// Content Languages (ADR-0011): which languages a Space offers, and which of an Element's texts a
// visitor in a given language sees.
import type { TextTarget } from './commands/texts.ts';
import type { AreaformDocument, ContentLanguages, Translations } from './model.ts';

/**
 * Whether a string is shaped like a BCP 47 language tag: a 2–3 letter language, then subtags of
 * 2–8 letters or digits (`pl`, `pt-BR`, `zh-Hant-TW`). It does not check the registry.
 */
export function isLanguageTag(tag: string): boolean {
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag);
}

/** Tags name the same language regardless of case (`pt-BR` and `pt-br`). */
export function sameLanguage(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/** Every language a Space offers, the default first; none when its default is unknown. */
export function offeredLanguages(languages: ContentLanguages | undefined): string[] {
    return languages ? [languages.default, ...(languages.others ?? [])] : [];
}

/** Whether a Space offers a language, its default included. */
export function offersLanguage(languages: ContentLanguages | undefined, tag: string): boolean {
    return offeredLanguages(languages).some((offered) => sameLanguage(offered, tag));
}

const base = (tag: string) => tag.split('-')[0]!.toLowerCase();

/**
 * The offered language that best serves a visitor asking for `wanted`: the same tag, else the
 * same language without a region or script (`pl-PL` finds `pl`), else the first offered with
 * the same base (`pt` finds `pt-BR`). Undefined when nothing matches or the default is unknown.
 */
export function matchLanguage(
    languages: ContentLanguages | undefined,
    wanted: string | undefined,
): string | undefined {
    if (!wanted) return undefined;
    const offered = offeredLanguages(languages);
    return (
        offered.find((tag) => sameLanguage(tag, wanted)) ??
        offered.find((tag) => sameLanguage(tag, base(wanted))) ??
        offered.find((tag) => base(tag) === base(wanted))
    );
}

/**
 * The text a visitor asking for `wanted` sees: the translation in the best matching offered
 * language, else `text` (the default language's). Translations in a language the Space does not
 * offer are hidden and never shown.
 */
export function textIn(
    text: string | undefined,
    translations: Translations | undefined,
    languages: ContentLanguages | undefined,
    wanted: string | undefined,
): string | undefined {
    const language = matchLanguage(languages, wanted);
    if (!language || sameLanguage(language, languages!.default)) return text;
    return translationIn(translations, language) ?? text;
}

/** Whether `others` is well formed: valid tags, none twice, the default not among them. */
export function validLanguages(languages: ContentLanguages): boolean {
    const all = offeredLanguages(languages);
    return (
        all.every(isLanguageTag) && new Set(all.map((tag) => tag.toLowerCase())).size === all.length
    );
}

/** The translation in `language`, under any case of its tag; undefined when missing or empty. */
export function translationIn(
    translations: Translations | undefined,
    language: string,
): string | undefined {
    const key = Object.keys(translations ?? {}).find((k) => sameLanguage(k, language));
    return (key !== undefined && translations![key]) || undefined;
}

/**
 * The texts with something to translate (a non-empty label or name in the default language)
 * but no translation in `language`: the Space's name, then each Level's, then each Connection's,
 * then each Level's Zones. None for the default language or one the Space does not offer.
 */
export function missingTexts(doc: AreaformDocument, language: string): TextTarget[] {
    const { languages } = doc;
    if (
        !languages ||
        sameLanguage(language, languages.default) ||
        !offersLanguage(languages, language)
    )
        return [];
    const missing = (text: string | undefined, translations: Translations | undefined) =>
        !!text && !translationIn(translations, language);
    const targets: TextTarget[] = [];
    if (missing(doc.name, doc.names)) targets.push({ kind: 'space' });
    for (const level of doc.levels)
        if (missing(level.name, level.names)) targets.push({ kind: 'level', levelId: level.id });
    for (const connection of doc.connections)
        if (missing(connection.name, connection.names))
            targets.push({ kind: 'connection', connectionId: connection.id });
    for (const level of doc.levels)
        for (const zone of level.zones)
            if (missing(zone.label, zone.labels))
                targets.push({ kind: 'zone', levelId: level.id, zoneId: zone.id });
    return targets;
}
