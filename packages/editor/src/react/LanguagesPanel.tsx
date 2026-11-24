// The sidebar's Languages section (ADR-0011): which Content Language the author is filling in,
// with what each still lacks, and the Space's own languages.
import {
    isLanguageTag,
    missingTexts,
    offersLanguage,
    sameLanguage,
    translationIn,
    type AreaformDocument,
    type Editor,
    type TextTarget,
    type Translations,
} from '@areaform/core';
import { useId, useMemo, useState } from 'react';
import { COMMON_LANGUAGES, languageName } from '../document/contentLanguages.ts';
import { CommitInput } from './CommitInput.tsx';
import { useI18n } from './i18n.ts';

export function LanguagesPanel({
    editor,
    doc,
    filling,
    onFilling,
}: {
    editor: Editor;
    doc: AreaformDocument;
    /** The language being filled in; one the Space offers. */
    filling: string | undefined;
    onFilling: (language: string) => void;
}) {
    const i18n = useI18n();
    const name = (tag: string) => languageName(tag, i18n.locale);
    const { languages } = doc;
    const interfaceLanguage = i18n.locale.split('-')[0]!.toLowerCase();
    const [unset, setUnset] = useState(interfaceLanguage);
    const [adding, setAdding] = useState('');
    const [note, setNote] = useState<string | null>(null);
    const suggestions = useId();
    const missing = useMemo(
        () => new Map((languages?.others ?? []).map((tag) => [tag, missingTexts(doc, tag).length])),
        [doc, languages],
    );
    const setLanguages = (next: AreaformDocument['languages']) =>
        editor.exec({ type: 'space.update', changes: { languages: next } });
    const choices = (current: string) => [
        ...(COMMON_LANGUAGES.some((tag) => sameLanguage(tag, current)) ? [] : [current]),
        ...COMMON_LANGUAGES,
    ];

    if (!languages)
        return (
            <div className="af-languages">
                <p className="af-muted">{i18n.t('languages.unset')}</p>
                <div className="af-row">
                    <select
                        className="af-input"
                        aria-label={i18n.t('languages.defaultField')}
                        value={unset}
                        onChange={(e) => setUnset(e.target.value)}
                    >
                        {choices(unset).map((tag) => (
                            <option key={tag} value={tag}>
                                {name(tag)}
                            </option>
                        ))}
                    </select>
                    <button className="af-button" onClick={() => setLanguages({ default: unset })}>
                        {i18n.t('languages.set')}
                    </button>
                </div>
            </div>
        );

    const others = languages.others ?? [];
    const add = () => {
        const tag = adding.trim();
        if (!isLanguageTag(tag)) return setNote(i18n.t('languages.invalid'));
        if (offersLanguage(languages, tag)) return setNote(i18n.t('languages.already'));
        setLanguages({ ...languages, others: [...others, tag] });
        setAdding('');
        setNote(null);
    };
    return (
        <dl className="af-props af-languages">
            <dt>{i18n.t('languages.fillingIn')}</dt>
            <dd>
                <select
                    className="af-input"
                    aria-label={i18n.t('languages.fillingInField')}
                    value={filling ?? languages.default}
                    onChange={(e) => onFilling(e.target.value)}
                >
                    <option value={languages.default}>
                        {i18n.t('languages.defaultOption', { name: name(languages.default) })}
                    </option>
                    {others.map((tag) => (
                        <option key={tag} value={tag}>
                            {missing.get(tag)
                                ? i18n.t('languages.missing', {
                                      name: name(tag),
                                      count: missing.get(tag)!,
                                  })
                                : name(tag)}
                        </option>
                    ))}
                </select>
            </dd>
            <dt>{i18n.t('languages.default')}</dt>
            <dd>
                <select
                    className="af-input"
                    aria-label={i18n.t('languages.defaultField')}
                    value={languages.default}
                    // Says which language the names are in; no text moves (ADR-0011).
                    onChange={(e) => {
                        const tag = e.target.value;
                        const rest = others.filter((other) => !sameLanguage(other, tag));
                        setLanguages({ default: tag, ...(rest.length && { others: rest }) });
                    }}
                >
                    {choices(languages.default).map((tag) => (
                        <option key={tag} value={tag}>
                            {name(tag)}
                        </option>
                    ))}
                </select>
            </dd>
            <dt>{i18n.t('languages.others')}</dt>
            <dd>
                <ul className="af-chips">
                    {others.map((tag) => (
                        <li key={tag} className="af-chip">
                            {name(tag)}
                            <button
                                className="af-chip-remove"
                                aria-label={i18n.t('languages.remove', { name: name(tag) })}
                                title={i18n.t('languages.removeTitle')}
                                onClick={() => {
                                    const rest = others.filter((other) => other !== tag);
                                    setLanguages({
                                        default: languages.default,
                                        ...(rest.length && { others: rest }),
                                    });
                                }}
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="af-row">
                    <input
                        className="af-input"
                        aria-label={i18n.t('languages.addField')}
                        placeholder="pl, de, pt-BR"
                        list={suggestions}
                        value={adding}
                        onChange={(e) => {
                            setAdding(e.target.value);
                            setNote(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && add()}
                    />
                    <datalist id={suggestions}>
                        {COMMON_LANGUAGES.filter((tag) => !offersLanguage(languages, tag)).map(
                            (tag) => (
                                <option key={tag} value={tag}>
                                    {name(tag)}
                                </option>
                            ),
                        )}
                    </datalist>
                    <button
                        className="af-button"
                        aria-label={i18n.t('languages.addButton')}
                        onClick={add}
                        disabled={!adding.trim()}
                    >
                        {i18n.t('languages.add')}
                    </button>
                </div>
                {note && <p className="af-muted">{note}</p>}
            </dd>
        </dl>
    );
}

/**
 * A label or name field in the language being filled in. In the default language (or with no
 * languages) it edits the text itself through `onDefault`; in another it edits the translation
 * through `text.set`, empty with the default text as its placeholder until translated.
 */
export function TranslatableField({
    editor,
    doc,
    target,
    text,
    translations,
    filling,
    onDefault,
    'aria-label': ariaLabel,
}: {
    editor: Editor;
    doc: AreaformDocument;
    target: TextTarget;
    text: string | undefined;
    translations: Translations | undefined;
    filling: string | undefined;
    onDefault: (value: string) => void;
    'aria-label'?: string;
}) {
    const translating =
        !!doc.languages && !!filling && !sameLanguage(filling, doc.languages.default);
    if (!translating)
        return (
            <CommitInput
                value={text ?? ''}
                onCommit={onDefault}
                {...(ariaLabel && { 'aria-label': ariaLabel })}
            />
        );
    return (
        <CommitInput
            value={translationIn(translations, filling) ?? ''}
            placeholder={text ?? ''}
            onCommit={(value) =>
                editor.exec({ type: 'text.set', target, language: filling, text: value })
            }
            {...(ariaLabel && { 'aria-label': ariaLabel })}
        />
    );
}

/** The caption of a translatable field: `Label`, or `Label (PL)` while filling in Polish. */
export function translatableCaption(
    doc: AreaformDocument,
    filling: string | undefined,
    plain: string,
    inLanguage: (language: string) => string,
): string {
    return doc.languages && filling && !sameLanguage(filling, doc.languages.default)
        ? inLanguage(filling.toUpperCase())
        : plain;
}
