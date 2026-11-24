import {
    boundingBox,
    presetFor,
    type Connection,
    type Editor,
    type ElementRef,
    type AreaformDocument,
    type Id,
    type Level,
    type Preset,
} from '@areaform/core';
import {
    screenToWorld,
    type AssetResolver,
    type Camera,
    type Renderer,
    type LabelResolver,
    type StyleResolver,
    type Theme,
    type WheelMode,
} from '@areaform/render-2d';
import {
    Fragment,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { categoryFromText } from '../document/categories.ts';
import type { Translator } from '../i18n/index.ts';
import {
    isOneJobTool,
    type ControllerState,
    type EditorController,
    type PendingDelete,
    type PickableTool,
    type ToolName,
} from '../interaction/controller.ts';
import type { ShapeMode } from '../tools/shape.ts';
import type { OutlineMode } from '../tools/outline.ts';
import {
    ariaKeys,
    detectPlatform,
    formatKeys,
    keysOf,
    latinKey,
    shortcutFor,
    SHORTCUTS,
    type KeyCombo,
    type Platform,
} from '../interaction/shortcuts.ts';
import { parseLength, rulersFor, unitLabel, type DisplayUnits } from '../interaction/units.ts';
import { CategoryList } from './CategoryList.tsx';
import { CommitInput } from './CommitInput.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { lengthFieldLabel, UnitsContext } from './LengthInput.tsx';
import { useControllerState, useDocument, useEditorController } from './hooks.ts';
import { AssetsContext, type AssetUploader } from './assets.ts';
import { ExtendConnections, imageSize, LevelPanel } from './LevelPanel.tsx';
import { LevelSwitcher } from './LevelSwitcher.tsx';
import type { Renderer3D } from '@areaform/render-3d';
import { Canvas3D } from './Canvas3D.tsx';
import { PlanCanvas } from './PlanCanvas.tsx';
import { PlanControls, type ViewMode } from './PlanControls.tsx';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { LanguagesPanel } from './LanguagesPanel.tsx';
import { LocationPanel } from './LocationPanel.tsx';
import { ProblemsPanel, useProblems } from './ProblemsPanel.tsx';
import { ViewpointsPanel } from './ViewpointsPanel.tsx';
import { viewpointMarks } from '../document/viewpoints.ts';
import { HerePrompt, type HereLink } from './HereValue.tsx';
import { fillingInResolver, fillingLanguage } from '../document/contentLanguages.ts';
import { DEFAULT_FOLDED_SECTIONS, Section, type SidebarSection } from './SidebarSection.tsx';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { useViewMode, type ViewModeProps } from './useViewMode.ts';
import { I18nContext, useTranslator, type LocaleProps } from './i18n.ts';

/** What `renderProperties` gets: the selection and where it is, and the Editor to change it with. */
export interface PropertiesContext {
    /** The selected Elements; empty when nothing is selected (the Level's properties are shown). */
    selection: ElementRef[];
    doc: AreaformDocument;
    /** The Level shown. */
    level: Level;
    editor: Editor;
}

/**
 * The 3D view (`view`, `defaultView`, `views`) is a read-only preview: drawing tools wait in 2D,
 * while undo, redo and the panels keep working and show up in 3D straight away.
 */
export interface AreaformEditorProps extends ViewModeProps, LocaleProps {
    /** The core Editor holding the Document and its history; create it with `createEditor`. */
    editor: Editor;
    /**
     * The plan's look in 2D and 3D: category colours and icons, label sizes. Read when the editor
     * mounts.
     */
    theme?: Theme;
    styleResolver?: StyleResolver;
    /**
     * The host's runtime labels, as in the View; the editor shows their logos only, keeping the
     * Document's names, the ones being edited. Keep it stable (`useCallback`).
     */
    labelResolver?: LabelResolver;
    /** Finds Underlay images by their `src`, e.g. files the host holds as `blob:` URLs. */
    resolveAsset?: AssetResolver;
    /**
     * Stores an image file the user picks for a new Underlay and returns its `src`, e.g. an asset
     * id that `resolveAsset` turns into a URL. Adds a file button beside the image URL field.
     */
    uploadAsset?: AssetUploader;
    /**
     * Keeps an image file the user picks on this device instead of uploading it, e.g.
     * `createDeviceAssets().keep`, and returns its `src`. Adds a **Keep on this device** button.
     */
    keepAsset?: AssetUploader;
    /** What scrolling does: `auto` (default) pans on a trackpad and zooms on a pinch or mouse wheel. */
    wheel?: WheelMode;
    /**
     * Display units for lengths and areas (the Document always stores metres). The toolbar can
     * switch them too; a change of this prop switches again.
     */
    units?: DisplayUnits;
    /** Always-on dimensions at the start; the toolbar can toggle them, a change of this prop too. */
    dimensions?: boolean;
    /** Called when the user switches display units in the toolbar, e.g. to remember the choice. */
    onUnitsChange?: (units: DisplayUnits) => void;
    /** Called when the user turns always-on dimensions on or off in the toolbar. */
    onDimensionsChange?: (on: boolean) => void;
    /**
     * The sidebar's sections folded shut at the start (when absent, `DEFAULT_FOLDED_SECTIONS`: all
     * but Properties); a change of this prop folds them again. The user folds and opens them by
     * their headings.
     */
    foldedSections?: SidebarSection[];
    /** Called with the folded sections when the user folds or opens one, e.g. to remember them. */
    onFoldedSectionsChange?: (sections: SidebarSection[]) => void;
    /** The grid drawn over the floor at the start; **Show grid** in the plan's corner toggles it. */
    grid?: boolean;
    /** Called when the user shows or hides the grid. */
    onGridChange?: (on: boolean) => void;
    /**
     * Elements to select, e.g. from the host's own list of problems: a change of this prop selects
     * them, showing their Level first. A Level ref shows that Level and selects nothing (its Outline
     * is not an Element). The user can select something else afterwards.
     */
    selection?: ElementRef[];
    /**
     * The Problems list at the top of the sidebar while there are any (default on): overlaps,
     * things outside the Outline and Zones visitors cannot reach, in words; a click shows the Element.
     */
    problems?: boolean;
    /**
     * Makes a link that opens the published plan with visitors' routes starting at `here` (a value
     * for `?here=`), e.g. for a QR code; shown beside the value in **Here for visitors**.
     */
    hereLink?: HereLink | undefined;
    /** Called with the selection whenever it changes. */
    onSelectionChange?: (selection: ElementRef[]) => void;
    /** Called when the active tool changes (toolbar, shortcut, or a tool ending itself). */
    onToolChange?: (tool: ToolName) => void;
    /** Called when another Level is shown, including when the shown one is deleted or undone away. */
    onLevelChange?: (levelId: Id) => void;
    /** Called once the canvas exists, e.g. to fit or read the camera. */
    onReady?: (renderer: Renderer) => void;
    /** Called with the 3D renderer each time the 3D view is shown and ready. */
    onReady3d?: (renderer: Renderer3D) => void;
    /**
     * The Presets the Space Kind is looked up in, for the Zone Categories suggested and the one the
     * Zone tool starts with; the built-in `defaultPresets` when absent. Read when the editor mounts.
     */
    presets?: Record<string, Preset>;
    /** The tools in the toolbar, in this order; the others' shortcuts do nothing. All when absent. */
    tools?: PickableTool[];
    /**
     * Show the keyboard shortcuts button at the end of the toolbar (default true). The `?` key
     * opens the window either way, and so does `shortcutsOpen`.
     */
    shortcutsButton?: boolean;
    /**
     * Whether the keyboard shortcuts window shows, when the host owns it, e.g. to open it from its
     * own Help menu; pair it with `onShortcutsOpenChange`. The editor's own when absent.
     */
    shortcutsOpen?: boolean;
    /** Called when the user opens or closes the keyboard shortcuts window. */
    onShortcutsOpenChange?: (open: boolean) => void;
    /**
     * Your own fields, shown in the sidebar under the built-in properties, e.g. for a Zone's
     * `data`. Change the Document through `context.editor` so edits are undoable.
     */
    renderProperties?: (context: PropertiesContext) => ReactNode;
}

/** The tool buttons, from the shortcuts' Tools group. */
const TOOLS = SHORTCUTS.flatMap((s) =>
    'action' in s && typeof s.action === 'object'
        ? [{ name: s.action.tool as PickableTool & IconName, label: s.label, keys: s.keys[0]! }]
        : [],
);

/** A button's tooltip and `aria-keyshortcuts` for its keys. */
const withKeys = (
    label: string,
    keys: KeyCombo | undefined,
    platform: Platform,
    i18n: Translator,
) =>
    keys
        ? {
              title: i18n.t('toolbar.withKeys', { label, keys: formatKeys(keys, platform, i18n) }),
              'aria-keyshortcuts': ariaKeys(keys, platform),
          }
        : { title: label };

const NO_SELECTION: ElementRef[] = [];
const SHAPE_TOOLS: ToolName[] = ['zone', 'obstacle', 'connection'];
const CONNECTION_KINDS: Connection['kind'][] = ['stairs', 'elevator', 'escalator', 'ramp'];

/** The embeddable authoring component: canvas, toolbar, Levels and properties (Q28). */
export function AreaformEditor({
    editor,
    theme,
    styleResolver,
    labelResolver,
    resolveAsset,
    uploadAsset,
    keepAsset,
    wheel,
    units = 'metric',
    dimensions = false,
    grid = false,
    onUnitsChange,
    onDimensionsChange,
    onGridChange,
    selection,
    problems: showProblems = true,
    hereLink,
    onSelectionChange,
    onToolChange,
    onLevelChange,
    onReady,
    onReady3d,
    presets,
    tools,
    shortcutsButton = true,
    shortcutsOpen,
    onShortcutsOpenChange,
    defaultView,
    view,
    onViewChange,
    views,
    renderProperties,
    foldedSections,
    onFoldedSectionsChange,
    locale,
    messages,
}: AreaformEditorProps) {
    const i18n = useTranslator({ locale, messages });
    const [folded, setFolded] = useState<SidebarSection[]>(
        foldedSections ?? [...DEFAULT_FOLDED_SECTIONS],
    );
    useEffect(() => {
        if (foldedSections) setFolded(foldedSections);
    }, [foldedSections]);
    const fold = (section: SidebarSection) => () => {
        const next = folded.includes(section)
            ? folded.filter((s) => s !== section)
            : [...folded, section];
        setFolded(next);
        onFoldedSectionsChange?.(next);
    };
    const doc = useDocument(editor);
    const [levelId, setLevelId] = useState<Id>(doc.levels[0]!.id);
    const controller = useEditorController(editor, levelId, presets, theme);
    // Logos only: a runtime name over the one being edited would hide the edit.
    const logos = useMemo<LabelResolver | undefined>(
        () =>
            labelResolver &&
            ((zone, language) => {
                const logo = labelResolver(zone, language)?.logo;
                return logo ? { logo } : undefined;
            }),
        [labelResolver],
    );
    // The language the author is filling in, while the Space offers it; its default otherwise.
    const [wantedLanguage, setWantedLanguage] = useState<string | undefined>(undefined);
    const filling = fillingLanguage(doc.languages, wantedLanguage);
    // On the plan, names in that language: translated ones as they are, the rest faded.
    const planLabels = useMemo(
        () => fillingInResolver(logos, doc.languages, filling),
        [logos, doc.languages, filling],
    );
    useEffect(() => controller?.setLabelResolver(planLabels), [controller, planLabels]);
    const assets = useMemo(
        () => ({ resolveAsset, uploadAsset, keepAsset }),
        [resolveAsset, uploadAsset, keepAsset],
    );
    const state = useControllerState(controller);

    const level = doc.levels.find((l) => l.id === levelId) ?? doc.levels[0]!;

    useEffect(() => {
        if (level.id !== levelId) setLevelId(level.id); // the Level was deleted or undone away
    }, [level.id, levelId]);
    useEffect(() => controller?.setLevel(level.id), [controller, level.id]);
    // An Underlay of unknown size can be neither picked nor resized by its corners: measure the
    // shown Level's ones, each once, instead of waiting for **Measure image**.
    const measured = useRef(new Set<string>());
    useEffect(() => {
        for (const underlay of level.underlays) {
            if (underlay.size || measured.current.has(underlay.id)) continue;
            measured.current.add(underlay.id);
            void imageSize(resolveAsset?.(underlay.src) ?? underlay.src).then(
                (size) =>
                    size &&
                    editor.exec({
                        type: 'underlay.update',
                        levelId: level.id,
                        underlayId: underlay.id,
                        changes: { size },
                    }),
            );
        }
    }, [editor, level, resolveAsset]);
    useEffect(() => controller?.setUnits(units), [controller, units]);
    useEffect(() => controller?.setTranslator(i18n), [controller, i18n]);
    useEffect(() => controller?.setDimensions(dimensions), [controller, dimensions]);
    // What to select: the host's `selection`, or the Elements of a Problem clicked in the list.
    const [wanted, setWanted] = useState(selection);
    useEffect(() => setWanted(selection), [selection]);
    // Selecting waits for the Level switch: showing another Level clears the selection.
    const appliedSelection = useRef<ElementRef[] | undefined>(undefined);
    useEffect(() => {
        if (!controller || !wanted || appliedSelection.current === wanted) return;
        const first = wanted[0];
        const target = first && ('levelId' in first ? first.levelId : first.id);
        if (target && target !== level.id && doc.levels.some((l) => l.id === target)) {
            setLevelId(target);
            return;
        }
        appliedSelection.current = wanted;
        controller.select(wanted.filter((ref) => 'levelId' in ref && ref.levelId === level.id));
    }, [controller, wanted, level.id, doc]);
    const problems = useProblems(doc, presets, showProblems);
    // Follows the tools listed, not the identity of the array.
    const toolList = tools?.join();
    useEffect(() => controller?.setTools(tools), [controller, toolList]);
    const [renderer, setRenderer] = useState<Renderer | null>(null);
    const [renderer3d, setRenderer3d] = useState<Renderer3D | null>(null);
    const mode = useViewMode({
        ...(defaultView && { defaultView }),
        ...(view && { view }),
        ...(onViewChange && { onViewChange }),
        ...(views && { views }),
    });
    const in3d = mode.shown === '3d';
    useEffect(() => controller?.setView(mode.shown), [controller, mode.shown]);
    const platform = useMemo(detectPlatform, []);
    const root = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    // The Level's Viewpoints as numbered camera marks over the tool's own overlay.
    const overlay = useMemo(() => {
        const marks = viewpointMarks(level, markSize(level));
        return marks.length > 0 ? [...(state?.overlay ?? []), ...marks] : state?.overlay;
    }, [level, state?.overlay]);
    const showShortcuts = shortcutsOpen ?? state?.shortcutsOpen ?? false;
    // A host that owns the window gets the user's request reported, and the controller follows
    // its prop again, so keys are blocked exactly while the window shows. Following it is not
    // reported back as the user's doing.
    const followingProp = useRef(false);
    useLayoutEffect(() => {
        if (!controller || shortcutsOpen === undefined) return;
        followingProp.current = true;
        if (shortcutsOpen) controller.openShortcuts();
        else controller.closeShortcuts();
        followingProp.current = false;
    }, [controller, shortcutsOpen, state?.shortcutsOpen]);
    const wasShown = useRef(showShortcuts);
    useEffect(() => {
        if (wasShown.current && !showShortcuts) root.current?.focus(); // keys go back to the editor
        wasShown.current = showShortcuts;
    }, [showShortcuts]);
    useEffect(() => {
        if (!in3d) return setRenderer3d(null);
        // Drop any half-drawn shape: tools cannot be used while the plan is not shown.
        if (!controller) return;
        const { tool } = controller.getState();
        controller.setTool(isOneJobTool(tool) ? 'select' : tool);
    }, [in3d, controller]);
    const [showGrid, setShowGrid] = useState(grid);
    useEffect(() => setShowGrid(grid), [grid]);
    const toggleGrid = () => {
        setShowGrid(!showGrid);
        onGridChange?.(!showGrid);
    };
    // Rulers come with the grid; the origin mark too, and also while drawing.
    const shownUnits = state?.units ?? units;
    const rulers = useMemo(
        () => (showGrid ? rulersFor(shownUnits, i18n) : null),
        [showGrid, shownUnits, i18n],
    );
    const origin = showGrid || (state?.tool ?? 'select') !== 'select';
    const callbacks = useRef({
        onSelectionChange,
        onToolChange,
        onLevelChange,
        onShortcutsOpenChange,
    });
    callbacks.current = { onSelectionChange, onToolChange, onLevelChange, onShortcutsOpenChange };
    useEffect(() => {
        if (!controller) return;
        const offs = [
            controller.on('selectionChange', (refs) => callbacks.current.onSelectionChange?.(refs)),
            controller.on('toolChange', (tool) => callbacks.current.onToolChange?.(tool)),
            controller.on('levelChange', (id) => callbacks.current.onLevelChange?.(id)),
            controller.on('shortcutsChange', (open) => {
                if (!followingProp.current) callbacks.current.onShortcutsOpenChange?.(open);
            }),
        ];
        return () => offs.forEach((off) => off());
    }, [controller]);

    const inField = (target: EventTarget) =>
        (target as HTMLElement).closest('input, select, textarea') !== null;
    const onKeyDown = (e: KeyboardEvent) => {
        if (inField(e.target)) return;
        const input = { key: e.key, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, code: e.code };
        const wasOpen = controller?.getState().shortcutsOpen;
        // Copy, cut and paste go through the browser's clipboard events below instead, so the
        // selection reaches the system clipboard (other tabs and Documents).
        const clipboard = shortcutFor(latinKey(input))?.action;
        if (!wasOpen && (clipboard === 'copy' || clipboard === 'cut' || clipboard === 'paste'))
            return;
        if (controller?.keyDown(input)) e.preventDefault();
    };
    const onCopyOrCut = (e: ClipboardEvent, cut: boolean) => {
        if (!controller || inField(e.target)) return;
        if (!(cut ? controller.cut() : controller.copy())) return;
        e.clipboardData.setData('text/plain', controller.clipboardText()!);
        e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
        if (!controller || inField(e.target)) return;
        if (controller.pasteText(e.clipboardData.getData('text/plain'))) e.preventDefault();
    };

    return (
        <I18nContext.Provider value={i18n}>
            <AssetsContext.Provider value={assets}>
                <UnitsContext.Provider value={state?.units ?? units}>
                    <div
                        ref={root}
                        className="af-editor"
                        tabIndex={0}
                        onKeyDown={onKeyDown}
                        onCopy={(e) => onCopyOrCut(e, false)}
                        onCut={(e) => onCopyOrCut(e, true)}
                        onPaste={onPaste}
                    >
                        {controller && state && (
                            <Toolbar
                                controller={controller}
                                state={state}
                                editor={editor}
                                onUnitsChange={onUnitsChange}
                                onDimensionsChange={onDimensionsChange}
                                preset={presetFor(doc.kind, presets)}
                                tools={tools}
                                view={mode.shown}
                                platform={platform}
                                shortcutsButton={shortcutsButton}
                                i18n={i18n}
                            />
                        )}
                        {/* The canvas inherits the tool's cursor; the renderer sets its own while panning. */}
                        <div
                            ref={stage}
                            className="af-stage"
                            style={
                                state?.cursor && mode.shown === '2d'
                                    ? { cursor: state.cursor }
                                    : undefined
                            }
                        >
                            <PlanCanvas
                                doc={doc}
                                levelId={level.id}
                                interaction="edit"
                                theme={theme}
                                wheel={wheel}
                                grid={showGrid}
                                rulers={rulers}
                                origin={origin}
                                styleResolver={styleResolver}
                                labelResolver={planLabels}
                                resolveAsset={resolveAsset}
                                highlight={state?.selection}
                                overlay={overlay}
                                // Covered by the 3D view: edits still reach it, drawn on return.
                                paused={in3d}
                                onPointerDown={(e) => controller?.pointerDown(e)}
                                onPointerMove={(e) => controller?.pointerMove(e)}
                                onPointerUp={(e) => controller?.pointerUp(e)}
                                onCameraChange={(camera) => {
                                    controller?.setZoom(camera.zoom);
                                    controller?.setVisibleArea(visibleArea(camera));
                                }}
                                onReady={(r) => {
                                    setRenderer(r);
                                    onReady?.(r);
                                }}
                            />
                            {in3d && (
                                <Canvas3D
                                    doc={doc}
                                    levelId={level.id}
                                    theme={theme}
                                    labelResolver={planLabels}
                                    highlight={state?.selection}
                                    // The plan is edited in 2D; a click in 3D selects, to edit there.
                                    onElementClick={(e) => controller?.select([e.ref])}
                                    onBackgroundClick={() => controller?.select([])}
                                    camera={mode.camera.current}
                                    onCameraChange={(c) => (mode.camera.current = c)}
                                    onReady={(r) => {
                                        setRenderer3d(r);
                                        onReady3d?.(r);
                                    }}
                                />
                            )}
                            <PlanControls
                                view={mode.shown}
                                onViewChange={mode.change}
                                canShow3d={mode.canShow3d}
                                grid={showGrid}
                                onToggleGrid={toggleGrid}
                                onViewAngle={(angle) => renderer3d?.setView(angle)}
                                onFit={() => (in3d ? renderer3d?.fitLevel() : renderer?.fitLevel())}
                            />
                            {state?.message && <div className="af-toast">{state.message}</div>}
                            {controller && state?.calibration && (
                                <CalibrationPrompt controller={controller} state={state} />
                            )}
                            {controller && state?.herePick && (
                                <HerePrompt
                                    controller={controller}
                                    levelId={level.id}
                                    pick={state.herePick}
                                    link={hereLink}
                                />
                            )}
                            {controller && state?.pendingDelete && (
                                <DeleteConfirm
                                    pending={state.pendingDelete}
                                    controller={controller}
                                    i18n={i18n}
                                />
                            )}
                        </div>
                        {controller && showShortcuts && (
                            <ShortcutsDialog
                                platform={platform}
                                view={mode.shown}
                                tools={tools}
                                canShow3d={mode.canShow3d}
                                onClose={() => controller.closeShortcuts()}
                            />
                        )}
                        <aside className="af-sidebar">
                            {/* What is being worked on first: Problems, then the selection (or the
                                Level), then the Levels; the plan-wide settings below. All but Problems fold. */}
                            {showProblems && problems.length > 0 && (
                                <Section
                                    title={i18n.t('sidebar.problems')}
                                    after={<span className="af-count">{problems.length}</span>}
                                >
                                    <ProblemsPanel
                                        doc={doc}
                                        problems={problems}
                                        onShow={(problem) =>
                                            setWanted(
                                                'other' in problem
                                                    ? [problem.ref, problem.other]
                                                    : [problem.ref],
                                            )
                                        }
                                    />
                                </Section>
                            )}
                            {controller && state?.extendOffer?.copyId === level.id && (
                                <ExtendConnections
                                    editor={editor}
                                    controller={controller}
                                    doc={doc}
                                    offer={state.extendOffer}
                                />
                            )}
                            <Section
                                title={i18n.t('sidebar.properties')}
                                open={!folded.includes('properties')}
                                onToggle={fold('properties')}
                            >
                                {(state?.selection.length ?? 0) > 0 ? (
                                    <PropertiesPanel
                                        editor={editor}
                                        controller={controller}
                                        doc={doc}
                                        level={level}
                                        selection={state!.selection}
                                        presets={presets}
                                        filling={filling}
                                        hereLink={hereLink}
                                    />
                                ) : (
                                    controller && (
                                        <LevelPanel
                                            editor={editor}
                                            controller={controller}
                                            doc={doc}
                                            onSelectLevel={setLevelId}
                                            level={level}
                                            filling={filling}
                                        />
                                    )
                                )}
                                {renderProperties && (
                                    <div className="af-host-properties">
                                        {renderProperties({
                                            selection: state?.selection ?? NO_SELECTION,
                                            doc,
                                            level,
                                            editor,
                                        })}
                                    </div>
                                )}
                            </Section>
                            <Section
                                title={i18n.t('sidebar.levels')}
                                open={!folded.includes('levels')}
                                onToggle={fold('levels')}
                            >
                                <LevelSwitcher
                                    doc={doc}
                                    currentId={level.id}
                                    onSelect={setLevelId}
                                    onAdd={(at) => {
                                        const group = doc.levels.filter(
                                            (l) => l.group === level.group,
                                        );
                                        const basements = group.filter((l) => l.ordinal < 0).length;
                                        editor.exec({
                                            type: 'level.add',
                                            name:
                                                at === 'bottom'
                                                    ? i18n.t('level.basementName', {
                                                          number: basements + 1,
                                                      })
                                                    : i18n.t('level.defaultName', {
                                                          number: doc.levels.length + 1,
                                                      }),
                                            at,
                                            ...(level.group !== undefined && {
                                                group: level.group,
                                            }),
                                        });
                                    }}
                                    onMove={(levelId, direction, steps) => {
                                        const tx = editor.begin();
                                        for (let i = 0; i < steps; i++) {
                                            tx.exec({ type: 'level.move', levelId, direction });
                                        }
                                        tx.commit();
                                    }}
                                />
                            </Section>
                            <Section
                                title={i18n.t('sidebar.viewpoints')}
                                open={!folded.includes('viewpoints')}
                                onToggle={fold('viewpoints')}
                            >
                                <ViewpointsPanel
                                    editor={editor}
                                    level={level}
                                    renderer3d={in3d ? renderer3d : null}
                                    stage={stage}
                                />
                            </Section>
                            <Section
                                title={i18n.t('sidebar.languages')}
                                open={!folded.includes('languages')}
                                onToggle={fold('languages')}
                            >
                                <LanguagesPanel
                                    editor={editor}
                                    doc={doc}
                                    filling={filling}
                                    onFilling={setWantedLanguage}
                                />
                            </Section>
                            <Section
                                title={i18n.t('sidebar.location')}
                                open={!folded.includes('location')}
                                onToggle={fold('location')}
                            >
                                <LocationPanel editor={editor} doc={doc} />
                            </Section>
                        </aside>
                    </div>
                </UnitsContext.Provider>
            </AssetsContext.Provider>
        </I18nContext.Provider>
    );
}

/**
 * The category the Zone tool gives new Zones: one the Preset suggests, or any other typed in.
 * It applies as typed, so the next Zone drawn gets it without leaving the field first.
 */
function ZoneCategoryInput({
    controller,
    state,
    preset,
}: {
    controller: EditorController;
    state: ControllerState;
    preset: Preset;
}) {
    const suggestions = useId();
    const i18n = state.i18n;
    const [draft, setDraft] = useState(state.zoneCategory ?? '');
    // Show a category set elsewhere, but keep "Meeting room" as typed rather than its id.
    useEffect(() => {
        if (categoryFromText(preset, draft, i18n) !== state.zoneCategory)
            setDraft(state.zoneCategory ?? '');
    }, [state.zoneCategory]);
    return (
        <>
            <input
                className="af-input af-category-input"
                aria-label={i18n.t('toolbar.zoneCategory')}
                placeholder={i18n.t('toolbar.noCategory')}
                list={suggestions}
                value={draft}
                onChange={(e) => {
                    setDraft(e.target.value);
                    controller.setZoneCategory(categoryFromText(preset, e.target.value, i18n));
                }}
            />
            <CategoryList id={suggestions} preset={preset} />
        </>
    );
}

function Toolbar({
    controller,
    state,
    editor,
    onUnitsChange,
    onDimensionsChange,
    preset,
    tools,
    view,
    platform,
    shortcutsButton,
    i18n,
}: {
    controller: EditorController;
    state: ControllerState;
    editor: Editor;
    onUnitsChange: ((units: DisplayUnits) => void) | undefined;
    onDimensionsChange: ((on: boolean) => void) | undefined;
    preset: Preset;
    tools: PickableTool[] | undefined;
    view: ViewMode;
    platform: Platform;
    shortcutsButton: boolean;
    i18n: Translator;
}) {
    const shown = tools ? tools.map((name) => TOOLS.find((t) => t.name === name)!) : TOOLS;
    const undo = i18n.t('toolbar.undo');
    const redo = i18n.t('toolbar.redo');
    const shortcuts = i18n.t('toolbar.shortcuts');
    const shapeOption =
        SHAPE_TOOLS.includes(state.tool) ||
        (state.tool === 'outline' && state.outlineMode === 'hole');
    const options =
        state.tool === 'outline' ||
        shapeOption ||
        state.tool === 'zone' ||
        state.tool === 'connection';
    return (
        <div className="af-toolbar" role="toolbar">
            {/* The tools in one tray, a thin line between picking, drawing and measuring. */}
            <span className="af-tool-tray">
                {shown.map((t, i) => {
                    const label = i18n.t(t.label);
                    const divided = i > 0 && toolGroup(shown[i - 1]!.name) !== toolGroup(t.name);
                    return (
                        <Fragment key={t.name}>
                            {divided && <span className="af-toolbar-divider" aria-hidden="true" />}
                            <button
                                className="af-button af-icon-button"
                                aria-label={label}
                                aria-pressed={state.tool === t.name}
                                disabled={view === '3d'}
                                {...(view === '3d'
                                    ? { title: i18n.t('toolbar.switchTo2d', { tool: label }) }
                                    : withKeys(label, t.keys, platform, i18n))}
                                onClick={() => controller.setTool(t.name)}
                            >
                                <Icon name={t.name} />
                            </button>
                        </Fragment>
                    );
                })}
            </span>
            {/* What the picked tool draws: a group of its own, so it does not read as more tools. */}
            {options && (
                <span className="af-tool-options">
                    {state.tool === 'outline' && (
                        <span className="af-segmented">
                            {(['edit', 'hole'] as OutlineMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    className="af-button"
                                    aria-pressed={state.outlineMode === mode}
                                    onClick={() => controller.setOutlineMode(mode)}
                                >
                                    {i18n.t(
                                        mode === 'edit' ? 'toolbar.editCorners' : 'toolbar.addHole',
                                    )}
                                </button>
                            ))}
                        </span>
                    )}
                    {shapeOption && (
                        <select
                            className="af-input"
                            aria-label={i18n.t('toolbar.shape')}
                            value={state.shapeMode}
                            onChange={(e) => controller.setShapeMode(e.target.value as ShapeMode)}
                        >
                            <option value="rectangle">{i18n.t('toolbar.rectangle')}</option>
                            <option value="polygon">{i18n.t('toolbar.polygon')}</option>
                        </select>
                    )}
                    {state.tool === 'zone' && (
                        <ZoneCategoryInput controller={controller} state={state} preset={preset} />
                    )}
                    {state.tool === 'connection' && (
                        <select
                            className="af-input"
                            aria-label={i18n.t('toolbar.connectionKind')}
                            value={state.connectionKind}
                            onChange={(e) =>
                                controller.setConnectionKind(e.target.value as Connection['kind'])
                            }
                        >
                            {CONNECTION_KINDS.map((k) => (
                                <option key={k} value={k}>
                                    {i18n.t(`connectionKind.${k}`)}
                                </option>
                            ))}
                        </select>
                    )}
                </span>
            )}
            <span className="af-spacer" />
            <span className="af-toolbar-group">
                <select
                    className="af-input"
                    aria-label={i18n.t('toolbar.units')}
                    value={state.units}
                    onChange={(e) => {
                        controller.setUnits(e.target.value as DisplayUnits);
                        onUnitsChange?.(e.target.value as DisplayUnits);
                    }}
                >
                    <option value="metric">{i18n.t('unit.m')}</option>
                    <option value="imperial">{i18n.t('unit.ft')}</option>
                </select>
                <button
                    className="af-button af-icon-button"
                    aria-label={i18n.t('toolbar.dimensions')}
                    aria-pressed={state.dimensions}
                    title={i18n.t('toolbar.dimensionsTitle')}
                    onClick={() => {
                        controller.setDimensions(!state.dimensions);
                        onDimensionsChange?.(!state.dimensions);
                    }}
                >
                    <Icon name="dimensions" />
                </button>
            </span>
            <span className="af-toolbar-divider" aria-hidden="true" />
            <span className="af-toolbar-group">
                <button
                    className="af-button af-icon-button"
                    aria-label={undo}
                    {...withKeys(undo, keysOf('undo'), platform, i18n)}
                    onClick={() => editor.undo()}
                >
                    <Icon name="undo" />
                </button>
                <button
                    className="af-button af-icon-button"
                    aria-label={redo}
                    {...withKeys(redo, keysOf('redo'), platform, i18n)}
                    onClick={() => editor.redo()}
                >
                    <Icon name="redo" />
                </button>
            </span>
            {shortcutsButton && (
                <>
                    <span className="af-toolbar-divider" aria-hidden="true" />
                    <button
                        className="af-button af-icon-button"
                        aria-label={shortcuts}
                        aria-haspopup="dialog"
                        {...withKeys(shortcuts, keysOf('shortcuts'), platform, i18n)}
                        onClick={() => controller.openShortcuts()}
                    >
                        <Icon name="keyboard" />
                    </button>
                </>
            )}
        </div>
    );
}

/** Which part of the tool tray a tool sits in: picking, drawing or measuring. */
const toolGroup = (tool: PickableTool) =>
    tool === 'select' ? 'pick' : tool === 'ruler' ? 'measure' : 'draw';

function CalibrationPrompt({
    controller,
    state,
}: {
    controller: EditorController;
    state: ControllerState;
}) {
    const { i18n, units } = state;
    const points = state.calibration?.points.length ?? 0;
    const [straighten, setStraighten] = useState(false);
    const distance = i18n.t('calibrate.distance');
    return (
        <div className="af-modal" role="dialog" aria-label={i18n.t('calibrate.title')}>
            {points < 2 ? (
                <p>{i18n.t('calibrate.clickPoints', { points })}</p>
            ) : (
                <label className="af-buttons">
                    {i18n.t('length.caption', { name: distance, unit: unitLabel(units, i18n) })}
                    <CommitInput
                        inputMode="decimal"
                        value=""
                        aria-label={lengthFieldLabel(i18n, distance, units)}
                        onCommit={(v) => {
                            const metres = parseLength(v, units);
                            if (metres !== undefined && metres > 0)
                                controller.finishCalibration(metres, { straighten });
                        }}
                    />
                </label>
            )}
            <label className="af-buttons" title={i18n.t('calibrate.straightenTitle')}>
                <input
                    type="checkbox"
                    checked={straighten}
                    onChange={(e) => setStraighten(e.target.checked)}
                />
                {i18n.t('calibrate.straighten')}
            </label>
            <div className="af-buttons">
                <button className="af-button" onClick={() => controller.setTool('select')}>
                    {i18n.t('common.cancel')}
                </button>
            </div>
        </div>
    );
}

function DeleteConfirm({
    pending,
    controller,
    i18n,
}: {
    pending: PendingDelete;
    controller: EditorController;
    i18n: Translator;
}) {
    const counts = new Map<ElementRef['kind'], number>();
    for (const ref of pending.extra) counts.set(ref.kind, (counts.get(ref.kind) ?? 0) + 1);
    const list = [...counts]
        .map(([kind, count]) => i18n.t(`count.${kind}`, { count }))
        .join(i18n.t('common.listSeparator'));
    return (
        <div className="af-modal" role="alertdialog" aria-labelledby="af-delete-title">
            <h2 id="af-delete-title" className="af-heading">
                {i18n.t('delete.title')}
            </h2>
            <p>{i18n.t('delete.alsoDeletes', { list })}</p>
            <div className="af-buttons">
                <button
                    className="af-button af-danger"
                    onClick={() => controller.confirmDelete()}
                    autoFocus
                >
                    {i18n.t('common.delete')}
                </button>
                <button className="af-button" onClick={() => controller.cancelDelete()}>
                    {i18n.t('common.cancel')}
                </button>
            </div>
        </div>
    );
}

/** The plan area (metres) the camera shows. */
function visibleArea(camera: Camera) {
    const [minX, maxY] = screenToWorld(camera, [0, 0]);
    const [maxX, minY] = screenToWorld(camera, [camera.viewport.width, camera.viewport.height]);
    return { minX, minY, maxX, maxY };
}

/** A camera mark's wedge: about 3% of the Level across, so it reads on a café and on a hall. */
function markSize(level: Level): number {
    const box = boundingBox(level.outline.outer);
    return Math.max(1, Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.03);
}
