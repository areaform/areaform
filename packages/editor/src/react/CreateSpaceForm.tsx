import {
    createSpace,
    defaultPresets,
    presetFor,
    type AreaformDocument,
    type Preset,
} from '@areaform/core';
import { useState, type FormEvent } from 'react';
import { COMMON_LANGUAGES, languageName } from '../document/contentLanguages.ts';
import { kindLabel, type Translator } from '../i18n/index.ts';
import { formatDecimal, parseLength, unitLabel, type DisplayUnits } from '../interaction/units.ts';
import { I18nContext, useTranslator, type LocaleProps } from './i18n.ts';

/** A Preset's Grid Step as the form shows it: metres (`0,5` in Polish), or whole feet (at least 1). */
const stepText = (preset: Preset, units: DisplayUnits, i18n: Translator) => {
    const metres = preset.gridStep;
    return units === 'metric'
        ? formatDecimal(metres, i18n)
        : String(Math.max(1, Math.round(metres / 0.3048)));
};

/**
 * First step of creating a Space (Q26): Space Kind, starting size and Grid Step, typed in
 * `units` (the Document stores metres either way). The Kinds offered are those of `presets`. The
 * suggested Space and Level names are in the interface language, so it is also the Content
 * Language preselected for the names (ADR-0011).
 */
export function CreateSpaceForm({
    onCreate,
    onCancel,
    units = 'metric',
    presets = defaultPresets,
    locale,
    messages,
}: LocaleProps & {
    onCreate: (doc: AreaformDocument) => void;
    onCancel?: () => void;
    units?: DisplayUnits;
    /** The Space Kinds to choose from, with their Presets; the built-in `defaultPresets` when absent. */
    presets?: Record<string, Preset>;
}) {
    const i18n = useTranslator({ locale, messages });
    const metric = units === 'metric';
    const kinds = Object.keys(presets);
    const [name, setName] = useState(() => i18n.t('create.defaultName'));
    const [kind, setKind] = useState(kinds[0] ?? 'generic');
    const [width, setWidth] = useState(metric ? '40' : '130');
    const [depth, setDepth] = useState(metric ? '25' : '80');
    const [gridStep, setGridStep] = useState(() => stepText(presetFor(kind, presets), units, i18n));
    const [language, setLanguage] = useState(() => i18n.locale.split('-')[0]!.toLowerCase());
    const languages = (COMMON_LANGUAGES as readonly string[]).includes(language)
        ? COMMON_LANGUAGES
        : [language, ...COMMON_LANGUAGES];
    const [w, d, step] = [width, depth, gridStep].map((text) => parseLength(text, units));

    const positive = (v: number | undefined): v is number => v !== undefined && v > 0;
    const valid = name.trim() !== '' && positive(w) && positive(d) && positive(step);
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        onCreate(
            createSpace({
                name: name.trim(),
                kind,
                size: [w!, d!],
                gridStep: step!,
                levelName: i18n.t('level.defaultName', { number: 1 }),
                language,
                presets,
            }),
        );
    };

    const caption = (key: 'create.width' | 'create.depth' | 'create.gridStep') =>
        i18n.t('length.caption', { name: i18n.t(key), unit: unitLabel(units, i18n) });

    return (
        <I18nContext.Provider value={i18n}>
            <form className="af-form af-theme" onSubmit={submit} aria-label={i18n.t('create.form')}>
                <label>
                    {i18n.t('create.name')}
                    <input
                        className="af-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </label>
                <label>
                    {i18n.t('create.kind')}
                    <select
                        className="af-input"
                        value={kind}
                        onChange={(e) => {
                            setKind(e.target.value);
                            setGridStep(stepText(presetFor(e.target.value, presets), units, i18n));
                        }}
                    >
                        {kinds.map((k) => (
                            <option key={k} value={k}>
                                {kindLabel(i18n, k, presets[k]!.label)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    {caption('create.width')}
                    <input
                        className="af-input"
                        inputMode="decimal"
                        value={width}
                        onChange={(e) => setWidth(e.target.value)}
                    />
                </label>
                <label>
                    {caption('create.depth')}
                    <input
                        className="af-input"
                        inputMode="decimal"
                        value={depth}
                        onChange={(e) => setDepth(e.target.value)}
                    />
                </label>
                <label>
                    {caption('create.gridStep')}
                    <input
                        className="af-input"
                        inputMode="decimal"
                        value={gridStep}
                        onChange={(e) => setGridStep(e.target.value)}
                    />
                </label>
                <label>
                    {i18n.t('create.language')}
                    <select
                        className="af-input"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                    >
                        {languages.map((tag) => (
                            <option key={tag} value={tag}>
                                {languageName(tag, i18n.locale)}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="af-buttons">
                    <button className="af-button af-primary" type="submit" disabled={!valid}>
                        {i18n.t('create.submit')}
                    </button>
                    {onCancel && (
                        <button className="af-button" type="button" onClick={onCancel}>
                            {i18n.t('common.cancel')}
                        </button>
                    )}
                </div>
            </form>
        </I18nContext.Provider>
    );
}
