import { useId } from 'react';
import type { PickableTool } from '../interaction/controller.ts';
import {
    keyLabels,
    SHORTCUT_GROUPS,
    SHORTCUTS,
    type KeyCombo,
    type Platform,
    type Shortcut,
} from '../interaction/shortcuts.ts';
import type { Translator } from '../i18n/index.ts';
import { useI18n } from './i18n.ts';
import type { ViewMode } from './PlanControls.tsx';

/** The rows a host's editor has: none for tools it hides, nor for a 3D view it can't show. */
function visibleShortcuts(tools: PickableTool[] | undefined, canShow3d: boolean): Shortcut[] {
    return SHORTCUTS.filter(
        (s) =>
            (!s.tools || !tools || s.tools.some((t) => tools.includes(t))) &&
            (s.view !== '3d' || canShow3d),
    );
}

function Keys({
    combos,
    platform,
    i18n,
}: {
    combos: readonly KeyCombo[];
    platform: Platform;
    i18n: Translator;
}) {
    return (
        <span className="af-keys">
            {combos.map((combo, i) => (
                <span key={i} className="af-keys">
                    {i > 0 && <span className="af-muted">{i18n.t('common.or')}</span>}
                    {keyLabels(combo, platform, i18n).map((label, j) => (
                        <kbd key={j} className="af-kbd">
                            {label}
                        </kbd>
                    ))}
                </span>
            ))}
        </span>
    );
}

/**
 * Every keyboard shortcut and gesture of the editor, by group. Rows that don't work in the view
 * shown are dimmed and say where they do.
 */
export function ShortcutsDialog({
    platform,
    view,
    tools,
    canShow3d,
    onClose,
}: {
    platform: Platform;
    view: ViewMode;
    tools: PickableTool[] | undefined;
    canShow3d: boolean;
    onClose: () => void;
}) {
    const title = useId();
    const i18n = useI18n();
    const shortcuts = visibleShortcuts(tools, canShow3d);
    return (
        <div className="af-backdrop" onPointerDown={onClose}>
            <div
                className="af-modal af-shortcuts"
                role="dialog"
                aria-modal="true"
                aria-labelledby={title}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <div className="af-shortcuts-header">
                    <h2 id={title} className="af-heading">
                        {i18n.t('shortcuts.title')}
                    </h2>
                    <button className="af-button" onClick={onClose} autoFocus>
                        {i18n.t('common.close')}
                    </button>
                </div>
                <div className="af-shortcut-groups">
                    {SHORTCUT_GROUPS.map((group) => {
                        const rows = shortcuts.filter((s) => s.group === group);
                        if (rows.length === 0) return null;
                        return (
                            <section key={group}>
                                <h3 className="af-shortcut-group">
                                    {i18n.t(`shortcutGroup.${group}`)}
                                </h3>
                                <ul className="af-shortcut-list">
                                    {rows.map((s, i) => {
                                        const elsewhere = s.view && s.view !== view;
                                        return (
                                            <li
                                                key={i}
                                                className="af-shortcut"
                                                aria-disabled={elsewhere || undefined}
                                            >
                                                <span>
                                                    {i18n.t(s.label)}
                                                    {elsewhere && (
                                                        <span className="af-shortcut-view">
                                                            {i18n.t(
                                                                s.view === '2d'
                                                                    ? 'shortcuts.only2d'
                                                                    : 'shortcuts.only3d',
                                                            )}
                                                        </span>
                                                    )}
                                                </span>
                                                <Keys
                                                    combos={'keys' in s ? s.keys : s.gesture}
                                                    platform={platform}
                                                    i18n={i18n}
                                                />
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
