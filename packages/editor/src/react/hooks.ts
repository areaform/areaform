import type { Editor, AreaformDocument, Id, Preset } from '@areaform/core';
import type { Theme } from '@areaform/render-2d';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
    createEditorController,
    type ControllerState,
    type EditorController,
} from '../controller.ts';

/** The core Editor's current Document, re-rendering on every change. */
export function useDocument(editor: Editor): AreaformDocument {
    // The same snapshot on the server, so the components can be server-rendered.
    return useSyncExternalStore(
        (onChange) => editor.on('change', onChange),
        editor.getDocument,
        editor.getDocument,
    );
}

/**
 * A controller bound to `editor` (null until mounted). Created inside an effect so that React's
 * StrictMode remount never leaves a destroyed controller in use. `presets` and `theme` are read
 * when it is created.
 */
export function useEditorController(
    editor: Editor,
    levelId: Id,
    presets?: Record<string, Preset>,
    theme?: Theme,
): EditorController | null {
    const [controller, setController] = useState<EditorController | null>(null);
    useEffect(() => {
        const created = createEditorController(editor, {
            levelId,
            ...(presets && { presets }),
            ...(theme && { theme }),
        });
        setController(created);
        return () => created.destroy();
        // The Level is followed with setLevel, not by recreating the controller.
    }, [editor]);
    return controller;
}

const idle = () => () => {};

/** The controller's state, re-rendering on every change. */
export function useControllerState(controller: EditorController | null): ControllerState | null {
    const snapshot = () => controller?.getState() ?? null;
    return useSyncExternalStore(controller?.subscribe ?? idle, snapshot, snapshot);
}
