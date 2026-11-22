// Plugins (ADR-0012): what a Space shows visitors beyond the View's base, loaded only when used.
import type { Translator } from './i18n/translator.ts';
import type { View } from './view.ts';

/** What a Plugin is given when it starts. */
export interface PluginContext {
    /** The View: its events, Document, Level, languages and `toScreen`. */
    view: View;
    /**
     * A layer over the plan, as big as the View, for the Plugin's own elements. It lets the pointer
     * through; set `pointer-events: auto` on anything that should take clicks.
     */
    overlay: HTMLElement;
    /** The interface translator when the Plugin started. */
    i18n: Translator;
}

/** A Plugin: it subscribes to what it needs and returns how to undo it, if anything. */
export type ViewPlugin = (context: PluginContext) => void | (() => void);

/** A Plugin's module, imported on first use; its default export, or the Plugin itself. */
export interface PluginLoader {
    load: () => Promise<ViewPlugin | { default: ViewPlugin }>;
}

/** A Plugin as is, or a loader that imports it only when the View starts it. */
export type PluginSource = ViewPlugin | PluginLoader;
