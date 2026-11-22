import type {
    Command,
    Connection,
    Editor,
    ElementRef,
    AreaformDocument,
    Id,
    Level,
    Preset,
    Vec2,
} from '@areaform/core';
import { presetFor, worldToUnderlay } from '@areaform/core';
import {
    defaultTheme,
    type Box,
    type LabelResolver,
    type OverlayItem,
    type Theme,
} from '@areaform/render-2d';
import { categoryFlags } from './categories.ts';
import { levelDimensionLabels } from './dimensions.ts';
import { english, type Translator } from './i18n/index.ts';
import type { DisplayUnits } from './units.ts';
import { copyElements, parseClip, pasteElements, serializeClip, type Clip } from './clipboard.ts';
import { deleteCommand, exists, sameRef } from './elements.ts';
import { latinKey, pressed, shortcutFor, type ShortcutAction } from './shortcuts.ts';
import { snap, type SnapResult } from './snap.ts';
import { createCalibrateTool } from './tools/calibrate.ts';
import { createHereTool } from './tools/here.ts';
import { createDoorTool } from './tools/door.ts';
import { createOutlineTool, type OutlineMode } from './tools/outline.ts';
import { createRulerTool } from './tools/ruler.ts';
import { createSelectTool } from './tools/select.ts';
import { connectionTool, obstacleTool, zoneTool, type ShapeMode } from './tools/shape.ts';
import type { Tool, ToolContext } from './tools/tool.ts';
import { createWallTool } from './tools/wall.ts';

export type ToolName =
    | 'select'
    | 'wall'
    | 'zone'
    | 'door'
    | 'obstacle'
    | 'outline'
    | 'connection'
    | 'ruler'
    /** Entered with `startCalibration`, not `setTool`. */
    | 'calibrate'
    /** Entered with `startHerePick`, not `setTool`. */
    | 'here';

/** A tool the user picks: every tool but `calibrate` and `here`. */
export type PickableTool = Exclude<ToolName, 'calibrate' | 'here'>;

/** Whether a tool is entered for one job from a button, never from the toolbar. */
export const isOneJobTool = (tool: ToolName): tool is Exclude<ToolName, PickableTool> =>
    tool === 'calibrate' || tool === 'here';

/** A pointer event already converted to plan coordinates (metres, Y-up). */
export interface PointerInput {
    point: Vec2;
    shift?: boolean;
    /** Held: no snapping. */
    alt?: boolean;
}

export interface KeyInput {
    key: string;
    shift?: boolean;
    /** ⌘ on macOS, Ctrl elsewhere. */
    meta?: boolean;
    /** The physical key (`KeyboardEvent.code`), so letter shortcuts work on any layout. */
    code?: string;
}

/** A delete waiting for the user to confirm, because it would also remove `extra`. */
export interface PendingDelete {
    /** Everything the delete removes. */
    removed: ElementRef[];
    /** What it removes beyond what was asked for (unused Wall Nodes are not counted). */
    extra: ElementRef[];
    command: Command;
}

/** An Underlay calibration in progress: the points clicked so far, in plan coordinates. */
export interface Calibration {
    underlayId: Id;
    points: Vec2[];
}

/** Picking Here for visitors (ADR-0017): the point clicked on the current Level, if any yet. */
export interface HerePick {
    point: Vec2 | null;
}

/** After duplicating a Level: its Connections could stop on the copy too (Q32). */
export interface ExtendOffer {
    copyId: Id;
    sourceId: Id;
}

/**
 * The Connections an offer still applies to: stopping on the source but not on the copy. Empty
 * once the copy is gone.
 */
export function extendableConnections(doc: AreaformDocument, offer: ExtendOffer): Connection[] {
    if (!doc.levels.some((l) => l.id === offer.copyId)) return [];
    return doc.connections.filter(
        (c) =>
            c.stops.some((s) => s.levelId === offer.sourceId) &&
            !c.stops.some((s) => s.levelId === offer.copyId),
    );
}

export interface ControllerState {
    tool: ToolName;
    shapeMode: ShapeMode;
    outlineMode: OutlineMode;
    connectionKind: Connection['kind'];
    /** The category the Zone tool gives new Zones; null for none. */
    zoneCategory: string | null;
    levelId: Id;
    selection: ElementRef[];
    hover: ElementRef | null;
    /** The active tool's previews, plus every dimension label when `dimensions` is on. */
    overlay: OverlayItem[];
    /** Always-on dimensions: label every Wall, Zone and Obstacle big enough to read. */
    dimensions: boolean;
    /** How lengths are shown and typed; the Document always stores metres. */
    units: DisplayUnits;
    /** The interface language of labels and messages. */
    i18n: Translator;
    pendingDelete: PendingDelete | null;
    calibration: Calibration | null;
    /** Picking a point for `?here=`, while the `here` tool is on. */
    herePick: HerePick | null;
    /** Offer to extend Connections to a just-duplicated Level; kept until done or moot. */
    extendOffer: ExtendOffer | null;
    /** A short hint for the user, e.g. why a tool did nothing. Cleared by the next tool action. */
    message: string | null;
    /** The view shown: in 3D, the keys that pick a tool wait for 2D. */
    view: '2d' | '3d';
    /** The keyboard shortcuts window is open; keys other than closing it do nothing meanwhile. */
    shortcutsOpen: boolean;
    /** A CSS cursor the active tool asks for over the plan, e.g. over a resize handle; null for the default. */
    cursor: string | null;
}

/** Notifications for hosts; each fires only when the value actually changes. */
export interface ControllerEvents {
    toolChange: ToolName;
    levelChange: Id;
    selectionChange: ElementRef[];
    /** The keyboard shortcuts window opened (`true`) or closed. */
    shortcutsChange: boolean;
}

export interface EditorController {
    getState(): ControllerState;
    /** Returns an unsubscribe function. */
    subscribe(listener: (state: ControllerState) => void): () => void;
    /** Returns an unsubscribe function. */
    on<E extends keyof ControllerEvents>(
        event: E,
        handler: (value: ControllerEvents[E]) => void,
    ): () => void;
    setTool(tool: PickableTool): void;
    /**
     * The tools the user can pick, for a host that shows only some: the others' shortcuts do
     * nothing, and if the active tool is hidden the first shown takes over. All when absent.
     */
    setTools(tools: PickableTool[] | undefined): void;
    /** Which view the host shows; in 3D, the keys that pick a tool do nothing. */
    setView(view: '2d' | '3d'): void;
    /** Opens the keyboard shortcuts window, leaving whatever is being drawn as it is. */
    openShortcuts(): void;
    closeShortcuts(): void;
    setShapeMode(mode: ShapeMode): void;
    /** In the Outline tool: edit handles, or draw a new hole. */
    setOutlineMode(mode: OutlineMode): void;
    setConnectionKind(kind: Connection['kind']): void;
    setZoneCategory(category: string | null): void;
    select(refs: ElementRef[]): void;
    setLevel(levelId: Id): void;
    /** Current camera zoom (px per metre), so pixel tolerances can be turned into metres. */
    setZoom(zoom: number): void;
    /** The plan area on screen (metres), so always-on dimensions skip what is out of view. */
    setVisibleArea(area: Box | null): void;
    /** Turns always-on dimensions on or off. */
    setDimensions(on: boolean): void;
    setUnits(units: DisplayUnits): void;
    /** The host's Zone logos, so labels and handles keep clear of them as drawn. */
    setLabelResolver(resolver: LabelResolver | undefined): void;
    /** Changes the interface language; make one with `createTranslator`. */
    setTranslator(i18n: Translator): void;
    pointerDown(input: PointerInput): void;
    pointerMove(input: PointerInput): void;
    pointerUp(input: PointerInput): void;
    /** Returns whether the key was handled, so the host can stop it propagating. */
    keyDown(input: KeyInput): boolean;
    /** Copies the selection; returns whether anything could be copied. */
    copy(): boolean;
    /** Copies the selection, then deletes it (asking first if more would go). */
    cut(): boolean;
    /**
     * Pastes what was copied, selected: one grid step right and down from the last paste, or in
     * place on another Level (or after a cut). Returns whether there was anything to paste.
     */
    paste(): boolean;
    /** Pastes a copy of the selection one grid step away, leaving the clipboard alone. */
    duplicate(): boolean;
    /** What was last copied, as text for the system clipboard; null before any copy. */
    clipboardText(): string | null;
    /**
     * Pastes clipboard text from `clipboardText` (this or another editor, tab or Document), by
     * the same rules as `paste`. False, changing nothing, for any other text.
     */
    pasteText(text: string): boolean;
    confirmDelete(): void;
    cancelDelete(): void;
    /**
     * Duplicates a Level (Elements included) and returns the copy's id; when the source has
     * Connections, makes an `extendOffer`. Null if the Document refused.
     */
    duplicateLevel(levelId: Id): Id | null;
    dismissExtendOffer(): void;
    /** Deletes a Level, asking for confirmation when it is not empty. */
    requestLevelDelete(levelId: Id): void;
    /** Starts two-point calibration of an Underlay on the current Level. */
    startCalibration(underlayId: Id): void;
    /**
     * Starts picking Here for visitors: the next click on the plan gives `herePick.point`, the value
     * for `?here=` (see `hereValue`). Ends with the Select tool or Esc.
     */
    startHerePick(): void;
    /**
     * Completes calibration once two points are marked: `distance` is the real metres between
     * them. With `straighten`, the image also turns so the marked line is exactly horizontal or
     * vertical, whichever is nearer.
     */
    finishCalibration(distance: number, options?: { straighten?: boolean }): void;
    destroy(): void;
}

export interface ControllerOptions {
    levelId: Id;
    zoom?: number;
    /** Snap distance, screen pixels. */
    snapTolerancePx?: number;
    /** Hit distance for selecting, screen pixels. */
    hitTolerancePx?: number;
    wallThickness?: number;
    /** Display units to start with; metric by default. */
    units?: DisplayUnits;
    /** The interface language to start with; English by default. */
    i18n?: Translator;
    /** The Presets to look the Space Kind up in; the built-in `defaultPresets` when absent. */
    presets?: Record<string, Preset>;
    /** The renderer's Theme, so labels and handles keep clear of Zone names and icons as drawn. */
    theme?: Theme;
}

export function createEditorController(
    editor: Editor,
    options: ControllerOptions,
): EditorController {
    let zoom = options.zoom ?? 20;
    const snapTolerancePx = options.snapTolerancePx ?? 10;
    const hitTolerancePx = options.hitTolerancePx ?? 6;
    const theme = options.theme ?? defaultTheme;
    let labelResolver: LabelResolver | undefined;
    const listeners = new Set<(state: ControllerState) => void>();
    let state: ControllerState = {
        tool: 'select',
        shapeMode: 'rectangle',
        outlineMode: 'edit',
        connectionKind: 'stairs',
        zoneCategory: presetFor(editor.getDocument().kind, options.presets).zoneCategory ?? null,
        levelId: options.levelId,
        selection: [],
        hover: null,
        overlay: [],
        dimensions: false,
        units: options.units ?? 'metric',
        i18n: options.i18n ?? english,
        pendingDelete: null,
        calibration: null,
        herePick: null,
        extendOffer: null,
        message: null,
        view: '2d',
        shortcutsOpen: false,
        cursor: null,
    };

    const handlers: { [E in keyof ControllerEvents]: Set<(value: ControllerEvents[E]) => void> } = {
        toolChange: new Set(),
        levelChange: new Set(),
        selectionChange: new Set(),
        shortcutsChange: new Set(),
    };
    const emit = <E extends keyof ControllerEvents>(event: E, value: ControllerEvents[E]) => {
        for (const handler of handlers[event]) handler(value);
    };

    // The overlay is the tool's own items plus the dimension layer; tools only set the former.
    let toolOverlay: OverlayItem[] = [];
    let dimensionLayer: OverlayItem[] = [];
    let visibleArea: Box | null = null;

    const setState = (patch: Partial<ControllerState>) => {
        const prev = state;
        if (patch.overlay) {
            toolOverlay = patch.overlay;
            patch = { ...patch, overlay: [...toolOverlay, ...dimensionLayer] };
        }
        state = { ...state, ...patch };
        for (const listener of listeners) listener(state);
        if ('selection' in patch) tool.refresh?.();
        if (state.tool !== prev.tool) emit('toolChange', state.tool);
        if (state.levelId !== prev.levelId) emit('levelChange', state.levelId);
        if (!sameRefs(state.selection, prev.selection)) emit('selectionChange', state.selection);
        if (state.shortcutsOpen !== prev.shortcutsOpen)
            emit('shortcutsChange', state.shortcutsOpen);
    };

    const updateDimensions = () => {
        const shown = editor.getDocument().levels.find((l) => l.id === state.levelId);
        const next =
            state.dimensions && shown
                ? levelDimensionLabels(
                      shown,
                      zoom,
                      visibleArea ?? undefined,
                      state.units,
                      state.i18n,
                      theme,
                      labelResolver,
                  )
                : [];
        if (next.length === 0 && dimensionLayer.length === 0) return;
        dimensionLayer = next;
        setState({ overlay: toolOverlay });
    };

    const level = (): Level => {
        const found = editor.getDocument().levels.find((l) => l.id === state.levelId);
        if (!found) throw new Error(`Unknown level ${state.levelId}`);
        return found;
    };

    /** Asks before running a delete that removes more than `asked` (ignoring unused Wall Nodes). */
    const confirmIfMore = (command: Command, asked: ElementRef[]) => {
        const preview = editor.preview(command);
        if (!preview.ok) return;
        const extra = preview.removed.filter(
            (ref) => ref.kind !== 'wallNode' && !asked.some((s) => sameRef(s, ref)),
        );
        if (extra.length > 0)
            setState({ pendingDelete: { removed: preview.removed, extra, command } });
        else runDelete(command);
    };

    const runDelete = (command: Command) => {
        if (editor.exec(command).ok) setState({ selection: [], hover: null, pendingDelete: null });
    };

    const context: ToolContext = {
        editor,
        levelId: () => state.levelId,
        level,
        snap(input: PointerInput, extra = {}): SnapResult {
            return snap(input.point, {
                level: level(),
                grid: editor.getDocument().grid,
                tolerance: snapTolerancePx / zoom,
                bypass: input.alt ?? false,
                ...extra,
            });
        },
        setOverlay: (overlay) => setState({ overlay }),
        setCursor: (cursor) => {
            if (cursor !== state.cursor) setState({ cursor });
        },
        select: (selection) => setState({ selection }),
        selection: () => state.selection,
        setHover(hover) {
            const same = hover && state.hover ? sameRef(hover, state.hover) : hover === state.hover;
            if (!same) setState({ hover });
        },
        tolerance: () => snapTolerancePx / zoom,
        hitTolerance: () => hitTolerancePx / zoom,
        zoom: () => zoom,
        dimensionsOn: () => state.dimensions,
        units: () => state.units,
        i18n: () => state.i18n,
        theme: () => theme,
        labelResolver: () => labelResolver,
        gridDelta([dx, dy], bypass) {
            const { step, snap: snapOn } = editor.getDocument().grid;
            if (bypass || !snapOn || step <= 0) return [dx, dy];
            const round = (v: number) => Number((Math.round(v / step) * step).toFixed(9));
            return [round(dx), round(dy)];
        },
        requestDelete() {
            const command = deleteCommand(editor.getDocument(), state.levelId, state.selection);
            if (command) confirmIfMore(command, state.selection);
        },
        setMessage: (message) => setState({ message }),
        setCalibration: (calibration) => setState({ calibration }),
        setHerePick: (herePick) => setState({ herePick }),
        endTool: () => switchTool('select'),
        options: { wallThickness: options.wallThickness ?? 0.15 },
    };

    // Copy / paste: what was copied, how many times it has been pasted, and where last.
    let clip: Clip | null = null;
    let clipText: string | null = null;
    let pastes = 0;
    let lastPasteLevel: Id | null = null;

    const pasteAt = (source: Clip, steps: number): boolean => {
        const { step, snap: snapOn } = editor.getDocument().grid;
        const unit = snapOn && step > 0 ? step : 1;
        let refs: ElementRef[] | null;
        try {
            refs = pasteElements(editor, state.levelId, source, [steps * unit, -steps * unit]);
        } catch {
            refs = null; // clipboard text from elsewhere that the Commands cannot make sense of
        }
        if (!refs) {
            setState({ message: state.i18n.t('message.cannotPaste') });
            return true;
        }
        if (state.tool !== 'select') switchTool('select');
        setState({ selection: refs, hover: null });
        return true;
    };

    let calibrating: Id | null = null;
    const tools: Record<ToolName, () => Tool> = {
        select: () => createSelectTool(context),
        wall: () => createWallTool(context),
        zone: () =>
            zoneTool(context, state.shapeMode, () => {
                const category = state.zoneCategory;
                if (category === null) return {};
                const preset = presetFor(editor.getDocument().kind, options.presets);
                return { category, ...categoryFlags(preset, category) };
            }),
        door: () => createDoorTool(context),
        obstacle: () => obstacleTool(context, state.shapeMode),
        outline: () =>
            createOutlineTool(context, state.outlineMode, state.shapeMode, () => {
                setState({ outlineMode: 'edit' });
                switchTool('outline');
            }),
        connection: () => connectionTool(context, state.shapeMode, () => state.connectionKind),
        ruler: () => createRulerTool(context),
        calibrate: () => createCalibrateTool(context, calibrating!),
        here: () => createHereTool(context),
    };
    let tool: Tool = tools.select();

    function switchTool(name: ToolName) {
        tool.cancel();
        setState({ tool: name, overlay: [], message: null, cursor: null });
        tool = tools[name]();
        tool.refresh?.();
    }

    // Undo, redo or another client may remove Elements; never keep pointing at them.
    const offChange = editor.on('change', (doc) => {
        const selection = state.selection.filter((ref) => exists(doc, ref));
        const hover = state.hover && exists(doc, state.hover) ? state.hover : null;
        if (selection.length !== state.selection.length || hover !== state.hover) {
            setState({ selection, hover });
        } else {
            tool.refresh?.();
        }
        if (state.extendOffer && extendableConnections(doc, state.extendOffer).length === 0)
            setState({ extendOffer: null });
        updateDimensions();
    });

    let shown: PickableTool[] | undefined;

    /** Runs an editor-wide shortcut; returns whether it did anything. */
    const run = (action: ShortcutAction): boolean => {
        if (typeof action === 'object') {
            if (shown && !shown.includes(action.tool)) return false;
            switchTool(action.tool);
            return true;
        }
        if (action === 'undo' || action === 'redo') {
            tool.cancel();
            if (action === 'redo') editor.redo();
            else editor.undo();
            setState({ overlay: [] });
            tool = tools[state.tool]();
            tool.refresh?.();
            return true;
        }
        if (action === 'shortcuts') {
            api.openShortcuts();
            return true;
        }
        return api[action]();
    };

    const withMessageCleared =
        (handler: (input: PointerInput) => void) => (input: PointerInput) => {
            if (state.message) setState({ message: null });
            handler(input);
        };

    const api: EditorController = {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        on(event, handler) {
            handlers[event].add(handler);
            return () => handlers[event].delete(handler);
        },
        setTool(name) {
            if (name === 'outline') setState({ outlineMode: 'edit' });
            switchTool(name);
        },
        setTools(tools) {
            shown = tools;
            const current = state.tool;
            if (shown && !isOneJobTool(current) && !shown.includes(current))
                switchTool(shown[0] ?? 'select');
        },
        setShapeMode(mode) {
            setState({ shapeMode: mode });
            const drawsShapes = ['zone', 'obstacle', 'connection'].includes(state.tool);
            if (drawsShapes || (state.tool === 'outline' && state.outlineMode === 'hole'))
                switchTool(state.tool);
        },
        setOutlineMode(mode) {
            setState({ outlineMode: mode });
            if (state.tool === 'outline') switchTool('outline');
        },
        setConnectionKind(kind) {
            setState({ connectionKind: kind });
        },
        setZoneCategory(category) {
            setState({ zoneCategory: category });
        },
        select: (selection) => setState({ selection }),
        setLevel(levelId) {
            tool.cancel();
            setState({ levelId, selection: [], hover: null, overlay: [], cursor: null });
            // A one-job tool belongs to the Level it was started on.
            const oneJob = isOneJobTool(state.tool);
            tool = tools[oneJob ? 'select' : state.tool]();
            if (oneJob) setState({ tool: 'select' });
            updateDimensions();
        },
        setZoom(next) {
            zoom = next;
            updateDimensions();
        },
        setVisibleArea(area) {
            visibleArea = area;
            updateDimensions();
        },
        setLabelResolver(resolver) {
            if (resolver === labelResolver) return;
            labelResolver = resolver;
            updateDimensions();
        },
        setUnits(units) {
            if (units === state.units) return;
            setState({ units });
            updateDimensions();
            tool.refresh?.();
        },
        setTranslator(i18n) {
            if (i18n === state.i18n) return;
            setState({ i18n });
            updateDimensions();
            tool.refresh?.();
        },
        setDimensions(on) {
            if (on === state.dimensions) return;
            setState({ dimensions: on });
            updateDimensions();
            tool.refresh?.();
        },
        pointerDown: withMessageCleared((input) => tool.pointerDown(input)),
        pointerMove: (input) => tool.pointerMove(input),
        pointerUp: (input) => tool.pointerUp(input),
        keyDown(raw) {
            const input = latinKey(raw);
            if (state.shortcutsOpen) {
                // Esc closes the window only, keeping what is being drawn.
                if (input.key !== 'Escape' && !pressed(['?'], input)) return false;
                api.closeShortcuts();
                return true;
            }
            if (tool.keyDown(input)) return true;
            const shortcut = shortcutFor(input);
            if (!shortcut || (shortcut.view && shortcut.view !== state.view)) return false;
            return run(shortcut.action);
        },
        setView(view) {
            if (view !== state.view) setState({ view });
        },
        openShortcuts() {
            if (!state.shortcutsOpen) setState({ shortcutsOpen: true });
        },
        closeShortcuts() {
            if (state.shortcutsOpen) setState({ shortcutsOpen: false });
        },
        copy() {
            const copied = copyElements(editor.getDocument(), state.levelId, state.selection);
            if (!copied) return false;
            clip = copied;
            clipText = serializeClip(copied);
            pastes = 0;
            lastPasteLevel = copied.levelId;
            return true;
        },
        clipboardText: () => clipText,
        pasteText(text) {
            if (text !== clipText) {
                const parsed = parseClip(text);
                if (!parsed) return false;
                // A clip from elsewhere: paste it by the same rules, as if just copied.
                clip = parsed;
                clipText = text;
                pastes = 0;
                lastPasteLevel = parsed.levelId;
            }
            return api.paste();
        },
        cut() {
            if (!api.copy()) return false;
            pastes = -1; // the first paste puts it back where it was
            context.requestDelete();
            return true;
        },
        paste() {
            if (!clip) return false;
            if (state.levelId !== lastPasteLevel) pastes = state.levelId === clip.levelId ? 1 : 0;
            else pastes += 1;
            lastPasteLevel = state.levelId;
            return pasteAt(clip, pastes);
        },
        duplicate() {
            const copied = copyElements(editor.getDocument(), state.levelId, state.selection);
            return copied ? pasteAt(copied, 1) : false;
        },
        confirmDelete() {
            if (state.pendingDelete) runDelete(state.pendingDelete.command);
        },
        cancelDelete() {
            setState({ pendingDelete: null });
        },
        duplicateLevel(levelId) {
            const copyId = crypto.randomUUID();
            if (!editor.exec({ type: 'level.duplicate', levelId, id: copyId }).ok) return null;
            const offer = { copyId, sourceId: levelId };
            const worth = extendableConnections(editor.getDocument(), offer).length > 0;
            setState({ extendOffer: worth ? offer : null });
            return copyId;
        },
        dismissExtendOffer() {
            setState({ extendOffer: null });
        },
        requestLevelDelete(levelId) {
            confirmIfMore({ type: 'level.delete', levelId }, [{ kind: 'level', id: levelId }]);
        },
        startHerePick() {
            switchTool('here');
            setState({ herePick: { point: null } });
        },
        startCalibration(underlayId) {
            calibrating = underlayId;
            switchTool('calibrate');
            setState({ calibration: { underlayId, points: [] } });
        },
        finishCalibration(distance, { straighten = false } = {}) {
            const calibration = state.calibration;
            const underlay = level().underlays.find((u) => u.id === calibration?.underlayId);
            const [a, b] = calibration?.points ?? [];
            if (!underlay || !a || !b) return;
            editor.exec({
                type: 'underlay.calibrate',
                levelId: state.levelId,
                underlayId: underlay.id,
                pixels: [worldToUnderlay(underlay, a), worldToUnderlay(underlay, b)],
                distance,
                ...(straighten && {
                    angle: nearestQuarterTurn(Math.atan2(b[1] - a[1], b[0] - a[0])),
                }),
            });
            switchTool('select');
        },
        destroy() {
            tool.cancel();
            offChange();
            listeners.clear();
            for (const set of Object.values(handlers)) set.clear();
        },
    };
    return api;
}

function sameRefs(a: ElementRef[], b: ElementRef[]): boolean {
    return a === b || (a.length === b.length && a.every((ref, i) => sameRef(ref, b[i]!)));
}

/** The multiple of 90° nearest to `radians`. */
function nearestQuarterTurn(radians: number): number {
    return Math.round(radians / (Math.PI / 2)) * (Math.PI / 2);
}
