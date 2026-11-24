import type { KeyInput, PickableTool } from './controller.ts';
import { english, type PlainMessageKey, type Translator } from '../i18n/index.ts';

/** The groups of the shortcuts window, in the order shown; `shortcutGroup.<id>` is a heading. */
export const SHORTCUT_GROUPS = ['tools', 'edit', 'selection', 'drawing', 'view'] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/**
 * Keys pressed together, modifiers first: `['mod', 'shift', 'Z']`. `mod` is ⌘ on macOS and Ctrl
 * elsewhere. Keys are DOM key names (`Escape`, `Delete`) or a letter, matched on any layout. In a
 * gesture the last item is a pointer action instead: `click`, `drag`, `scroll`, `pinch`.
 */
export type KeyCombo = readonly string[];

/** What an editor-wide key does when the controller matches it. */
export type ShortcutAction =
    { tool: PickableTool } | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'duplicate' | 'shortcuts';

interface ShortcutBase {
    /** What it does, as a message key: `t(label)` gives the text. */
    label: PlainMessageKey;
    group: ShortcutGroup;
    /** The tools it belongs to: hidden when a host shows none of them. Any tool when absent. */
    tools?: readonly PickableTool[];
    /** The only view it works in; both when absent. */
    view?: '2d' | '3d';
}

export interface KeyShortcut extends ShortcutBase {
    /** Alternatives: any of them does the same. */
    keys: readonly KeyCombo[];
    /**
     * For an editor-wide key, what the controller does. Keys without one are handled by a tool
     * and only described here.
     */
    action?: ShortcutAction;
}

/** A mouse or trackpad gesture: shown in the window, never matched as a key. */
export interface GestureShortcut extends ShortcutBase {
    gesture: readonly KeyCombo[];
}

export type Shortcut = KeyShortcut | GestureShortcut;

const DRAWING: PickableTool[] = ['wall', 'zone', 'obstacle', 'outline', 'connection', 'ruler'];
const POLYGONS: PickableTool[] = ['zone', 'obstacle', 'connection', 'outline'];

const tool = (name: PickableTool, key: string): KeyShortcut => ({
    label: `tool.${name}`,
    group: 'tools',
    keys: [[key]],
    action: { tool: name },
    tools: [name],
    view: '2d',
});

/** Every shortcut of the editor: the source the controller matches keys against and the window shows. */
export const SHORTCUTS: readonly Shortcut[] = [
    tool('select', 'V'),
    tool('wall', 'W'),
    tool('zone', 'Z'),
    tool('door', 'D'),
    tool('obstacle', 'O'),
    tool('connection', 'C'),
    tool('outline', 'E'),
    tool('ruler', 'M'),

    { label: 'toolbar.undo', group: 'edit', keys: [['mod', 'Z']], action: 'undo' },
    { label: 'toolbar.redo', group: 'edit', keys: [['mod', 'shift', 'Z']], action: 'redo' },
    { label: 'shortcut.copy', group: 'edit', keys: [['mod', 'C']], action: 'copy' },
    { label: 'shortcut.cut', group: 'edit', keys: [['mod', 'X']], action: 'cut' },
    { label: 'shortcut.paste', group: 'edit', keys: [['mod', 'V']], action: 'paste' },
    {
        label: 'shortcut.duplicate',
        group: 'edit',
        keys: [['mod', 'D']],
        action: 'duplicate',
    },

    ...(
        [
            { label: 'shortcut.select', gesture: [['click']] },
            { label: 'shortcut.toggleSelect', gesture: [['shift', 'click']] },
            { label: 'shortcut.boxSelect', gesture: [['drag']] },
            { label: 'shortcut.move', gesture: [['drag']] },
            {
                label: 'shortcut.delete',
                keys: [['Delete'], ['Backspace']],
            },
            { label: 'shortcut.clearSelection', keys: [['Escape']] },
            { label: 'shortcut.turnLeft', keys: [['R']] },
            { label: 'shortcut.turnRight', keys: [['shift', 'R']] },
            { label: 'shortcut.flipSwing', keys: [['F']] },
            { label: 'shortcut.flipHinge', keys: [['shift', 'F']] },
            {
                label: 'shortcut.moveCorner',
                gesture: [['shift', 'drag']],
            },
            { label: 'shortcut.resizeUnderlayCentre', gesture: [['alt', 'drag']] },
        ] as const
    ).map(
        // Keys act on the selection, which 3D keeps; gestures need the plan.
        (shortcut): Shortcut => ({
            ...shortcut,
            group: 'selection',
            tools: ['select'],
            ...('gesture' in shortcut && { view: '2d' as const }),
        }),
    ),

    ...(
        [
            {
                label: 'shortcut.finish',
                keys: [['Escape']],
                tools: DRAWING,
            },
            {
                label: 'shortcut.close',
                keys: [['Enter']],
                tools: [...POLYGONS, 'wall'],
            },
            {
                label: 'shortcut.typeLength',
                keys: [['0–9']],
                tools: ['wall'],
            },
            {
                label: 'shortcut.correctLength',
                keys: [['Backspace']],
                tools: ['wall'],
            },
            {
                label: 'shortcut.deleteCorner',
                keys: [['Delete'], ['Backspace']],
                tools: ['outline'],
            },
            { label: 'shortcut.noSnap', gesture: [['alt', 'drag']] },
        ] as const
    ).map((shortcut): Shortcut => ({ ...shortcut, group: 'drawing', view: '2d' })),

    {
        label: 'shortcut.showShortcuts',
        group: 'view',
        keys: [['?']],
        action: 'shortcuts',
    },
    {
        label: 'shortcut.pan',
        group: 'view',
        gesture: [['space', 'drag'], ['middle-drag'], ['scroll']],
        view: '2d',
    },
    { label: 'shortcut.zoom', group: 'view', gesture: [['pinch'], ['mod', 'scroll']] },
    { label: 'shortcut.orbit', group: 'view', gesture: [['drag']], view: '3d' },
    {
        label: 'shortcut.pan',
        group: 'view',
        gesture: [['right-drag'], ['shift', 'drag']],
        view: '3d',
    },
];

/** The platform keys are shown for: `mac` uses ⌘ ⌥ ⇧, `other` Ctrl, Alt and Shift. */
export type Platform = 'mac' | 'other';

/** The platform of this browser; `other` outside one. */
export function detectPlatform(): Platform {
    if (typeof navigator === 'undefined') return 'other';
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const name = nav.userAgentData?.platform || nav.platform || nav.userAgent;
    return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}

const MODIFIERS = ['mod', 'alt', 'shift'];
const MAC: Record<string, string> = { mod: '⌘', alt: '⌥', shift: '⇧' };
const OTHER: Record<string, string> = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' };
/** Keys and gestures whose names are translated, as `key.<name>`; others show as they are. */
const NAMED = new Set([
    'Escape',
    'space',
    'click',
    'drag',
    'scroll',
    'pinch',
    'middle-drag',
    'right-drag',
]);

/** The parts of a combination as shown, modifiers in the platform's order: `['⇧', '⌘', 'Z']`. */
export function keyLabels(
    keys: KeyCombo,
    platform: Platform,
    i18n: Translator = english,
): string[] {
    const mods = keys.filter((k) => MODIFIERS.includes(k));
    // macOS writes ⌥⇧⌘, others Ctrl+Alt+Shift.
    const order = platform === 'mac' ? ['alt', 'shift', 'mod'] : ['mod', 'alt', 'shift'];
    const names = platform === 'mac' ? MAC : OTHER;
    return [
        ...order.filter((m) => mods.includes(m)).map((m) => names[m]!),
        ...keys
            .filter((k) => !MODIFIERS.includes(k))
            .map((k) => (NAMED.has(k) ? (i18n.lookup(`key.${k}`) ?? k) : k)),
    ];
}

/** A combination as text, e.g. for a tooltip: `⇧⌘Z` on macOS, `Ctrl+Shift+Z` elsewhere. */
export function formatKeys(keys: KeyCombo, platform: Platform, i18n: Translator = english): string {
    const labels = keyLabels(keys, platform, i18n);
    if (platform !== 'mac') return labels.join('+');
    // Symbols run together and onto a single key (⇧⌘Z); a word after them gets a space (⌘ Scroll).
    const mods = labels.filter((l) => /^[⌘⌥⇧]$/.test(l)).join('');
    const rest = labels.filter((l) => !/^[⌘⌥⇧]$/.test(l)).join('+');
    if (!mods || !rest) return mods + rest;
    return rest.length === 1 ? mods + rest : `${mods} ${rest}`;
}

/** A combination in the form of `aria-keyshortcuts`, e.g. `Meta+Shift+Z`. */
export function ariaKeys(keys: KeyCombo, platform: Platform): string {
    const names: Record<string, string> = {
        mod: platform === 'mac' ? 'Meta' : 'Control',
        alt: 'Alt',
        shift: 'Shift',
    };
    return keys.map((k) => names[k] ?? k).join('+');
}

const isLetter = (key: string) => /^[a-z]$/i.test(key);

/**
 * The key with letters read from the physical key when the layout types something else, so W
 * picks the Wall tool on a Cyrillic or Greek layout too. A Latin layout keeps its own letters.
 */
export function latinKey(input: KeyInput): KeyInput {
    const physical = /^Key([A-Z])$/.exec(input.code ?? '');
    if (!physical || isLetter(input.key) || [...input.key].length !== 1) return input;
    const letter = physical[1]!;
    return { ...input, key: input.shift ? letter : letter.toLowerCase() };
}

/** Whether `input` presses `keys`. Shift counts for letters only: `?` is typed with it. */
export function pressed(keys: KeyCombo, input: KeyInput): boolean {
    const key = keys[keys.length - 1]!;
    if (keys.includes('mod') !== (input.meta ?? false)) return false;
    if (!isLetter(key)) return input.key === key;
    return (
        keys.includes('shift') === (input.shift ?? false) &&
        input.key.toLowerCase() === key.toLowerCase()
    );
}

/** The editor-wide shortcut `input` presses, if any. */
export function shortcutFor(
    input: KeyInput,
): (KeyShortcut & { action: ShortcutAction }) | undefined {
    return SHORTCUTS.find(
        (s): s is KeyShortcut & { action: ShortcutAction } =>
            'action' in s && s.action !== undefined && s.keys.some((k) => pressed(k, input)),
    );
}

/** The keys of an editor-wide action, e.g. for a button's tooltip. */
export function keysOf(action: ShortcutAction): KeyCombo | undefined {
    const same = (a: ShortcutAction) =>
        typeof a === 'string' || typeof action === 'string' ? a === action : a.tool === action.tool;
    const found = SHORTCUTS.find((s) => 'action' in s && s.action && same(s.action));
    return found && 'keys' in found ? found.keys[0] : undefined;
}
