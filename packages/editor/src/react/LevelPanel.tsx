import type {
    Connection,
    Editor,
    AreaformDocument,
    Id,
    Level,
    Underlay,
    Vec2,
} from '@areaform/core';
import { useState, type MouseEvent } from 'react';
import {
    extendableConnections,
    type EditorController,
    type ExtendOffer,
} from '../interaction/controller.ts';
import {
    formatDecimal,
    unitLabel,
    parseDecimal,
    parseLength,
    toInputValue,
} from '../interaction/units.ts';
import { TranslatableField, translatableCaption } from './LanguagesPanel.tsx';
import { CommitInput } from './CommitInput.tsx';
import { AssetRefused, useAssets, type AssetUploader } from './assets.ts';
import { isDeviceAsset } from '../deviceAssets.ts';
import { useI18n } from './i18n.ts';
import { LengthCaption, LengthInput, lengthFieldLabel, useUnits } from './LengthInput.tsx';

/** Properties of the current Level and its Underlays, shown when nothing is selected. */
export function LevelPanel({
    editor,
    controller,
    doc,
    level,
    onSelectLevel,
    filling,
}: {
    editor: Editor;
    controller: EditorController;
    doc: AreaformDocument;
    level: Level;
    /** The Content Language being filled in: the Level's name is edited in it. */
    filling?: string | undefined;
    /** Makes another Level current, e.g. a freshly duplicated one. */
    onSelectLevel: (levelId: Id) => void;
}) {
    const levelId = level.id;
    const units = useUnits();
    const i18n = useI18n();
    const inGroup = doc.levels.filter((l) => l.group === level.group);
    const canMove = {
        up: inGroup.some((l) => l.ordinal > level.ordinal),
        down: inGroup.some((l) => l.ordinal < level.ordinal),
    };
    const duplicate = () => {
        const copyId = controller.duplicateLevel(levelId);
        if (copyId) onSelectLevel(copyId);
    };
    const update = (changes: {
        name?: string;
        elevation?: number;
        height?: number;
        group?: string | undefined;
    }) => editor.exec({ type: 'level.update', levelId, changes });

    return (
        <>
            <dl className="af-props">
                <dt>
                    {translatableCaption(doc, filling, i18n.t('props.name'), (language) =>
                        i18n.t('props.nameIn', { language }),
                    )}
                </dt>
                <dd>
                    <TranslatableField
                        editor={editor}
                        doc={doc}
                        target={{ kind: 'level', levelId }}
                        text={level.name}
                        translations={level.names}
                        filling={filling}
                        aria-label={i18n.t('level.nameField')}
                        onDefault={(v) => v && update({ name: v })}
                    />
                </dd>
                <dt>{i18n.t('level.group')}</dt>
                <dd>
                    <CommitInput
                        aria-label={i18n.t('level.groupField')}
                        value={level.group ?? ''}
                        onCommit={(v) => update({ group: v.trim() || undefined })}
                    />
                </dd>
                <LengthCaption name={i18n.t('level.elevation')} />
                <dd>
                    <LengthInput
                        label={i18n.t('level.elevation')}
                        allowZeroOrLess
                        metres={level.elevation}
                        onCommit={(elevation) => update({ elevation })}
                    />
                </dd>
                <LengthCaption name={i18n.t('level.ceiling')} />
                <dd>
                    <LengthInput
                        label={i18n.t('level.ceilingHeight')}
                        metres={level.height}
                        onCommit={(height) => update({ height })}
                    />
                </dd>
            </dl>
            <div className="af-buttons af-gap">
                <button
                    className="af-button"
                    disabled={!canMove.up}
                    onClick={() => editor.exec({ type: 'level.move', levelId, direction: 'up' })}
                >
                    {i18n.t('level.moveUp')}
                </button>
                <button
                    className="af-button"
                    disabled={!canMove.down}
                    onClick={() => editor.exec({ type: 'level.move', levelId, direction: 'down' })}
                >
                    {i18n.t('level.moveDown')}
                </button>
                <button className="af-button" onClick={duplicate}>
                    {i18n.t('level.duplicate')}
                </button>
                {doc.levels.length > 1 && (
                    <button
                        className="af-button af-button-danger"
                        onClick={() => controller.requestLevelDelete(levelId)}
                    >
                        {i18n.t('level.delete')}
                    </button>
                )}
            </div>
            {/* Keyed by units and language: the typed thickness is written in both. */}
            <GenerateWalls key={`${units}:${i18n.locale}`} editor={editor} levelId={levelId} />

            <h2 className="af-heading af-gap">{i18n.t('here.heading')}</h2>
            <div className="af-buttons">
                <button
                    className="af-button"
                    title={i18n.t('here.pickTitle')}
                    onClick={() => controller.startHerePick()}
                >
                    {i18n.t('here.pick')}
                </button>
            </div>

            <h2 className="af-heading af-gap">{i18n.t('underlay.heading')}</h2>
            {level.underlays.map((underlay) => (
                <UnderlayCard
                    key={underlay.id}
                    editor={editor}
                    controller={controller}
                    levelId={levelId}
                    underlay={underlay}
                />
            ))}
            <AddUnderlay editor={editor} level={level} />
        </>
    );
}

/**
 * One Underlay's settings. Unlocked Underlays with a known image size can also be picked and
 * dragged on the canvas.
 */
export function UnderlayCard({
    editor,
    controller,
    levelId,
    underlay,
}: {
    editor: Editor;
    controller: EditorController;
    levelId: Id;
    underlay: Underlay;
}) {
    const i18n = useI18n();
    const { resolveAsset } = useAssets();
    // A `local:` image this browser does not have stays blank; say why rather than nothing.
    const elsewhere =
        isDeviceAsset(underlay.src) &&
        (resolveAsset?.(underlay.src) ?? underlay.src) === underlay.src;
    return (
        <dl className="af-props af-card">
            {elsewhere && (
                <dd className="af-span af-muted" role="note">
                    {i18n.t('underlay.elsewhere')}
                </dd>
            )}
            <dt>{i18n.t('underlay.image')}</dt>
            <dd className="af-ellipsis" title={underlay.src}>
                {underlay.src}
            </dd>
            <dt>{i18n.t('underlay.opacity')}</dt>
            <dd>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={underlay.opacity}
                    onChange={(e) =>
                        editor.exec({
                            type: 'underlay.update',
                            levelId,
                            underlayId: underlay.id,
                            changes: { opacity: Number(e.target.value) },
                        })
                    }
                />
            </dd>
            <dt>{i18n.t('underlay.rotation')}</dt>
            <dd>
                <CommitInput
                    inputMode="decimal"
                    aria-label={i18n.t('underlay.rotationField')}
                    value={formatDecimal((underlay.rotation * 180) / Math.PI, i18n)}
                    onCommit={(v) => {
                        const degrees = parseDecimal(v);
                        if (degrees === undefined) return;
                        editor.exec({
                            type: 'underlay.update',
                            levelId,
                            underlayId: underlay.id,
                            changes: { rotation: (degrees * Math.PI) / 180 },
                        });
                    }}
                />
            </dd>
            <LengthCaption name={i18n.t('underlay.position')} />
            <dd className="af-pair">
                {([0, 1] as const).map((axis) => (
                    <LengthInput
                        key={axis}
                        allowZeroOrLess
                        label={i18n.t(axis === 0 ? 'underlay.x' : 'underlay.y')}
                        metres={underlay.position[axis]}
                        onCommit={(value) => {
                            const position: [number, number] = [...underlay.position];
                            position[axis] = value;
                            editor.exec({
                                type: 'underlay.update',
                                levelId,
                                underlayId: underlay.id,
                                changes: { position },
                            });
                        }}
                    />
                ))}
            </dd>
            <dt>{i18n.t('underlay.locked')}</dt>
            <dd>
                <input
                    type="checkbox"
                    aria-label={i18n.t('underlay.locked')}
                    checked={underlay.locked}
                    onChange={(e) =>
                        editor.exec({
                            type: 'underlay.update',
                            levelId,
                            underlayId: underlay.id,
                            changes: { locked: e.target.checked },
                        })
                    }
                />
            </dd>
            <dd className="af-buttons af-span">
                {!underlay.size && (
                    <button
                        className="af-button"
                        title={i18n.t('underlay.measureTitle')}
                        onClick={() =>
                            void imageSize(resolveAsset?.(underlay.src) ?? underlay.src).then(
                                (size) =>
                                    size &&
                                    editor.exec({
                                        type: 'underlay.update',
                                        levelId,
                                        underlayId: underlay.id,
                                        changes: { size },
                                    }),
                            )
                        }
                    >
                        {i18n.t('underlay.measure')}
                    </button>
                )}
                <button
                    className="af-button"
                    onClick={() => controller.startCalibration(underlay.id)}
                >
                    {i18n.t('underlay.calibrate')}
                </button>
                <button
                    className="af-button"
                    onClick={() =>
                        editor.exec({
                            type: 'underlay.delete',
                            levelId,
                            underlayId: underlay.id,
                        })
                    }
                >
                    {i18n.t('underlay.remove')}
                </button>
            </dd>
        </dl>
    );
}

/** The natural size of an image in pixels, or undefined when it cannot be loaded. */
/** An image's size in pixels, or undefined when it does not load. */
export function imageSize(src: string): Promise<Vec2 | undefined> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () =>
            resolve(image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : undefined);
        image.onerror = () => resolve(undefined);
        image.src = src;
    });
}

/**
 * Adds an Underlay by image URL, or from a file when the host stores files (`uploadAsset`), placed
 * at the Outline's top-left corner, ready to calibrate.
 */
function AddUnderlay({ editor, level }: { editor: Editor; level: Level }) {
    const [src, setSrc] = useState('');
    const [busy, setBusy] = useState<'upload' | 'keep' | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const { uploadAsset, keepAsset } = useAssets();
    const i18n = useI18n();
    const place = (url: string, size: Vec2 | undefined) => {
        const xs = level.outline.outer.map((p) => p[0]);
        const ys = level.outline.outer.map((p) => p[1]);
        editor.exec({
            type: 'underlay.add',
            levelId: level.id,
            underlay: {
                src: url,
                position: [Math.min(...xs), Math.max(...ys)],
                scale: 0.02,
                rotation: 0,
                opacity: 0.5,
                locked: false,
                // Without a size the Underlay still shows, but cannot be picked on the canvas.
                ...(size && { size }),
            },
        });
    };
    const add = async () => {
        const url = src.trim();
        if (!url) return;
        place(url, await imageSize(url));
        setSrc('');
    };
    /** Stores a picked file the host's way, measured from the file itself. */
    const store = async (file: File, how: 'upload' | 'keep', save: AssetUploader) => {
        setBusy(how);
        setProblem(null);
        const local = URL.createObjectURL(file);
        try {
            const [stored, size] = await Promise.all([save(file), imageSize(local)]);
            place(stored, size);
        } catch (error) {
            setProblem(
                error instanceof AssetRefused
                    ? error.message
                    : i18n.t(how === 'keep' ? 'underlay.keepFailed' : 'underlay.uploadFailed'),
            );
        } finally {
            URL.revokeObjectURL(local);
            setBusy(null);
        }
    };
    const fileButton = (how: 'upload' | 'keep', save: AssetUploader) => (
        <label
            className="af-button af-file"
            aria-disabled={busy !== null}
            {...(how === 'keep' && { title: i18n.t('underlay.keepTitle') })}
        >
            {i18n.t(busy === how ? `underlay.${how}ing` : `underlay.${how}`)}
            <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy !== null}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void store(file, how, save);
                }}
            />
        </label>
    );
    return (
        <>
            <div className="af-buttons">
                <input
                    className="af-input"
                    placeholder={i18n.t('underlay.url')}
                    aria-label={i18n.t('underlay.urlField')}
                    value={src}
                    onChange={(e) => setSrc(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void add()}
                />
                <button className="af-button" onClick={() => void add()}>
                    {i18n.t('common.add')}
                </button>
            </div>
            {(uploadAsset || keepAsset) && (
                <div className="af-buttons">
                    {uploadAsset && fileButton('upload', uploadAsset)}
                    {keepAsset && fileButton('keep', keepAsset)}
                </div>
            )}
            {problem && (
                <p className="af-muted" role="alert">
                    {problem}
                </p>
            )}
        </>
    );
}

/** One-shot exterior walls along the Outline (Q4), with the thickness to use. */
function GenerateWalls({ editor, levelId }: { editor: Editor; levelId: string }) {
    const units = useUnits();
    const i18n = useI18n();
    const [thickness, setThickness] = useState(() => toInputValue(0.3, units, i18n));
    const [note, setNote] = useState<string | null>(null);
    const metres = parseLength(thickness, units);
    const generate = () => {
        if (metres === undefined) return;
        const before = editor.getDocument();
        const result = editor.exec({ type: 'walls.fromOutline', levelId, thickness: metres });
        if (!result.ok) setNote(i18n.t('walls.failed'));
        else setNote(editor.getDocument() === before ? i18n.t('walls.already') : null);
    };
    return (
        <div className="af-gap">
            <div className="af-buttons">
                <button
                    className="af-button"
                    onClick={generate}
                    disabled={!(metres !== undefined && metres > 0)}
                >
                    {i18n.t('walls.fromOutline')}
                </button>
                <input
                    className="af-input af-narrow"
                    type="text"
                    inputMode="decimal"
                    aria-label={lengthFieldLabel(i18n, i18n.t('props.wallThickness'), units)}
                    value={thickness}
                    onChange={(e) => setThickness(e.target.value)}
                />
                <span className="af-muted">{unitLabel(units, i18n)}</span>
            </div>
            {note && <p className="af-muted">{note}</p>}
        </div>
    );
}

/**
 * Offers to extend each Connection that stops on the source Level to its copy, with the same
 * footprint (Q32); duplicating never does this on its own. The offer lives in the controller, so
 * it stays while the selection changes.
 */
export function ExtendConnections({
    editor,
    controller,
    doc,
    offer,
}: {
    editor: Editor;
    controller: EditorController;
    doc: AreaformDocument;
    offer: ExtendOffer;
}) {
    const { copyId, sourceId } = offer;
    const candidates = extendableConnections(doc, offer);
    const i18n = useI18n();
    if (candidates.length === 0) return null;
    const extend = (connection: Connection) => {
        const source = connection.stops.find((s) => s.levelId === sourceId)!;
        editor.exec({
            type: 'connection.update',
            connectionId: connection.id,
            changes: { stops: [...connection.stops, { levelId: copyId, shape: source.shape }] },
        });
    };
    const label = (c: Connection) => c.name ?? i18n.t(`connectionKind.${c.kind}`);
    // The clicked button may vanish with the offer; hand the focus back to the editor so its
    // keyboard shortcuts keep working.
    const refocus = (e: MouseEvent<HTMLElement>) =>
        e.currentTarget.closest<HTMLElement>('.af-editor')?.focus();
    return (
        <div className="af-card af-gap" role="group" aria-label={i18n.t('extend.group')}>
            <p className="af-muted">{i18n.t('extend.question')}</p>
            <div className="af-stack">
                {candidates.map((c) => (
                    <button
                        key={c.id}
                        className="af-button"
                        onClick={(e) => {
                            refocus(e);
                            extend(c);
                        }}
                    >
                        {i18n.t('extend.one', { name: label(c) })}
                    </button>
                ))}
            </div>
            <div className="af-buttons af-gap">
                <button
                    className="af-button"
                    onClick={(e) => {
                        refocus(e);
                        controller.dismissExtendOffer();
                    }}
                >
                    {i18n.t('common.done')}
                </button>
            </div>
        </div>
    );
}
