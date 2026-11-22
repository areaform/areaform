// Helpers shared by the controller tests.
import { createEditor, createSpace, type Editor, type Vec2 } from '@areaform/core';
import { createEditorController, type EditorController, type PointerInput } from './index.ts';

export interface Harness {
    editor: Editor;
    controller: EditorController;
    levelId: string;
    level: () => ReturnType<Editor['getDocument']>['levels'][number];
    click: (point: Vec2, modifiers?: Omit<PointerInput, 'point'>) => void;
    drag: (from: Vec2, to: Vec2, modifiers?: Omit<PointerInput, 'point'>) => void;
    move: (point: Vec2) => void;
    key: (key: string, modifiers?: { shift?: boolean; meta?: boolean }) => boolean;
}

/** A 20 × 10 m Space (grid 1 m) at 50 px/m, so 10 px of snap tolerance is 0.2 m. */
export function harness(kind = 'office'): Harness {
    const doc = createSpace({ name: 'Test', kind, size: [20, 10], gridStep: 1 });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    const controller = createEditorController(editor, { levelId, zoom: 50 });
    return {
        editor,
        controller,
        levelId,
        level: () => editor.getDocument().levels.find((l) => l.id === levelId)!,
        click(point, modifiers = {}) {
            controller.pointerDown({ point, ...modifiers });
            controller.pointerUp({ point, ...modifiers });
        },
        drag(from, to, modifiers = {}) {
            controller.pointerDown({ point: from, ...modifiers });
            const steps = 4;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                controller.pointerMove({
                    point: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
                    ...modifiers,
                });
            }
            controller.pointerUp({ point: to, ...modifiers });
        },
        move(point) {
            controller.pointerMove({ point });
        },
        key(key, modifiers = {}) {
            return controller.keyDown({ key, ...modifiers });
        },
    };
}

/** Walls of a Level as "x,y → x,y" strings in drawing order, independent of node ids. */
export function wallSegments(level: Harness['level'] extends () => infer L ? L : never): string[] {
    const pos = new Map(level.wallNodes.map((n) => [n.id, n.position]));
    return level.walls.map((w) => `${pos.get(w.a)!.join(',')} → ${pos.get(w.b)!.join(',')}`);
}
