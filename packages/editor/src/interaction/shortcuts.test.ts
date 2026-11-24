import { describe, expect, it } from 'vitest';
import type { KeyInput, PickableTool } from './controller.ts';
import {
    ariaKeys,
    formatKeys,
    keysOf,
    latinKey,
    pressed,
    SHORTCUT_GROUPS,
    SHORTCUTS,
    shortcutFor,
    type KeyShortcut,
} from './shortcuts.ts';
import { harness, type Harness } from '../testing.ts';

describe('formatKeys', () => {
    it('writes macOS symbols together, and words elsewhere', () => {
        expect(formatKeys(['mod', 'shift', 'Z'], 'mac')).toBe('⇧⌘Z');
        expect(formatKeys(['mod', 'shift', 'Z'], 'other')).toBe('Ctrl+Shift+Z');
        expect(formatKeys(['mod', 'scroll'], 'mac')).toBe('⌘ Scroll');
        expect(formatKeys(['space', 'drag'], 'mac')).toBe('Space+Drag');
        expect(formatKeys(['Escape'], 'other')).toBe('Esc');
        expect(formatKeys(['?'], 'mac')).toBe('?');
    });

    it('names the keys for aria-keyshortcuts', () => {
        expect(ariaKeys(['mod', 'shift', 'Z'], 'mac')).toBe('Meta+Shift+Z');
        expect(ariaKeys(['mod', 'D'], 'other')).toBe('Control+D');
    });
});

describe('latinKey', () => {
    it('reads letters from the physical key on a non-Latin layout', () => {
        expect(latinKey({ key: 'ц', code: 'KeyW' }).key).toBe('w');
        expect(latinKey({ key: 'К', code: 'KeyR', shift: true }).key).toBe('R');
    });

    it('keeps the letters a Latin layout types, and keys that are not letters', () => {
        // AZERTY: the key in the place of Q types A.
        expect(latinKey({ key: 'a', code: 'KeyQ' }).key).toBe('a');
        expect(latinKey({ key: 'Escape', code: 'Escape' }).key).toBe('Escape');
        expect(latinKey({ key: '?', code: 'Slash', shift: true }).key).toBe('?');
    });
});

describe('the shortcut list', () => {
    const editorWide = SHORTCUTS.filter(
        (s): s is KeyShortcut => 'keys' in s && s.action !== undefined,
    );

    it('has a Tools key for every tool, and every group used', () => {
        const tools: PickableTool[] = [
            'select',
            'wall',
            'zone',
            'door',
            'obstacle',
            'connection',
            'outline',
            'ruler',
        ];
        for (const tool of tools) expect(keysOf({ tool })).toBeDefined();
        expect(new Set(SHORTCUTS.map((s) => s.group))).toEqual(new Set(SHORTCUT_GROUPS));
    });

    it('gives no two editor-wide shortcuts the same keys', () => {
        const combos = editorWide.flatMap((s) => s.keys.map((k) => k.join('+').toLowerCase()));
        expect(new Set(combos).size).toBe(combos.length);
    });

    it('matches Shift for letters only', () => {
        expect(pressed(['mod', 'Z'], { key: 'z', meta: true })).toBe(true);
        expect(pressed(['mod', 'Z'], { key: 'Z', meta: true, shift: true })).toBe(false);
        expect(pressed(['?'], { key: '?', shift: true })).toBe(true);
        expect(shortcutFor({ key: 'Z', meta: true, shift: true })?.action).toBe('redo');
    });
});

describe('keys in the controller', () => {
    it('picks tools and duplicates on a Cyrillic layout', () => {
        const h = harness();
        h.controller.keyDown({ key: 'ц', code: 'KeyW' });
        expect(h.controller.getState().tool).toBe('wall');

        h.controller.setTool('select');
        h.editor.exec({ type: 'zone.add', levelId: h.levelId, zone: { id: 'Z', shape: rect } });
        h.controller.select([{ kind: 'zone', id: 'Z', levelId: h.levelId }]);
        expect(h.controller.keyDown({ key: 'в', code: 'KeyD', meta: true })).toBe(true);
        expect(h.level().zones).toHaveLength(2);
    });

    it('opens the shortcuts window with ?, and closes it with Esc, keeping the drawing', () => {
        const h = harness();
        h.controller.setTool('wall');
        h.click([1, 1]);
        h.click([5, 1]);

        expect(h.key('?', { shift: true })).toBe(true);
        expect(h.controller.getState().shortcutsOpen).toBe(true);
        // Nothing but closing works meanwhile.
        expect(h.key('v')).toBe(false);
        expect(h.controller.getState().tool).toBe('wall');
        expect(h.key('Escape')).toBe(true);
        expect(h.controller.getState().shortcutsOpen).toBe(false);

        // The chain goes on from where it was.
        h.click([5, 4]);
        expect(h.level().walls).toHaveLength(2);
    });

    it('reports the window opening and closing, once each', () => {
        const h = harness();
        const seen: boolean[] = [];
        h.controller.on('shortcutsChange', (open) => seen.push(open));
        h.key('?', { shift: true });
        h.controller.openShortcuts();
        h.key('Escape');
        h.controller.closeShortcuts();
        expect(seen).toEqual([true, false]);
    });

    it('closes the window with ? too', () => {
        const h = harness();
        h.controller.openShortcuts();
        expect(h.key('?', { shift: true })).toBe(true);
        expect(h.controller.getState().shortcutsOpen).toBe(false);
    });

    it('keeps the tool keys for 2D, while the selection keys work in 3D too', () => {
        const h = harness();
        h.editor.exec({ type: 'zone.add', levelId: h.levelId, zone: { id: 'Z', shape: rect } });
        h.controller.select([{ kind: 'zone', id: 'Z', levelId: h.levelId }]);
        h.controller.setView('3d');

        expect(h.key('w')).toBe(false);
        expect(h.controller.getState().tool).toBe('select');

        expect(h.key('Delete')).toBe(true);
        expect(h.level().zones).toHaveLength(0);
        expect(h.key('z', { meta: true })).toBe(true);
        expect(h.level().zones).toHaveLength(1);
        expect(h.key('?', { shift: true })).toBe(true);

        h.controller.closeShortcuts();
        h.controller.setView('2d');
        expect(h.key('w')).toBe(true);
    });
});

const rect = {
    outer: [
        [2, 2],
        [6, 2],
        [6, 5],
        [2, 5],
    ] as [number, number][],
};

/** States in which each tool handles keys, to find the keys it handles. */
const SCENARIOS: { tool: PickableTool; name: string; setup: (h: Harness) => void }[] = [
    {
        tool: 'select',
        name: 'a Zone selected',
        setup(h) {
            h.editor.exec({ type: 'zone.add', levelId: h.levelId, zone: { id: 'Z', shape: rect } });
            h.controller.select([{ kind: 'zone', id: 'Z', levelId: h.levelId }]);
        },
    },
    {
        tool: 'select',
        name: 'a corner highlighted',
        setup(h) {
            h.editor.exec({ type: 'zone.add', levelId: h.levelId, zone: { id: 'Z', shape: rect } });
            h.controller.select([{ kind: 'zone', id: 'Z', levelId: h.levelId }]);
            h.click([2, 2]);
        },
    },
    {
        tool: 'select',
        name: 'a door selected',
        setup(h) {
            h.editor.exec({
                type: 'wall.add',
                levelId: h.levelId,
                id: 'W',
                a: [0, 5],
                b: [10, 5],
                thickness: 0.2,
            });
            h.editor.exec({
                type: 'opening.add',
                levelId: h.levelId,
                opening: {
                    id: 'D',
                    kind: 'door',
                    width: 0.9,
                    host: 'wall',
                    wallId: 'W',
                    offset: 4,
                },
            });
            h.controller.select([{ kind: 'opening', id: 'D', levelId: h.levelId }]);
        },
    },
    {
        tool: 'wall',
        name: 'drawing',
        setup(h) {
            h.controller.setTool('wall');
            h.click([1, 1]);
            h.move([4, 1]);
        },
    },
    {
        tool: 'wall',
        name: 'typing a length',
        setup(h) {
            h.controller.setTool('wall');
            h.click([1, 1]);
            h.move([4, 1]);
            h.key('3');
        },
    },
    ...(['zone', 'obstacle', 'connection'] as const).flatMap((tool) => [
        {
            tool,
            name: 'dragging a rectangle',
            setup(h: Harness) {
                h.controller.setTool(tool);
                h.controller.pointerDown({ point: [1, 1] });
                h.move([3, 3]);
            },
        },
        {
            tool,
            name: 'drawing a polygon',
            setup(h: Harness) {
                h.controller.setTool(tool);
                h.controller.setShapeMode('polygon');
                h.click([1, 1]);
                h.click([4, 1]);
                h.click([4, 4]);
            },
        },
    ]),
    {
        tool: 'outline',
        name: 'a corner highlighted',
        setup(h) {
            h.controller.setTool('outline');
            h.click([0, 0]);
        },
    },
    {
        tool: 'outline',
        name: 'drawing a hole',
        setup(h) {
            h.controller.setTool('outline');
            h.controller.setOutlineMode('hole');
            h.controller.setShapeMode('polygon');
            h.click([5, 3]);
            h.click([8, 3]);
            h.click([8, 6]);
        },
    },
    {
        tool: 'ruler',
        name: 'measuring',
        setup(h) {
            h.controller.setTool('ruler');
            h.drag([1, 1], [4, 5]);
        },
    },
    { tool: 'door', name: 'placing', setup: (h) => h.controller.setTool('door') },
];

const CANDIDATES: KeyInput[] = [
    ...[...'abcdefghijklmnopqrstuvwxyz'].flatMap((k) => [
        { key: k },
        { key: k.toUpperCase(), shift: true },
    ]),
    ...[...'0123456789.,\'"?/-+= '].map((key) => ({ key })),
    ...['Escape', 'Enter', 'Delete', 'Backspace', 'Tab', 'ArrowLeft', 'ArrowUp', 'Home'].map(
        (key) => ({ key }),
    ),
];

/** Typing a Wall's length takes digits and a decimal separator, all shown as 0–9. */
const TYPED = /^[0-9.,'"]$/;

const documented = (tool: PickableTool, input: KeyInput) =>
    SHORTCUTS.some(
        (s) =>
            'keys' in s &&
            (!s.tools || s.tools.includes(tool)) &&
            s.keys.some((k) => pressed(k, input) || (k[0] === '0–9' && TYPED.test(input.key))),
    );

describe('every key a tool handles is in the list', () => {
    it.each(SCENARIOS)('$tool, $name', ({ tool, setup }) => {
        const missing = CANDIDATES.filter((input) => {
            const h = harness();
            setup(h);
            // An editor-wide shortcut is listed by its action; only the tool's own keys are checked.
            return h.controller.keyDown(input) && !shortcutFor(input) && !documented(tool, input);
        }).map((input) => (input.shift ? `Shift+${input.key}` : input.key));
        expect(missing).toEqual([]);
    });

    it('finds the keys it checks', () => {
        // The scenarios really reach the states that handle keys.
        const handled = (scenario: (typeof SCENARIOS)[number], key: string) => {
            const h = harness();
            scenario.setup(h);
            return h.controller.keyDown({ key });
        };
        const find = (tool: PickableTool, name: string) =>
            SCENARIOS.find((s) => s.tool === tool && s.name === name)!;
        expect(handled(find('select', 'a door selected'), 'f')).toBe(true);
        expect(handled(find('select', 'a corner highlighted'), 'Delete')).toBe(true);
        expect(handled(find('wall', 'typing a length'), 'Backspace')).toBe(true);
        expect(handled(find('zone', 'drawing a polygon'), 'Enter')).toBe(true);
        expect(handled(find('outline', 'a corner highlighted'), 'Escape')).toBe(true);
        expect(handled(find('ruler', 'measuring'), 'Escape')).toBe(true);
    });
});
