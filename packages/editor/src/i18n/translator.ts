// The Editor's interface language: its own texts laid over the View's (ADR-0012), read by the
// View's translator. Content Languages are a separate matter.

import {
    translatorFor,
    VIEW_DICTIONARIES,
    type BuiltInLocale,
    type MessageArgs as ViewMessageArgs,
    type MessageKey as ViewMessageKey,
    type Messages as ViewMessages,
    type PlainMessageKey as ViewPlainMessageKey,
    type Translator as ViewTranslator,
    type ViewEnglish,
} from '@areaform/view';
import { en } from './messages/en.ts';
import { pl } from './messages/pl.ts';
import { ru } from './messages/ru.ts';
import { uk } from './messages/uk.ts';

/** The Editor's own English texts, the source of its keys. */
export type EditorEnglish = typeof en;
/** Every English text the Editor shows: the View's and its own. */
export type English = ViewEnglish & EditorEnglish;

/** A key of the Editor's dictionary, the View's included; plural keys without their suffix. */
export type MessageKey = ViewMessageKey<English>;
/** A complete dictionary for one locale: the View's texts and the Editor's. */
export type Messages = ViewMessages<English>;
/** The Editor's own texts for one locale, laid over the View's. */
export type EditorMessages = ViewMessages<EditorEnglish>;
export type MessageArgs<K extends MessageKey> = ViewMessageArgs<K, English>;
export type PlainMessageKey = ViewPlainMessageKey<English>;
export type Translator = ViewTranslator<English>;

const OWN: Record<BuiltInLocale, EditorMessages> = { en, pl, uk, ru };
const DICTIONARIES = Object.fromEntries(
    Object.entries(OWN).map(([locale, own]) => [
        locale,
        { ...VIEW_DICTIONARIES[locale as BuiltInLocale], ...own },
    ]),
) as Record<BuiltInLocale, Messages>;

/**
 * A translator for `locale`, with `overrides` laid over the built-in dictionary: change any
 * message, or bring a whole dictionary for a locale without a built-in one. Missing messages fall
 * back to English.
 */
export const createTranslator = translatorFor<English>(DICTIONARIES);

/** The English translator, for callers that do not pass one. */
export const english: Translator = createTranslator('en');

/** A Space Kind's name: the built-in translation for its id, else the Preset's own `label`. */
export const kindLabel = (i18n: Translator, kind: string, fallback: string) =>
    i18n.lookup(`preset.${kind}`) ?? fallback;

export { categoryLabel, LOCALE_NAMES, LOCALES, type BuiltInLocale } from '@areaform/view';
