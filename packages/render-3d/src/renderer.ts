// The 3D renderer's public surface. The Three.js implementation (threeRenderer.ts) is loaded on the
// first createRenderer3D call, so apps that only show the plan in 2D never download Three.js.
import type { AreaformDocument, ElementRef, Id, Vec2, Viewpoint } from '@areaform/core';
import type {
    BackgroundEvent,
    ElementEvent,
    GestureHint,
    Gestures,
    HoverEvent,
    LabelResolver,
    StyleResolver,
    Theme,
} from '@areaform/render-2d';
import type { Theme3D } from './theme3d.ts';
import type { FlightPath } from './tour.ts';
import type { Camera3D, ViewPreset } from './view.ts';

export interface Renderer3DOptions {
    /** The element to fill; the canvas tracks its size. */
    container: HTMLElement;
    /** The 2D Theme, for the colours of Zones, Obstacles and Openings. */
    theme?: Theme;
    /** What only the 3D view has a look for; merged over `defaultTheme3D`. */
    theme3d?: Partial<Theme3D>;
    /** Height of the top of doors and passages, metres (default 2.1). */
    doorHeight?: number;
    /** Zone names painted on the floor, laid out as in 2D (default `true`). Stop icons show either way. */
    labels?: boolean;
    /** A host's runtime names and logos for Zones, as in 2D. */
    labelResolver?: LabelResolver;
    /** A host's runtime look for Zones (Style Overrides), as in 2D. */
    styleResolver?: StyleResolver;
    /** The Content Language to show the Space's text in, as `setContentLanguage`. */
    contentLanguage?: string;
    /**
     * Walls nearer the camera than the point it orbits around go down to a low kerb, so they never
     * hide the plan behind them (default `true`). Seen from straight above, every Wall stands.
     */
    cutaway?: boolean;
    /**
     * The sharpest the canvas is drawn, in device pixels per CSS pixel (default 2). Phones with
     * screens of 3 draw less than half the pixels; lower it (e.g. to 1) for weak devices.
     */
    maxPixelRatio?: number;
    /**
     * Who gets a plain wheel and one finger: the plan (`greedy`, default) or the page it is on
     * (`cooperative`, ADR-0025). Under `cooperative`, ⌘/Ctrl + wheel and a pinch zoom, and two
     * fingers orbit and pinch.
     */
    gestures?: Gestures;
    /** CSS pixels on the canvas's left that something covers, as `setInset`. */
    inset?: number;
}

/** What `renderer.on(event, handler)` can listen to, and what each handler receives. */
export interface Renderer3DEvents {
    /** The camera moved, or the canvas changed size: anything placed with `toScreen` moves too. */
    cameraChange: Camera3D;
    /**
     * A click on a Zone, Wall, Opening, Obstacle or Stop, as in 2D; `point` is where on the plan
     * it was hit. A lowered Wall is only its kerb: a click over it lands on what is behind.
     */
    elementClick: ElementEvent;
    /** A click on the bare floor, the ground or the sky (where `point` is what the camera looks at). */
    backgroundClick: BackgroundEvent;
    /** The pointer moved onto another Element, or off every Element (`ref: null`). */
    elementHover: HoverEvent;
    /** A gesture went to the page under cooperative gestures, e.g. a plain wheel: say how to move the plan. */
    gestureHint: GestureHint;
    /** A tour reached one of its Viewpoints and stays there for its pause. */
    tourStep: Viewpoint;
}

/** How `flyTo` moves the camera. */
export interface FlightOptions {
    /** How long the flight takes, seconds; 0 jumps there (default `DEFAULT_FLIGHT`). */
    seconds?: number;
    /** How the camera goes there: `arc` (default), or a straight `line`, as `lookAt` turns it. */
    path?: FlightPath;
}

/**
 * A line drawn on the floor of a Level, e.g. a visitor's route: in the scene, so a Wall or an
 * Obstacle in front of it hides it, and as wide on screen at any distance.
 */
export interface FloorLine {
    /** The Level it is on: drawn only while that Level is shown. */
    levelId: Id;
    /** Plan points, metres, joined in order. */
    points: Vec2[];
    /** A CSS colour. */
    color: string;
    /** CSS pixels. */
    width: number;
    opacity?: number;
    /** Dashes and gaps along it, metres; solid when absent. */
    dash?: [number, number];
    /** A wider line under it, e.g. a light edge so it reads on any floor. */
    casing?: { color: string; width: number; opacity?: number };
}

/**
 * A read-only 3D preview of one Level: drag to orbit, right-drag or Shift-drag to pan, scroll to
 * zoom towards the pointer, click or hover an Element for the same events as in 2D.
 */
export interface Renderer3D {
    /** Shows a Document; only a Level that is a different object than before is rebuilt. */
    update(doc: AreaformDocument): void;
    /** Shows another Level, framed from the same angle. */
    setLevel(levelId: Id): void;
    /** Looks from a named angle, framing the whole Level. */
    setView(view: ViewPreset): void;
    /** Frames the whole Level from the current angle. */
    fitLevel(): void;
    /** A host's runtime names and logos for Zones, over the Document's own; never saved. */
    setLabelResolver(resolver: LabelResolver | undefined): void;
    /**
     * The Content Language to show the Space's text in, e.g. the visitor's (`pl-PL` finds `pl`);
     * the default language when absent or not offered (ADR-0011).
     */
    setContentLanguage(language: string | undefined): void;
    /**
     * A host's runtime look for Zones, e.g. booth status colours, over the Document's own; never
     * saved. Fill, opacity and stroke apply as in 2D; other Elements keep their look in 3D.
     */
    setStyleResolver(resolver: StyleResolver | undefined): void;
    /** Draws these Zones in the Theme's `highlight` (its stroke, as an outline); others are ignored. */
    highlight(refs: ElementRef[]): void;
    /** Draws these lines on the floor, in place of those drawn before; `[]` clears them. */
    setLines(lines: FloorLine[]): void;
    /**
     * Where a plan point (metres) at `height` above the floor is on the canvas, CSS pixels from its
     * top-left corner, e.g. to place a tooltip over a Zone; null when it is behind the camera.
     */
    toScreen(point: Vec2, height?: number): Vec2 | null;
    /**
     * Whether a Wall, an Obstacle or a Stop stands between the camera and a plan point (metres) at
     * `height` above the floor, e.g. to fade a pin placed with `toScreen`. A Wall lowered by the
     * cutaway hides only what its kerb does.
     */
    isHidden(point: Vec2, height?: number): boolean;
    getCamera(): Camera3D;
    /**
     * Puts the camera back where `getCamera` found it. A camera from another Level keeps only its
     * angle, and frames the Level shown.
     */
    setCamera(camera: Camera3D): void;
    setGestures(gestures: Gestures): void;
    /**
     * CSS pixels on the canvas's left that the host covers, e.g. with a card of text: the camera
     * frames, orbits and looks at the rest, while the canvas still fills its container. At most
     * half the canvas; 0 by default.
     */
    setInset(left: number): void;
    /**
     * Turns the camera slowly around the point it looks at, `turnsPerMinute` (e.g. 1), easing in
     * over a second; `null` stops it. The angle and the distance stay as they are.
     */
    setOrbit(turnsPerMinute: number | null): void;
    /**
     * Flies the camera from where it is through these Viewpoints of the Level shown, round and
     * round (ADR-0025). With one, it flies there and then turns around it at `orbitAfter` turns a
     * minute (none when absent). Replaces a tour already playing.
     */
    playTour(viewpoints: Viewpoint[], options?: { orbitAfter?: number }): void;
    /** Holds the tour where it is, or goes on from there. */
    pauseTour(paused: boolean): void;
    /**
     * Ends the tour, leaving the camera where it is. Returns the Viewpoint it would have gone on
     * to, an index into the list it was given: the one after the last it reached, else the one it
     * was flying to; 0 when no tour played.
     */
    stopTour(): number;
    /**
     * Flies the camera from where it is to `camera` on the Level shown, eased in and out, ending
     * a tour or a turn. Resolves `true` on arrival, `false` when something else took the camera on
     * the way: the visitor's drag or zoom, `stopFlight`, another flight, a tour, `setCamera`,
     * another Level or a view preset.
     */
    flyTo(camera: Pick<Camera3D, 'position' | 'target'>, options?: FlightOptions): Promise<boolean>;
    /** Ends a flight where it is; its Promise resolves `false`. */
    stopFlight(): void;
    on<E extends keyof Renderer3DEvents>(
        event: E,
        handler: (e: Renderer3DEvents[E]) => void,
    ): () => void;
    destroy(): void;
}

let webgl: boolean | undefined;

/** Whether this browser can draw the 3D view (it needs WebGL 2). Checked once, then remembered. */
export function isWebGLAvailable(): boolean {
    if (webgl === undefined) {
        try {
            const canvas = globalThis.document?.createElement('canvas');
            const context = canvas?.getContext('webgl2');
            webgl = !!context;
            // Free the probe's context now; browsers allow only a few at once.
            context?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
            webgl = false;
        }
    }
    return webgl;
}

/**
 * Draws a Document in 3D into `options.container`. Loads Three.js on first use; rejects when the
 * browser has no WebGL 2.
 */
export async function createRenderer3D(options: Renderer3DOptions): Promise<Renderer3D> {
    if (!isWebGLAvailable()) throw new Error('The 3D view needs WebGL 2, which is not available.');
    const { createThreeRenderer } = await import('./threeRenderer.ts');
    return createThreeRenderer(options);
}
