import { createContext, useContext } from 'react';
import type { Translator } from '../i18n/index.ts';
import { parseLength, toInputValue, unitLabel, type DisplayUnits } from '../units.ts';
import { CommitInput } from './CommitInput.tsx';
import { useI18n } from './i18n.ts';

/** The editor's display units, for fields and labels inside `<AreaformEditor>`. */
export const UnitsContext = createContext<DisplayUnits>('metric');

export const useUnits = () => useContext(UnitsContext);

/** A length field's name for screen readers: "Wall length in metres" or "… in feet". */
export const lengthFieldLabel = (i18n: Translator, label: string, units: DisplayUnits) =>
    i18n.t(units === 'metric' ? 'length.inMetres' : 'length.inFeet', { label });

/** A `<dt>` caption with the unit: `Length, m` or `Length, ft`. */
export function LengthCaption({ name }: { name: string }) {
    const i18n = useI18n();
    return <dt>{i18n.t('length.caption', { name, unit: unitLabel(useUnits(), i18n) })}</dt>;
}

/**
 * A length field: shows and reads metres, or decimal feet (also `10' 6"`) in imperial units, and
 * always commits metres. `label` names it for screen readers, e.g. "Wall length" → "Wall length
 * in metres".
 */
export function LengthInput({
    metres,
    onCommit,
    label,
    allowZeroOrLess = false,
}: {
    metres: number;
    onCommit: (metres: number) => void;
    label: string;
    /** Positions may be zero or negative; sizes may not. */
    allowZeroOrLess?: boolean;
}) {
    const units = useUnits();
    const i18n = useI18n();
    return (
        <CommitInput
            inputMode="decimal"
            aria-label={lengthFieldLabel(i18n, label, units)}
            value={toInputValue(metres, units, i18n)}
            onCommit={(text) => {
                const value = parseLength(text, units);
                if (value !== undefined && (allowZeroOrLess || value > 0)) onCommit(value);
            }}
        />
    );
}
