import { describe, expect, it } from 'vitest';
import { harness } from '../testing.ts';

describe('Controller events', () => {
    it('toolChange fires once per actual change, from setTool and shortcuts', () => {
        const s = harness();
        const tools: string[] = [];
        s.controller.on('toolChange', (tool) => tools.push(tool));
        s.controller.setTool('wall');
        s.key('z');
        s.key('z'); // already the Zone tool
        s.key('Escape');
        s.controller.setTool('select');
        expect(tools).toEqual(['wall', 'zone', 'select']);
    });

    it('levelChange fires when another Level is shown, not when the same one is set again', () => {
        const s = harness();
        s.editor.exec({ type: 'level.add', name: 'Level 2' });
        const upper = s.editor.getDocument().levels[1]!.id;
        const levels: string[] = [];
        s.controller.on('levelChange', (id) => levels.push(id));
        s.controller.setLevel(s.levelId);
        s.controller.setLevel(upper);
        s.controller.setLevel(upper);
        s.controller.setLevel(s.levelId);
        expect(levels).toEqual([upper, s.levelId]);
    });

    it('selectionChange fires with the new selection, including when undo removes the selected Zone', () => {
        const s = harness();
        const selections: number[] = [];
        s.controller.on('selectionChange', (refs) => selections.push(refs.length));
        s.controller.setTool('zone');
        s.drag([2, 2], [5, 5]);
        s.controller.setTool('select');
        s.click([3, 3]);
        s.click([3, 3]); // same selection again: no event
        s.key('z', { meta: true });
        expect(selections).toEqual([1, 0]);
    });

    it('returns an unsubscribe function', () => {
        const s = harness();
        const tools: string[] = [];
        const off = s.controller.on('toolChange', (tool) => tools.push(tool));
        s.controller.setTool('wall');
        off();
        s.controller.setTool('zone');
        expect(tools).toEqual(['wall']);
    });
});
