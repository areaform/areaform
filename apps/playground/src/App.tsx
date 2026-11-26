import {
    createEditor,
    diagnose,
    fromJSON,
    toGeoJSON,
    toJSON,
    type Editor,
    type ElementRef,
    type AreaformDocument,
    type Zone,
} from '@areaform/core';
import { CreateSpaceForm, AreaformEditor, Icon, useDocument } from '@areaform/editor/react';
import type { PluginSource } from '@areaform/view';
import { AreaformView } from '@areaform/view/react';
import {
    createDeviceAssets,
    describeLoadErrors as whyNotLoaded,
    LOCALE_NAMES,
    LOCALES,
    relativeSources,
    sortDraftFiles,
    type BuiltInLocale,
} from '@areaform/editor';
import { stressSpace } from '@areaform/core/testing';
import {
    worldToScreen,
    type AssetResolver,
    type Renderer,
    type StyleResolver,
} from '@areaform/render-2d';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logo from '../../../brand/favicon.svg';
import { browserAssetStore } from './assetStore.ts';
import { compactJSON } from './compactJSON.ts';
import { Menu, MenuSeparator } from './Menu.tsx';
import { ReviewPanel } from './ReviewPanel.tsx';
import { Toast } from './Toast.tsx';
import { sampleExpo } from './sampleExpo.ts';
import { sampleOffice } from './sampleOffice.ts';
import { demoLabels, demoTheme } from './demoTheme.ts';
import { createStore, type KeyValueStorage, type Prefs } from './storage.ts';

type Demo = 'expo' | 'office' | 'stress';

// In the order of the demo buttons: the Office first, as the plan the playground opens with.
const DEMO_NAMES: Record<Demo, string> = { office: 'Office', expo: 'Expo', stress: 'Stress' };
/** What each demo shows, beside its name in the Demos menu. */
const DEMO_HINTS: Record<Demo, string> = {
    office: 'Three Levels and a camera tour',
    expo: 'A hall with 40 booths',
    stress: '5,000 booths, 10,000 Walls',
};

const isDemo = (name: string | null): name is Demo => name !== null && name in DEMO_NAMES;

const STATUS_COLOURS: Record<string, string> = {
    available: '#bfe5c0',
    reserved: '#ffe08a',
    sold: '#c9c9c9',
};

/** Booth status from the Zone's client data, as a host would colour it from its own backend. */
const statusResolver: StyleResolver = (ref, element) => {
    if (ref.kind !== 'zone') return undefined;
    const status = (element as Zone).data?.status;
    const fill = typeof status === 'string' ? STATUS_COLOURS[status] : undefined;
    return fill ? { fill } : undefined;
};

function demo(name: Demo): AreaformDocument {
    if (name === 'expo') return sampleExpo();
    if (name === 'office') return sampleOffice();
    return stressSpace({ booths: 5000, walls: 10000 });
}

/**
 * The View's Plugins, imported only when the View starts: the tooltip card, and Wayfinding with
 * Here from `?here=` (a Zone's id, or `<levelId>:<x>,<y>`) and a place to show from `?to=`.
 */
const VIEW_PLUGINS: PluginSource[] = [
    { load: () => import('@areaform/view/plugins/tooltip').then((m) => m.tooltip()) },
    {
        load: () =>
            import('@areaform/view/plugins/wayfinding').then((m) =>
                m.wayfinding({
                    ...(params.get('here') && { here: params.get('here')! }),
                    ...(params.get('to') && { to: params.get('to')! }),
                }),
            ),
    },
];

/** The playground's own visitor view, with routes starting at `here`: a link for a QR code. */
const hereLink = (here: string) =>
    `${location.origin}${location.pathname}?here=${encodeURIComponent(here)}`;

/** Wait after the last change before autosaving, so a drag is saved once, not every frame. */
const AUTOSAVE_DELAY_MS = 500;

/**
 * With `?e2e=1`, end-to-end tests get the live Document and a plan → page coordinate mapping,
 * so they can click at plan positions and check the real data rather than pixels.
 */
function exposeForTests(getDocument: () => AreaformDocument, renderer: Renderer) {
    if (params.get('e2e') !== '1') return;
    editorEvents.length = 0;
    Object.assign(globalThis, {
        __fp: {
            getDocument,
            events: () => [...editorEvents],
            assets: () => [...shownAssets.keys()],
            toPage: (point: [number, number]) => {
                const canvas = document.querySelector('.af-canvas canvas, .af-view canvas');
                const rect = canvas!.getBoundingClientRect();
                const [x, y] = worldToScreen(renderer.getCamera(), point);
                return { x: rect.left + x, y: rect.top + y };
            },
            camera3d: () => shown3d?.getCamera() ?? null,
            toPage3d: (point: [number, number], height = 0) => {
                const canvas = document.querySelector('.af-canvas-3d canvas');
                const at = shown3d?.toScreen(point, height);
                if (!canvas || !at) return null;
                const rect = canvas.getBoundingClientRect();
                return { x: rect.left + at[0], y: rect.top + at[1] };
            },
        },
    });
}

/** The 3D renderer while one is shown, for `toPage3d` and `camera3d`. */
let shown3d: {
    toScreen(point: [number, number], height?: number): [number, number] | null;
    getCamera(): { position: number[]; target: number[] };
} | null = null;

/**
 * The editor's tool, Level and selection events as `tool:wall`, `level:<id>`, `selection:2`, and
 * the View's clicks and hovers with their canvas position as `click:A-1@120,80`.
 */
const editorEvents: string[] = [];
const logEvent = (event: string) => {
    if (params.get('e2e') === '1') editorEvents.push(event);
};

// `?mode=edit`, `?sample=stress` and `?status=1` open a given state directly (handy for
// screenshots and e2e tests); `?sample=` opens a demo without touching the saved plan.
const params = new URLSearchParams(globalThis.location?.search);

/** localStorage, or an in-memory stand-in where the browser blocks it. */
function browserStorage(): KeyValueStorage {
    try {
        return globalThis.localStorage;
    } catch {
        const items = new Map<string, string>();
        return {
            getItem: (key) => items.get(key) ?? null,
            setItem: (key, value) => void items.set(key, value),
        };
    }
}

const store = createStore(browserStorage());
const assetStore = browserAssetStore();
/** Underlay images picked with **Keep on this device** (ADR-0016), in this browser only. */
const deviceAssets = createDeviceAssets('areaform-playground-device');
const underlaySources = (doc: AreaformDocument) =>
    doc.levels.flatMap((l) => l.underlays.map((u) => u.src));
/** The images the plan shows now, by name, for the test hook. */
let shownAssets: ReadonlyMap<string, string> = new Map();

interface Startup {
    doc: AreaformDocument;
    /** What is in storage as far as saving goes; autosave writes only once the plan differs. */
    stored: AreaformDocument | null;
    canRevert: boolean;
    notice: string | null;
}

/** The saved plan if it loads, otherwise the Office demo, keeping an unreadable saved copy. */
function startup(): Startup {
    const sample = params.get('sample');
    if (isDemo(sample)) {
        const doc = demo(sample);
        return { doc, stored: doc, canRevert: false, notice: null };
    }
    const saved = store.loadDocument();
    if (saved.status === 'loaded') {
        return { doc: saved.doc, stored: saved.doc, canRevert: true, notice: null };
    }
    const doc = demo('office');
    if (saved.status === 'unreadable') {
        const notice = `${saved.message} The Office demo is open; the saved copy is kept until you change something.`;
        return { doc, stored: doc, canRevert: false, notice };
    }
    return { doc, stored: null, canRevert: false, notice: null };
}

interface Confirmation {
    message: string;
    action: string;
    run: () => void;
}

export function App() {
    const [initial] = useState(startup);
    const [editor, setEditor] = useState<Editor>(() => createEditor(initial.doc));
    /** Bumped whenever the plan is replaced, so the editor and viewer start afresh. */
    const [generation, setGeneration] = useState(0);
    const doc = useDocument(editor);
    /** The plan as last loaded or saved: anything else is an unsaved change. */
    const [base, setBase] = useState(initial.doc);
    const [stored, setStored] = useState(initial.stored);
    const [canRevert, setCanRevert] = useState(initial.canRevert);
    const [prefs, setPrefs] = useState<Prefs>(() => {
        const saved = store.loadPrefs();
        const mode = params.get('mode');
        return mode === 'edit' || mode === 'view' ? { ...saved, mode } : saved;
    });
    const [paused, setPaused] = useState(false);
    const [creating, setCreating] = useState(false);
    const [shortcuts, setShortcuts] = useState(false);
    // The window belongs to the editor shown; a new one, or none, starts with it closed.
    useEffect(() => setShortcuts(false), [prefs.mode, creating, generation]);
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [notice, setNotice] = useState<string | null>(initial.notice);
    const closeNotice = useCallback(() => setNotice(null), []);
    const fileInput = useRef<HTMLInputElement>(null);
    const folderInput = useRef<HTMLInputElement>(null);
    /**
     * Images imported with the plan, as `blob:` URLs by file name, for Underlays whose `src` names
     * a file next to the plan (a Draft folder). The Document keeps the relative names.
     */
    const [assets, setAssets] = useState<ReadonlyMap<string, string>>(new Map());
    useEffect(() => {
        shownAssets = assets;
        return () => assets.forEach((url) => URL.revokeObjectURL(url));
    }, [assets]);
    /** Bumped once a plan's device images are read back, so the plan looks them up again. */
    const [deviceRead, setDeviceRead] = useState(0);
    const readDeviceAssets = (target: AreaformDocument) =>
        void deviceAssets.load(underlaySources(target)).then(() => setDeviceRead((n) => n + 1));
    const resolveAsset = useMemo(
        () => (src: string) => deviceAssets.url(src) ?? assets.get(src) ?? src,
        // `deviceRead` is not read, but a new function makes the plan resolve its images again.
        [assets, deviceRead],
    );
    /** Elements to select in the editor, from the Review import list. */
    const [reviewSelection, setReviewSelection] = useState<ElementRef[] | undefined>(undefined);
    // Asked once: an editor shown again (after View or the create dialog) starts afresh.
    const editorShown = prefs.mode === 'edit' && !creating;
    useEffect(() => {
        if (!editorShown) setReviewSelection(undefined);
    }, [editorShown]);

    const unsaved = doc !== base;
    const autosaving = prefs.autosave && !paused;

    const setPref = (changes: Partial<Prefs>) => {
        setPrefs((current) => {
            const next = { ...current, ...changes };
            store.savePrefs(next);
            return next;
        });
    };

    const save = (current: AreaformDocument, automatic: boolean) => {
        const result = store.saveDocument(current);
        if (result.ok) {
            setStored(current);
            setBase(current);
            setCanRevert(true);
            setPaused(false);
            if (!automatic) setNotice('Saved.');
            return;
        }
        setNotice(
            result.reason === 'full'
                ? 'This plan is too big to save in the browser; use Export.'
                : 'The browser would not save the plan; use Export.',
        );
        if (automatic) setPaused(true);
    };

    useEffect(() => {
        if (!autosaving || doc === stored) return;
        const timer = setTimeout(() => save(doc, true), AUTOSAVE_DELAY_MS);
        return () => clearTimeout(timer);
        // `save` reads the plan from its argument and only calls setters, so it is not a dependency.
    }, [doc, stored, autosaving]);

    // Leaving the page: autosave writes what is still waiting; otherwise unsaved changes get the
    // browser's "Leave site?" prompt. The page can go right after an edit, before effects catch
    // up, so the listener reads the live Document rather than the last render's.
    const latest = useRef({ editor, base, stored, autosaving });
    latest.current = { editor, base, stored, autosaving };
    useEffect(() => {
        const leave = (e: BeforeUnloadEvent) => {
            const { editor, base, stored, autosaving } = latest.current;
            const current = editor.getDocument();
            if (current === stored) return;
            if (autosaving && store.saveDocument(current).ok) return;
            if (current !== base) e.preventDefault();
        };
        addEventListener('beforeunload', leave);
        return () => removeEventListener('beforeunload', leave);
    }, []);

    /**
     * Shows the images kept for a plan whose Underlays name files (a Draft imported earlier),
     * once they are read back, unless another plan has been opened meanwhile.
     */
    const restoreAssets = (target: AreaformDocument) => {
        const names = relativeSources(target);
        if (names.length === 0) return;
        void assetStore.load(target.id).then(
            (files) => {
                if (latest.current.editor.getDocument().id !== target.id) return;
                const found = names.filter((name) => files.has(name));
                if (found.length === 0) return;
                setAssets(
                    new Map(found.map((name) => [name, URL.createObjectURL(files.get(name)!)])),
                );
            },
            () => {
                // Unreadable storage leaves the Underlay blank, as before images were kept.
            },
        );
    };
    useEffect(() => {
        restoreAssets(initial.doc);
        readDeviceAssets(initial.doc);
    }, []);

    /** Swaps in another plan, asking first when that would lose unsaved changes. */
    const replace = (
        next: AreaformDocument,
        message: string,
        action: string,
        then?: () => void,
    ) => {
        const run = () => {
            setEditor(createEditor(next));
            setGeneration((n) => n + 1);
            setBase(next);
            setAssets(new Map());
            readDeviceAssets(next);
            setReviewSelection(undefined);
            then?.();
        };
        if (unsaved) setConfirmation({ message, action, run });
        else run();
    };
    const loadDemo = (name: Demo) =>
        replace(
            demo(name),
            `Replace the current plan with the ${DEMO_NAMES[name]} demo? Your unsaved changes will be lost; Export first to keep a copy.`,
            'Replace',
        );
    const revert = () => {
        const saved = store.loadDocument();
        if (saved.status !== 'loaded') return setNotice('There is no saved plan to go back to.');
        replace(
            saved.doc,
            'Throw away your unsaved changes and go back to the saved plan?',
            'Revert',
            () => {
                setStored(saved.doc);
                restoreAssets(saved.doc);
            },
        );
    };
    const download = (text: string, extension: string, type: string) => {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${doc.name || 'areaform'}.${extension}`;
        link.click();
        URL.revokeObjectURL(url);
    };
    const exportFile = () => download(toJSON(doc), 'json', 'application/json');
    const exportGeoJSON = () =>
        download(JSON.stringify(toGeoJSON(doc)), 'geojson', 'application/geo+json');
    /** Imports a plan, with the images its Underlays name, e.g. a Draft folder from the MCP import. */
    const importFiles = async (files: File[]) => {
        const sorted = sortDraftFiles(files);
        if ('error' in sorted) return setNotice(`Could not import: ${sorted.error}.`);
        const { plan, images } = sorted;
        const loaded = fromJSON(await plan.text(), { repair: true });
        if (!loaded.ok)
            return setNotice(`Could not import ${plan.name}. ${whyNotLoaded(loaded.errors)}`);
        const missing = relativeSources(loaded.doc).filter((name) => !images.has(name));
        const notes = [
            loaded.repairs.length > 0 && `${loaded.repairs.length} broken element(s) removed`,
            missing.length > 0 &&
                `${missing.join(', ')} not found next to the plan, so its Underlay stays blank; import the whole folder`,
        ].filter(Boolean);
        replace(
            loaded.doc,
            `Replace the current plan with ${plan.name}? Your unsaved changes will be lost.`,
            'Replace',
            () => {
                const used = relativeSources(loaded.doc).filter((name) => images.has(name));
                setAssets(
                    new Map(used.map((name) => [name, URL.createObjectURL(images.get(name)!)])),
                );
                setNotice(notes.length > 0 ? `Imported, but ${notes.join('; ')}.` : 'Imported.');
                // Kept for a reload, next to those of the plan saved in this browser.
                const kept = new Map(used.map((name) => [name, images.get(name)!]));
                assetStore
                    .save(loaded.doc.id, kept, stored ? [stored.id] : [])
                    .catch(() =>
                        setNotice(
                            'Imported, but the browser would not keep the images: after a reload, import the folder again.',
                        ),
                    );
            },
        );
    };

    return (
        <div className="shell">
            {/* One row, never wrapped: a taller bar moves the plan, which breaks drags in the e2e
                tests. Actions live in the Demos and File menus; messages show in a Toast below. */}
            <nav className="bar">
                <a className="title-block" href="/" title="Back to areaform.app">
                    <img src={logo} alt="" width={20} height={20} />
                    <span className="title-name">Areaform</span>
                    <span className="title-sub">Playground</span>
                </a>
                <span className="segmented" role="group" aria-label="Mode">
                    <button
                        aria-pressed={prefs.mode === 'view'}
                        title="View the plan as visitors see it"
                        onClick={() => setPref({ mode: 'view' })}
                    >
                        <Icon name="view" />
                        View
                    </button>
                    <button
                        aria-pressed={prefs.mode === 'edit'}
                        title="Edit the plan"
                        onClick={() => setPref({ mode: 'edit' })}
                    >
                        <Icon name="edit" />
                        Edit
                    </button>
                </span>
                <span className="bar-group">
                    <Menu label="Demos" title="Open a demo plan in place of this one">
                        {(close) =>
                            (Object.keys(DEMO_NAMES) as Demo[]).map((name) => (
                                <button
                                    key={name}
                                    role="menuitem"
                                    onClick={() => {
                                        close();
                                        loadDemo(name);
                                    }}
                                >
                                    {DEMO_NAMES[name]}
                                    <span className="menu-hint">{DEMO_HINTS[name]}</span>
                                </button>
                            ))
                        }
                    </Menu>
                    <Menu label="File" title="New, import and export">
                        {(close) => (
                            <>
                                {prefs.mode === 'edit' && (
                                    <>
                                        <button
                                            role="menuitem"
                                            onClick={() => {
                                                close();
                                                setCreating(true);
                                            }}
                                        >
                                            <Icon name="new" />
                                            New Space…
                                        </button>
                                        <MenuSeparator />
                                    </>
                                )}
                                <button
                                    role="menuitem"
                                    title="A plan.json, with the images its Underlays name"
                                    onClick={() => {
                                        close();
                                        fileInput.current?.click();
                                    }}
                                >
                                    <Icon name="import" />
                                    Import plan…
                                </button>
                                <button
                                    role="menuitem"
                                    title="A Draft folder: plan.json and its Source image"
                                    onClick={() => {
                                        close();
                                        folderInput.current?.click();
                                    }}
                                >
                                    <Icon name="import" />
                                    Import Draft folder…
                                </button>
                                <MenuSeparator />
                                <button
                                    role="menuitem"
                                    onClick={() => {
                                        close();
                                        exportFile();
                                    }}
                                >
                                    <Icon name="export" />
                                    Export plan (JSON)
                                </button>
                                <button
                                    role="menuitem"
                                    title={
                                        doc.geo
                                            ? 'For map and GIS tools'
                                            : 'In metres: the plan is not placed on Earth yet (Where is it? in the editor), so a map would show it off the coast of Africa'
                                    }
                                    onClick={() => {
                                        close();
                                        exportGeoJSON();
                                    }}
                                >
                                    <Icon name="export" />
                                    Export GeoJSON for maps
                                </button>
                                {/* The editor's shortcuts window, opened from the host's own menu. */}
                                {prefs.mode === 'edit' && !creating && (
                                    <>
                                        <MenuSeparator />
                                        <button
                                            role="menuitem"
                                            onClick={() => {
                                                close();
                                                setShortcuts(true);
                                            }}
                                        >
                                            <Icon name="keyboard" />
                                            Keyboard shortcuts
                                            <kbd className="menu-hint">?</kbd>
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </Menu>
                </span>
                <input
                    ref={fileInput}
                    type="file"
                    accept=".json,application/json,image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                        const files = [...(e.target.files ?? [])];
                        e.target.value = '';
                        if (files.length > 0) void importFiles(files);
                    }}
                />
                <input
                    ref={folderInput}
                    type="file"
                    aria-label="Draft folder"
                    hidden
                    {...{ webkitdirectory: '' }}
                    onChange={(e) => {
                        const files = [...(e.target.files ?? [])];
                        e.target.value = '';
                        if (files.length > 0) void importFiles(files);
                    }}
                />
                <span className="bar-end">
                    {autosaving ? (
                        <span
                            className="save-state"
                            data-state={doc === stored ? 'saved' : 'saving'}
                        >
                            {doc === stored ? 'All changes saved' : 'Saving…'}
                        </span>
                    ) : (
                        unsaved && (
                            <span className="save-state" data-state="unsaved">
                                Unsaved changes
                            </span>
                        )
                    )}
                    {unsaved && canRevert && (
                        <button className="bar-button" onClick={revert}>
                            Revert to saved
                        </button>
                    )}
                    {!autosaving && (
                        <button
                            className="bar-button icon-only"
                            aria-label="Save"
                            title="Save the plan in this browser"
                            onClick={() => save(doc, false)}
                        >
                            <Icon name="save" />
                        </button>
                    )}
                    <label className="switch" title="Save every change in this browser">
                        <input
                            type="checkbox"
                            role="switch"
                            checked={prefs.autosave}
                            onChange={(e) => setPref({ autosave: e.target.checked })}
                        />
                        Autosave
                    </label>
                    <select
                        className="bar-select"
                        aria-label="Interface language"
                        title="The editor's interface language (not the plan's own labels)"
                        value={prefs.locale}
                        onChange={(e) => setPref({ locale: e.target.value as BuiltInLocale })}
                    >
                        {LOCALES.map((l) => (
                            <option key={l} value={l}>
                                {LOCALE_NAMES[l]}
                            </option>
                        ))}
                    </select>
                </span>
            </nav>
            <Toast message={notice} onClose={closeNotice} />
            {prefs.mode === 'edit' && creating ? (
                <div className="dialog">
                    <CreateSpaceForm
                        units={prefs.units}
                        locale={prefs.locale}
                        onCreate={(created) => {
                            setCreating(false);
                            replace(
                                created,
                                'Replace the current plan with the new Space? Your unsaved changes will be lost.',
                                'Replace',
                            );
                        }}
                        onCancel={() => setCreating(false)}
                    />
                </div>
            ) : prefs.mode === 'edit' ? (
                <div className="edit">
                    {/* Keyed by replacement so a new or loaded plan starts with fresh editor state. */}
                    <AreaformEditor
                        key={generation}
                        editor={editor}
                        theme={demoTheme}
                        labelResolver={demoLabels}
                        resolveAsset={resolveAsset}
                        keepAsset={deviceAssets.keep}
                        hereLink={hereLink}
                        {...(reviewSelection && { selection: reviewSelection })}
                        units={prefs.units}
                        locale={prefs.locale}
                        dimensions={prefs.dimensions}
                        onUnitsChange={(units) => setPref({ units })}
                        foldedSections={prefs.foldedSections}
                        onFoldedSectionsChange={(foldedSections) => setPref({ foldedSections })}
                        onDimensionsChange={(dimensions) => setPref({ dimensions })}
                        grid={prefs.grid}
                        onGridChange={(grid) => setPref({ grid })}
                        onReady={(r) => exposeForTests(() => editor.getDocument(), r)}
                        onReady3d={(r) => (shown3d = r)}
                        onToolChange={(tool) => logEvent(`tool:${tool}`)}
                        onLevelChange={(id) => logEvent(`level:${id}`)}
                        onSelectionChange={(refs) => logEvent(`selection:${refs.length}`)}
                        shortcutsOpen={shortcuts}
                        onShortcutsOpenChange={setShortcuts}
                    />
                    <ReviewPanel
                        doc={doc}
                        editor={editor}
                        onShow={(ref) => setReviewSelection([ref])}
                    />
                </div>
            ) : (
                <Viewer
                    key={generation}
                    doc={doc}
                    resolveAsset={resolveAsset}
                    grid={prefs.grid}
                    onGridChange={(grid) => setPref({ grid })}
                    locale={prefs.locale}
                />
            )}
            {confirmation && (
                <div className="overlay">
                    <div className="confirm" role="alertdialog" aria-label="Confirm">
                        <p>{confirmation.message}</p>
                        <div className="buttons">
                            <button
                                onClick={() => {
                                    confirmation.run();
                                    setConfirmation(null);
                                }}
                            >
                                {confirmation.action}
                            </button>
                            <button onClick={() => setConfirmation(null)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** What an end user sees of the plan being edited: read-only, with booth status colours. */
function Viewer({
    doc,
    resolveAsset,
    grid,
    onGridChange,
    locale,
}: {
    doc: AreaformDocument;
    resolveAsset: AssetResolver | undefined;
    grid: boolean;
    onGridChange: (on: boolean) => void;
    locale: BuiltInLocale;
}) {
    const [levelId, setLevelId] = useState(doc.levels[0]!.id);
    const [selected, setSelected] = useState<ElementRef | null>(null);
    const [hovered, setHovered] = useState<ElementRef | null>(null);
    const [clicked, setClicked] = useState<string | null>(null);
    const [showStatus, setShowStatus] = useState(params.get('status') === '1');
    const [zoom, setZoom] = useState(0);

    const diagnostics = useMemo(() => diagnose(doc), [doc]);
    const highlight = useMemo(() => (selected ? [selected] : []), [selected]);
    const level = doc.levels.find((l) => l.id === levelId) ?? doc.levels[0]!;

    return (
        <div className="layout">
            {/* What the View reports while someone uses the plan, each value under the prop that
                reported it: a guide to the API for a developer trying it before embedding. */}
            <aside className="panel">
                <section className="panel-section">
                    <h2 className="panel-heading">Level</h2>
                    {/* Top-down, as the editor lists them: the highest Level first. */}
                    <ol className="level-rows">
                        {[...doc.levels]
                            .sort((a, b) => b.ordinal - a.ordinal)
                            .map((l) => (
                                <li key={l.id}>
                                    <button
                                        aria-pressed={l.id === level.id}
                                        onClick={() => setLevelId(l.id)}
                                    >
                                        {l.name}
                                    </button>
                                    <span className="muted figure">{l.elevation.toFixed(2)} m</span>
                                </li>
                            ))}
                    </ol>
                </section>

                <section className="panel-section">
                    <h2 className="panel-heading">Style</h2>
                    <label className="switch">
                        <input
                            type="checkbox"
                            role="switch"
                            checked={showStatus}
                            onChange={(e) => setShowStatus(e.target.checked)}
                        />
                        Booth status colours
                        <code className="api">styleResolver</code>
                    </label>
                </section>

                <section className="panel-section">
                    <h2 className="panel-heading">Events</h2>
                    <dl className="readouts">
                        <dt>Hover</dt>
                        <dd>
                            {hovered ? `${hovered.kind} ${hovered.id}` : 'nothing'}
                            <code className="api">onElementHover</code>
                        </dd>
                        <dt>Click</dt>
                        <dd>
                            {clicked ?? 'nothing yet'}
                            <code className="api">onElementClick</code>
                        </dd>
                        <dt>Zoom</dt>
                        <dd>
                            {zoom.toFixed(1)} px/m
                            <code className="api">onZoomChange</code>
                        </dd>
                    </dl>
                </section>

                <section className="panel-section">
                    <h2 className="panel-heading">
                        Selected
                        {selected && (
                            <span className="muted heading-note">
                                {selected.kind} {selected.id}
                            </span>
                        )}
                    </h2>
                    {selected ? (
                        <SelectedJSON value={findElement(doc, selected)} />
                    ) : (
                        <p className="muted">Click an element on the plan</p>
                    )}
                </section>

                <section className="panel-section">
                    <h2 className="panel-heading">
                        Diagnostics
                        <span className="muted heading-note">
                            {diagnostics.length === 0 ? 'none' : diagnostics.length}
                        </span>
                    </h2>
                    {diagnostics.length > 0 && (
                        <ul className="diagnostics">
                            {diagnostics.slice(0, 20).map((d, i) => (
                                <li key={i}>
                                    <button className="link" onClick={() => setSelected(d.ref)}>
                                        {d.code} · {d.ref.kind} {d.ref.id}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </aside>

            <main className="stage">
                <AreaformView
                    doc={doc}
                    levelId={level.id}
                    onLevelChange={setLevelId}
                    theme={demoTheme}
                    labelResolver={demoLabels}
                    {...(showStatus && { styleResolver: statusResolver })}
                    {...(resolveAsset && { resolveAsset })}
                    grid={grid}
                    controls
                    onGridChange={onGridChange}
                    locale={locale}
                    highlight={highlight}
                    onElementClick={(e) => {
                        setSelected(e.ref);
                        setClicked(`${e.ref.kind} ${e.ref.id}`);
                        logEvent(`click:${e.ref.id}@${e.screen.map(Math.round).join()}`);
                    }}
                    onBackgroundClick={() => {
                        setSelected(null);
                        setClicked('the background');
                    }}
                    onElementHover={(e) => {
                        setHovered(e.ref);
                        logEvent(`hover:${e.ref?.id ?? '-'}@${e.screen.map(Math.round).join()}`);
                    }}
                    onZoomChange={setZoom}
                    onReady={(r) => exposeForTests(() => doc, r)}
                    onReady3d={(r) => (shown3d = r)}
                    plugins={VIEW_PLUGINS}
                />
            </main>
        </div>
    );
}

/** The selected element as JSON, with Copy for the whole of it. */
function SelectedJSON({ value }: { value: unknown }) {
    const text = compactJSON(value);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    return (
        <div className="json">
            <button
                className="bar-button json-copy"
                onClick={() =>
                    void navigator.clipboard?.writeText(text).then(() => setCopied(true))
                }
            >
                {copied ? 'Copied' : 'Copy'}
            </button>
            <pre>{text}</pre>
        </div>
    );
}

function findElement(doc: AreaformDocument, ref: ElementRef): unknown {
    if (ref.kind === 'level') return doc.levels.find((l) => l.id === ref.id)?.name;
    if (ref.kind === 'connection' || ref.kind === 'stop')
        return doc.connections.find((c) => c.id === ref.id);
    const level = doc.levels.find((l) => l.id === ref.levelId);
    const lists = {
        wallNode: level?.wallNodes,
        wall: level?.walls,
        opening: level?.openings,
        zone: level?.zones,
        obstacle: level?.obstacles,
        underlay: level?.underlays,
    };
    return lists[ref.kind]?.find((e) => e.id === ref.id);
}
