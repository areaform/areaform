// The Editor's side of Content Languages (ADR-0011): naming languages for the author, and showing
// on the plan which names the language being filled in still lacks.
import {
    offeredLanguages,
    sameLanguage,
    translationIn,
    type ContentLanguages,
} from '@areaform/core';
import type { LabelResolver } from '@areaform/render-2d';

/** Languages suggested when adding one or picking the default; any other BCP 47 tag works too. */
export const COMMON_LANGUAGES = [
    'en', 'pl', 'uk', 'ru', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'cs', 'sk', 'lt', 'lv', 'et',
    'ro', 'hu', 'bg', 'hr', 'sr', 'sl', 'el', 'tr', 'sv', 'da', 'fi', 'nb', 'ar', 'he', 'hi',
    'zh', 'ja', 'ko',
] as const; // prettier-ignore

/**
 * A language as the author reads it, in the interface language: `PL · Polish`, or `PL · polski`
 * in a Polish interface (capitalised). Just the tag where the browser cannot name it.
 */
export function languageName(tag: string, interfaceLocale: string): string {
    let name: string | undefined;
    try {
        name = new Intl.DisplayNames([interfaceLocale], { type: 'language' }).of(tag);
    } catch {
        name = undefined;
    }
    const code = tag.toUpperCase();
    if (!name || name.toLowerCase() === tag.toLowerCase()) return code;
    return `${code} · ${name[0]!.toLocaleUpperCase(interfaceLocale)}${name.slice(1)}`;
}

/** How faded a name shows on the plan while it waits for a translation. */
export const UNTRANSLATED_OPACITY = 0.4;

/**
 * The Editor's labels while the author fills in `language`: a Zone with a translation shows it,
 * one without shows its default name faded, as visitors in that language would see it but marked
 * as still to do. `host` gives logos only, as in the default language.
 */
export function fillingInResolver(
    host: LabelResolver | undefined,
    languages: ContentLanguages | undefined,
    language: string | undefined,
): LabelResolver | undefined {
    if (!languages || !language || sameLanguage(language, languages.default)) return host;
    return (zone) => {
        const logo = host?.(zone, language)?.logo;
        const translated = translationIn(zone.labels, language);
        return {
            ...(logo && { logo }),
            ...(translated ? { text: translated } : { opacity: UNTRANSLATED_OPACITY }),
        };
    };
}

/** The language being filled in: the one asked for while the Space offers it, else its default. */
export function fillingLanguage(
    languages: ContentLanguages | undefined,
    wanted: string | undefined,
): string | undefined {
    if (!languages) return undefined;
    const offered = offeredLanguages(languages);
    return (wanted && offered.find((tag) => sameLanguage(tag, wanted))) || languages.default;
}
