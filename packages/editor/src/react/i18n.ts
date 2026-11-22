import { createContext, useContext, useMemo } from 'react';
import { createTranslator, english, type Messages, type Translator } from '../i18n/index.ts';

/** The interface language inside the components; English when nothing provides one. */
export const I18nContext = createContext<Translator>(english);

export const useI18n = () => useContext(I18nContext);

/** The language props every component takes. */
export interface LocaleProps {
    /**
     * The interface language as a BCP 47 tag: `en` (default), `pl`, `uk`, `ru`, or any other with
     * `messages`. Unrelated to the language of the Space's own labels.
     */
    locale?: string;
    /** Messages laid over the built-in ones: change any text, or translate into another language. */
    messages?: Partial<Messages>;
}

/** The translator for the props: the surrounding one when a component sets neither. */
export function useTranslator({
    locale,
    messages,
}: {
    locale: string | undefined;
    messages: Partial<Messages> | undefined;
}): Translator {
    const outer = useI18n();
    return useMemo(
        () =>
            locale === undefined && messages === undefined
                ? outer
                : createTranslator(locale ?? outer.locale, messages),
        [outer, locale, messages],
    );
}
