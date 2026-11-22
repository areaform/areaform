// The interface language: a dictionary per locale in the i18next JSON v4 shape (flat keys,
// `{{name}}` placeholders, `_one` / `_few` / `_many` / `_other` plural suffixes), read by a small
// translator so the View stays light. Generic over its dictionary: the View's has the texts
// visitors see, and the Editor lays its own over them (ADR-0012). Content Languages are a separate
// matter.

import { en } from './messages/en.ts';
import { pl } from './messages/pl.ts';
import { ru } from './messages/ru.ts';
import { uk } from './messages/uk.ts';

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type BaseOf<K> = K extends `${infer B}_${PluralCategory}` ? B : K;
type PluralBase<E> = { [K in keyof E]: K extends `${infer B}_other` ? B : never }[keyof E];

/** The View's English dictionary: the source of its keys and their placeholders. */
export type ViewEnglish = typeof en;

/** A key of the dictionary `E` (the View's by default); plural keys without their suffix. */
export type MessageKey<E = ViewEnglish> = BaseOf<keyof E & string>;

/**
 * A complete dictionary for one locale, with the keys of `E`. A plural message needs its `_other`
 * form and whichever other forms the language uses (`_one` in English, `_one` / `_few` / `_many`
 * in Polish).
 */
export type Messages<E = ViewEnglish> = {
    [K in Exclude<MessageKey<E>, PluralBase<E>>]: string;
} & {
    [K in PluralBase<E> & string as `${K}_other`]: string;
} & { [K in PluralBase<E> & string as `${K}_${Exclude<PluralCategory, 'other'>}`]?: string };

type Placeholders<S> = S extends `${string}{{${infer P}}}${infer Rest}`
    ? P | Placeholders<Rest>
    : never;
type Template<E, K> = K extends PluralBase<E> ? E[`${K & string}_other` & keyof E] : E[K & keyof E];
type Params<E, K> =
    K extends PluralBase<E>
        ? { count: number } & Record<
              Exclude<Placeholders<Template<E, K>>, 'count'>,
              string | number
          >
        : Placeholders<Template<E, K>> extends never
          ? never
          : Record<Placeholders<Template<E, K>>, string | number>;

/** The arguments `t` takes after the key: the placeholders' values, when the message has any. */
export type MessageArgs<K extends MessageKey<E>, E = ViewEnglish> = [Params<E, K>] extends [never]
    ? []
    : [Params<E, K>];

/** A key whose message takes no values, so it can be passed around and shown with `t(key)`. */
export type PlainMessageKey<E = ViewEnglish> = {
    [K in MessageKey<E>]: MessageArgs<K, E> extends [] ? K : never;
}[MessageKey<E>];

/** The locales with a built-in dictionary. Polish, Ukrainian and Russian are awaiting review. */
export const LOCALES = ['en', 'pl', 'uk', 'ru'] as const;

export type BuiltInLocale = (typeof LOCALES)[number];

/** How each built-in locale is named in a language switcher, in its own language. */
export const LOCALE_NAMES: Record<BuiltInLocale, string> = {
    en: 'EN · English',
    pl: 'PL · Polski',
    uk: 'UA · Українська',
    ru: 'RU · Русский',
};

export interface Translator<E = ViewEnglish> {
    /** The BCP 47 tag it was made for, e.g. `pl` or `pl-PL`. */
    readonly locale: string;
    t<K extends MessageKey<E>>(key: K, ...args: MessageArgs<K, E>): string;
    /** A message looked up by a key built at runtime (a Preset's category), or undefined. */
    lookup(key: string): string | undefined;
    /** A number with exactly `digits` decimals and no grouping: `4.50`, or `4,50` in Polish. */
    fixed(value: number, digits: number): string;
    /** A whole number with the locale's grouping: `1,033`, or `1 033` in Polish. */
    whole(value: number): string;
}

/** The View's built-in dictionaries, for a package that lays its own over them. */
export const VIEW_DICTIONARIES: Record<BuiltInLocale, Messages> = { en, pl, uk, ru };

/**
 * A `createTranslator` for a set of dictionaries: each locale's laid over the English one, so a
 * missing message falls back to English.
 */
export function translatorFor<E>(dictionaries: Record<BuiltInLocale, Messages<E>>) {
    const english = dictionaries.en as Record<string, string | undefined>;
    /**
     * A translator for `locale`, with `overrides` laid over the built-in dictionary: change any
     * message, or bring a whole dictionary for a locale without a built-in one.
     */
    return (locale = 'en', overrides?: Partial<Messages<E>>): Translator<E> => {
        const language = locale.toLowerCase().split('-')[0] as BuiltInLocale;
        const messages: Record<string, string | undefined> = {
            ...english,
            ...(dictionaries[language] as Record<string, string | undefined> | undefined),
            ...(overrides as Record<string, string | undefined> | undefined),
        };
        let plurals: Intl.PluralRules;
        try {
            plurals = new Intl.PluralRules(locale);
        } catch {
            plurals = new Intl.PluralRules('en'); // not a valid tag
        }
        const tag = plurals.resolvedOptions().locale;
        const fixedFormats = new Map<number, Intl.NumberFormat>();
        const wholeFormat = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });

        const fill = (template: string, params: Record<string, string | number> | undefined) =>
            params
                ? template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
                      name in params ? String(params[name]) : match,
                  )
                : template;

        return {
            locale,
            t(key, ...args) {
                const values = args[0] as Record<string, string | number> | undefined;
                const count = values?.count;
                const template =
                    typeof count === 'number'
                        ? (messages[`${key}_${plurals.select(count)}`] ?? messages[`${key}_other`])
                        : messages[key];
                return fill(template ?? key, values);
            },
            lookup: (key) => messages[key],
            fixed(value, digits) {
                let format = fixedFormats.get(digits);
                if (!format) {
                    format = new Intl.NumberFormat(tag, {
                        minimumFractionDigits: digits,
                        maximumFractionDigits: digits,
                        useGrouping: false,
                    });
                    fixedFormats.set(digits, format);
                }
                return format.format(value);
            },
            whole: (value) => wholeFormat.format(value),
        };
    };
}

/** A translator for the View's texts in `locale`, with `overrides` laid over them. */
export const createTranslator = translatorFor<ViewEnglish>(VIEW_DICTIONARIES);

/** The English translator, for callers that do not pass one. */
export const english: Translator = createTranslator('en');

/** A Zone Category's name: the built-in translation for its id, else the Preset's `label`. */
export const categoryLabel = (i18n: Translator<unknown>, id: string, fallback: string) =>
    i18n.lookup(`category.${id}`) ?? fallback;
