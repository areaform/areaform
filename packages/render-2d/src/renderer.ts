// The renderer's public surface. The PixiJS implementation (pixiRenderer.ts) is loaded on the first
// createRenderer call, so apps that import render-2d only pay for Pixi once they draw a plan.
import type { ElementRef, AreaformDocument, Id, Vec2 } from '@areaform/core';
import type { Camera, WheelMode } from './camera.ts';
import type { GestureHint, Gestures } from './gestures.ts';
import type { OverlayItem } from './overlay.ts';
import type { LabelResolver } from './labels.ts';
import type { AssetResolver, StyleResolver } from './scene.ts';
import type { Theme } from './theme.ts';

export interface ElementEvent {
    ref: ElementRef;
    /** Plan coordinates of the pointer, metres. */
    point: Vec2;
    /** Where the pointer is on the canvas, CSS pixels from its top-left corner (e.g. for a tooltip). */
    screen: Vec2;
    originalEvent: PointerEvent;
}

export interface BackgroundEvent {
    point: Vec2;
    /** Canvas pixels, as in `ElementEvent`. */
    screen: Vec2;
    originalEvent: PointerEvent;
}

export interface HoverEvent {
    /** The Element under the pointer, or null when it left every Element. */
    ref: ElementRef | null;
    point: Vec2;
    /** Canvas pixels, as in `ElementEvent`. */
    screen: Vec2;
}

/** A raw pointer event in plan coordinates, forwarded to editor tools in `edit` interaction. */
export interface PlanPointerEvent {
    point: Vec2;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    originalEvent: PointerEvent;
}

/**
 * `view`: left-drag pans, clicks emit Element events. `edit`: left-button input is forwarded as
 * plan pointer events for tools; pan with the middle button or Space+drag.
 */
export type Interaction = 'view' | 'edit';

/** What `renderer.on(event, handler)` can listen to, and what each handler receives. */
export interface RendererEvents {
    pointerDown: PlanPointerEvent;
    pointerMove: PlanPointerEvent;
    pointerUp: PlanPointerEvent;
    elementClick: ElementEvent;
    backgroundClick: BackgroundEvent;
    elementHover: HoverEvent;
    cameraChange: Camera;
    /** A gesture went to the page under cooperative gestures, e.g. a plain wheel: say how to move the plan. */
    gestureHint: GestureHint;
}

/** Rulers along the canvas's top and left edges. */
export interface Rulers {
    /**
     * Metres per ruler unit. `1` (default) numbers the grid's strong lines in metres; any other,
     * such as `0.3048` for feet, numbers round steps of that unit (1, 2, 5, 10, …).
     */
    unit?: number;
    /** Writes a number of units, e.g. with a decimal comma; `2.5` and `-10` by default. */
    format?: (value: number) => string;
    /** Written in the corner where the rulers meet, e.g. `m` or `ft`. */
    unitLabel?: string;
}

export interface RendererOptions {
    /** The element to fill; the canvas tracks its size. */
    container: HTMLElement;
    theme?: Theme;
    background?: string;
    /** Pointer slack for hits, screen pixels. */
    hitTolerancePx?: number;
    interaction?: Interaction;
    /** What scrolling does; `auto` (default) pans on a trackpad and zooms on a pinch or mouse wheel. */
    wheel?: WheelMode;
    /**
     * Who gets a plain wheel and one finger: the plan (`greedy`, default) or the page it is on
     * (`cooperative`, ADR-0025), where ⌘/Ctrl + wheel, a pinch or two fingers move the plan.
     */
    gestures?: Gestures;
    /** Draw the Document's grid over the floor (default off). */
    grid?: boolean;
    /** Draw rulers along the top and left edges (default none). */
    rulers?: Rulers | null;
    /** Mark the origin, 0/0, with X and Y arrows (default off). */
    origin?: boolean;
}

export interface Renderer {
    update(doc: AreaformDocument): void;
    setLevel(levelId: Id): void;
    setStyleResolver(resolver: StyleResolver | undefined): void;
    /** A host's runtime names and logos for Zones, over the Document's own; never saved. */
    setLabelResolver(resolver: LabelResolver | undefined): void;
    /**
     * The Content Language to show the Space's text in, e.g. the visitor's (`pl-PL` finds `pl`);
     * the default language when absent or not offered (ADR-0011).
     */
    setContentLanguage(language: string | undefined): void;
    /** How Underlay images are found; each `src` is used as is without one. */
    setAssetResolver(resolver: AssetResolver | undefined): void;
    highlight(refs: ElementRef[]): void;
    /** Editor previews drawn above the plan; replaced on every call. */
    setOverlay(items: OverlayItem[]): void;
    setInteraction(interaction: Interaction): void;
    setWheelMode(mode: WheelMode): void;
    setGestures(gestures: Gestures): void;
    /** Shows or hides the grid: lines at the Document's Grid Step, under everything but the floor. */
    setGrid(on: boolean): void;
    /** Shows rulers along the top and left edges, or hides them with `null`. */
    setRulers(rulers: Rulers | null): void;
    /** Shows or hides the origin mark: a cross at 0/0 with X → and Y ↑ arrows, shared by all Levels. */
    setOrigin(on: boolean): void;
    getCamera(): Camera;
    setCamera(camera: Camera): void;
    /** Fits the current Level's Outline on screen, right of the inset. */
    fitLevel(padding?: number): void;
    /** CSS pixels on the canvas's left that the host covers: `fitLevel` fits the rest (default 0). */
    setInset(left: number): void;
    /**
     * Stops drawing frames while the plan is out of sight, e.g. under a 3D view, and draws again
     * when unpaused. Changes made meanwhile are kept and show then.
     */
    setPaused(paused: boolean): void;
    on<E extends keyof RendererEvents>(
        event: E,
        handler: (e: RendererEvents[E]) => void,
    ): () => void;
    destroy(): void;
}

/** Draws a Document into `options.container`. Loads PixiJS on first use. */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
    const { createPixiRenderer } = await import('./pixiRenderer.ts');
    return createPixiRenderer(options);
}
