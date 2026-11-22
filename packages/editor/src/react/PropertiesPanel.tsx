import type {
    Changes,
    Connection,
    Editor,
    ElementRef,
    AreaformDocument,
    Level,
    Opening,
    Shape,
    Zone,
    ZoneChanges,
} from '@areaform/core';
import { presetFor, type Preset } from '@areaform/core';
import { defaultTheme } from '@areaform/render-2d';
import { useEffect, useId, useRef } from 'react';
import { categoryFromText, categoryFlags } from '../categories.ts';
import type { EditorController } from '../controller.ts';
import { wallLengthCommand } from '../elements.ts';
import {
    holesValid,
    rectangleSides,
    reshapeCommand,
    resizeRectangle,
    shapeArea,
    type ShapedRef,
} from '../shapeEdit.ts';
import { formatArea } from '../units.ts';
import { CategoryList } from './CategoryList.tsx';
import { TranslatableField, translatableCaption } from './LanguagesPanel.tsx';
import { CommitInput } from './CommitInput.tsx';
import { HereValue, type HereLink } from './HereValue.tsx';
import { useI18n } from './i18n.ts';
import { LengthCaption, LengthInput, useUnits } from './LengthInput.tsx';
import { UnderlayCard } from './LevelPanel.tsx';
import { startsAccessible } from '../connectionDefaults.ts';

/** Edits the selected Element's properties through core Commands. */
export function PropertiesPanel({
    editor,
    controller,
    doc,
    level,
    selection,
    presets,
    filling,
    hereLink,
}: {
    editor: Editor;
    controller: EditorController | null;
    doc: AreaformDocument;
    level: Level;
    selection: ElementRef[];
    /** The Presets whose Zone Categories to suggest; the built-in `defaultPresets` when absent. */
    presets?: Record<string, Preset> | undefined;
    /** The Content Language being filled in: labels and names are edited in it. */
    filling?: string | undefined;
    /** The host's link for Here, shown with a Zone's `?here=` value. */
    hereLink?: HereLink | undefined;
}) {
    const i18n = useI18n();
    if (selection.length === 0) return null;
    if (selection.length > 1) {
        const count = (
            <p className="af-muted">{i18n.t('count.element', { count: selection.length })}</p>
        );
        const zones = level.zones.filter((z) =>
            selection.some((r) => r.kind === 'zone' && r.id === z.id),
        );
        if (zones.length !== selection.length) return count;
        return (
            <>
                {count}
                <ZoneFlags editor={editor} levelId={level.id} zones={zones} />
            </>
        );
    }
    const ref = selection[0]!;
    const levelId = level.id;
    /** Gives a Zone, Obstacle or Stop a new shape, unless that would put a hole outside it. */
    const reshape = (target: ShapedRef) => (shape: Shape) => {
        const command = holesValid(shape) && reshapeCommand(doc, target, shape);
        if (command) editor.exec(command);
    };

    if (ref.kind === 'zone') {
        const zone = level.zones.find((z) => z.id === ref.id);
        return zone ? (
            <ZoneProperties
                editor={editor}
                preset={presetFor(doc.kind, presets)}
                levelId={levelId}
                zone={zone}
                doc={doc}
                filling={filling}
                hereLink={hereLink}
                onReshape={reshape({ kind: 'zone', id: zone.id, levelId })}
            />
        ) : null;
    }
    if (ref.kind === 'wall') {
        const wall = level.walls.find((w) => w.id === ref.id);
        if (!wall) return null;
        const update = (changes: { thickness?: number; height?: number }) =>
            editor.exec({ type: 'wall.update', levelId, wallId: wall.id, changes });
        const [a, b] = [wall.a, wall.b].map((id) => level.wallNodes.find((n) => n.id === id));
        const length =
            a && b ? Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) : 0;
        const setLength = (value: number) => {
            const command = wallLengthCommand(level, wall.id, value);
            if (command) editor.exec(command);
        };
        return (
            <dl className="af-props">
                <dt>{i18n.t('props.wall')}</dt>
                <dd />
                <LengthCaption name={i18n.t('props.length')} />
                <dd>
                    <LengthInput
                        label={i18n.t('props.wallLength')}
                        metres={length}
                        onCommit={setLength}
                    />
                </dd>
                <LengthCaption name={i18n.t('props.thickness')} />
                <dd>
                    <LengthInput
                        label={i18n.t('props.wallThickness')}
                        metres={wall.thickness}
                        onCommit={(thickness) => update({ thickness })}
                    />
                </dd>
                <LengthCaption name={i18n.t('props.height')} />
                <dd>
                    <LengthInput
                        label={i18n.t('props.wallHeight')}
                        metres={wall.height ?? level.height}
                        onCommit={(height) => update({ height })}
                    />
                </dd>
            </dl>
        );
    }
    if (ref.kind === 'opening') {
        const opening = level.openings.find((o) => o.id === ref.id);
        return opening ? (
            <OpeningProperties editor={editor} levelId={levelId} opening={opening} />
        ) : null;
    }
    if (ref.kind === 'obstacle') {
        const obstacle = level.obstacles.find((o) => o.id === ref.id);
        if (!obstacle) return null;
        return (
            <dl className="af-props">
                <dt>{i18n.t('props.obstacle')}</dt>
                <dd>
                    <select
                        className="af-input"
                        value={obstacle.kind}
                        onChange={(e) =>
                            editor.exec({
                                type: 'obstacle.update',
                                levelId,
                                obstacleId: obstacle.id,
                                changes: { kind: e.target.value as typeof obstacle.kind },
                            })
                        }
                    >
                        {(['column', 'shaft', 'void', 'other'] as const).map((k) => (
                            <option key={k} value={k}>
                                {i18n.t(`obstacleKind.${k}`)}
                            </option>
                        ))}
                    </select>
                </dd>
                <ShapeSize
                    shape={obstacle.shape}
                    onReshape={reshape({ kind: 'obstacle', id: obstacle.id, levelId })}
                />
            </dl>
        );
    }
    if (ref.kind === 'stop' || ref.kind === 'connection') {
        const connection = doc.connections.find((c) => c.id === ref.id);
        return connection ? (
            <ConnectionProperties
                editor={editor}
                doc={doc}
                level={level}
                connection={connection}
                filling={filling}
                onReshape={reshape({ kind: 'stop', id: connection.id, levelId })}
            />
        ) : null;
    }
    if (ref.kind === 'underlay' && controller) {
        const underlay = level.underlays.find((u) => u.id === ref.id);
        return underlay ? (
            <>
                <dl className="af-props">
                    <dt>{i18n.t('props.underlay')}</dt>
                    <dd />
                </dl>
                <UnderlayCard
                    editor={editor}
                    controller={controller}
                    levelId={levelId}
                    underlay={underlay}
                />
            </>
        ) : null;
    }
    return <p className="af-muted">{i18n.t('props.selected', { kind: ref.kind })}</p>;
}

/** Kind, name and flags, plus a checkbox per Level for where the Connection stops (Q38). */
function ConnectionProperties({
    editor,
    doc,
    level,
    connection,
    filling,
    onReshape,
}: {
    editor: Editor;
    doc: AreaformDocument;
    level: Level;
    connection: Connection;
    filling: string | undefined;
    /** Reshapes the Stop on `level`. */
    onReshape: (shape: Shape) => void;
}) {
    const update = (changes: Changes<Connection>) =>
        editor.exec({ type: 'connection.update', connectionId: connection.id, changes });
    const stopHere = connection.stops.find((s) => s.levelId === level.id);
    const here = stopHere ?? connection.stops[0]!;
    const toggle = (levelId: string, on: boolean) => {
        const stops = on
            ? [...connection.stops, { levelId, shape: here.shape }]
            : connection.stops.filter((s) => s.levelId !== levelId);
        if (stops.length >= 2) update({ stops });
    };
    const levels = [...doc.levels].sort((a, b) => b.ordinal - a.ordinal);
    const i18n = useI18n();
    return (
        <dl className="af-props">
            <dt>{i18n.t('props.connection')}</dt>
            <dd>
                <select
                    className="af-input"
                    value={connection.kind}
                    onChange={(e) => {
                        // A new kind brings its own default: a lift is accessible, stairs are not.
                        const kind = e.target.value as Connection['kind'];
                        update({ kind, accessible: startsAccessible(kind) || undefined });
                    }}
                >
                    {(['stairs', 'elevator', 'escalator', 'ramp'] as const).map((k) => (
                        <option key={k} value={k}>
                            {i18n.t(`connectionKind.${k}`)}
                        </option>
                    ))}
                </select>
            </dd>
            <dt>
                {translatableCaption(doc, filling, i18n.t('props.name'), (language) =>
                    i18n.t('props.nameIn', { language }),
                )}
            </dt>
            <dd>
                <TranslatableField
                    editor={editor}
                    doc={doc}
                    target={{ kind: 'connection', connectionId: connection.id }}
                    text={connection.name}
                    translations={connection.names}
                    filling={filling}
                    onDefault={(v) => update({ name: v || undefined })}
                />
            </dd>
            <dt>{i18n.t('props.accessible')}</dt>
            <dd>
                <input
                    type="checkbox"
                    checked={connection.accessible ?? false}
                    onChange={(e) => update({ accessible: e.target.checked || undefined })}
                />
            </dd>
            <dt>{i18n.t('props.twoWay')}</dt>
            <dd>
                <input
                    type="checkbox"
                    checked={connection.bidirectional}
                    onChange={(e) => update({ bidirectional: e.target.checked })}
                />
            </dd>
            {!connection.bidirectional && (
                <>
                    {/* One way runs from the first Stop to the last (ADR-0017): routes follow it. */}
                    <dt>{i18n.t('props.runs')}</dt>
                    <dd className="af-buttons">
                        <span>
                            {connection.stops
                                .map((s) => doc.levels.find((l) => l.id === s.levelId)?.name ?? '?')
                                .join(' → ')}
                        </span>
                        <button
                            type="button"
                            className="af-button"
                            onClick={() => update({ stops: [...connection.stops].reverse() })}
                        >
                            {i18n.t('props.reverse')}
                        </button>
                    </dd>
                </>
            )}
            <dt>{i18n.t('props.stopsAt')}</dt>
            <dd className="af-stack">
                {levels.map((l) => {
                    const stops = connection.stops.some((s) => s.levelId === l.id);
                    return (
                        <label key={l.id}>
                            <input
                                type="checkbox"
                                checked={stops}
                                disabled={stops && connection.stops.length <= 2}
                                onChange={(e) => toggle(l.id, e.target.checked)}
                            />{' '}
                            {l.name}
                        </label>
                    );
                })}
            </dd>
            {stopHere && <ShapeSize shape={stopHere.shape} onReshape={onReshape} />}
        </dl>
    );
}

type ZoneFlag = 'restricted' | 'walkAround';

/** Restricted and Walk-around for several selected Zones at once, each change one undo step. */
function ZoneFlags({ editor, levelId, zones }: { editor: Editor; levelId: string; zones: Zone[] }) {
    const i18n = useI18n();
    const set = (flag: ZoneFlag, on: boolean) => {
        const tx = editor.begin();
        for (const zone of zones)
            tx.exec({
                type: 'zone.update',
                levelId,
                zoneId: zone.id,
                changes: { [flag]: on || undefined },
            });
        tx.commit();
    };
    return (
        <dl className="af-props">
            {(['restricted', 'walkAround'] as const).map((flag) => (
                <FlagRow
                    key={flag}
                    label={i18n.t(`props.${flag}`)}
                    on={zones.filter((z) => z[flag] === true).length}
                    of={zones.length}
                    onChange={(on) => set(flag, on)}
                />
            ))}
        </dl>
    );
}

/** A checkbox for a flag `on` of `of` Zones have: ticked for all, mixed for some. */
function FlagRow({
    label,
    on,
    of,
    onChange,
}: {
    label: string;
    on: number;
    of: number;
    onChange: (on: boolean) => void;
}) {
    const box = useRef<HTMLInputElement>(null);
    const mixed = on > 0 && on < of;
    useEffect(() => {
        if (box.current) box.current.indeterminate = mixed;
    }, [mixed]);
    return (
        <>
            <dt>{label}</dt>
            <dd>
                <input
                    ref={box}
                    type="checkbox"
                    aria-label={label}
                    checked={on === of}
                    onChange={() => onChange(on < of)}
                />
            </dd>
        </>
    );
}

function ZoneProperties({
    editor,
    preset,
    levelId,
    zone,
    doc,
    filling,
    hereLink,
    onReshape,
}: {
    editor: Editor;
    preset: Preset;
    levelId: string;
    zone: Zone;
    doc: AreaformDocument;
    filling: string | undefined;
    hereLink: HereLink | undefined;
    onReshape: (shape: Shape) => void;
}) {
    const update = (changes: ZoneChanges) =>
        editor.exec({ type: 'zone.update', levelId, zoneId: zone.id, changes });
    const suggestions = useId();
    const i18n = useI18n();
    return (
        <dl className="af-props">
            <dt>
                {translatableCaption(doc, filling, i18n.t('props.label'), (language) =>
                    i18n.t('props.labelIn', { language }),
                )}
            </dt>
            <dd>
                <TranslatableField
                    editor={editor}
                    doc={doc}
                    target={{ kind: 'zone', levelId, zoneId: zone.id }}
                    text={zone.label}
                    translations={zone.labels}
                    filling={filling}
                    onDefault={(v) => update({ label: v || undefined })}
                />
            </dd>
            <dt>{i18n.t('props.category')}</dt>
            <dd>
                <CommitInput
                    value={zone.category ?? ''}
                    list={suggestions}
                    placeholder={i18n.t('props.categoryNone')}
                    aria-label={i18n.t('props.category')}
                    onCommit={(text) => {
                        const category = categoryFromText(preset, text, i18n);
                        // Choosing a category turns its flags (Restricted, Walk-around) on; never off.
                        update({
                            category: category ?? undefined,
                            ...categoryFlags(preset, category),
                        });
                    }}
                />
                <CategoryList id={suggestions} preset={preset} />
            </dd>
            <dt>{i18n.t('props.restricted')}</dt>
            <dd>
                <input
                    type="checkbox"
                    aria-label={i18n.t('props.restricted')}
                    checked={zone.restricted ?? false}
                    onChange={(e) => update({ restricted: e.target.checked || undefined })}
                />
            </dd>
            <dt>{i18n.t('props.walkAround')}</dt>
            <dd>
                <input
                    type="checkbox"
                    aria-label={i18n.t('props.walkAround')}
                    checked={zone.walkAround ?? false}
                    onChange={(e) => update({ walkAround: e.target.checked || undefined })}
                />
            </dd>
            <dt title={i18n.t('here.valueHint')}>{i18n.t('here.value')}</dt>
            <dd>
                <HereValue value={zone.id} link={hereLink} />
            </dd>
            <dt>{i18n.t('props.fill')}</dt>
            <dd>
                <input
                    type="color"
                    value={
                        zone.style?.fill ??
                        (zone.restricted ? defaultTheme.restricted.fill : undefined) ??
                        (zone.category !== undefined
                            ? defaultTheme.categories[zone.category]?.fill
                            : undefined) ??
                        defaultTheme.zone.fill
                    }
                    onChange={(e) => update({ style: { ...zone.style, fill: e.target.value } })}
                />
            </dd>
            <dt>{i18n.t('props.text')}</dt>
            <dd className="af-colour">
                <input
                    type="color"
                    aria-label={i18n.t('props.textColour')}
                    value={zone.labelColor ?? defaultTheme.label.fill}
                    onChange={(e) => update({ labelColor: e.target.value })}
                />
                {zone.labelColor !== undefined && (
                    <button
                        className="af-button"
                        aria-label={i18n.t('props.defaultTextColour')}
                        title={i18n.t('props.defaultTextColourTitle')}
                        onClick={() => update({ labelColor: undefined })}
                    >
                        {i18n.t('props.reset')}
                    </button>
                )}
            </dd>
            <ShapeSize shape={zone.shape} onReshape={onReshape} />
        </dl>
    );
}

/**
 * Width and depth of a rectangular shape (at any angle), typed to resize it from its top-left
 * corner on screen; the area of any shape.
 */
function ShapeSize({ shape, onReshape }: { shape: Shape; onReshape: (shape: Shape) => void }) {
    const units = useUnits();
    const i18n = useI18n();
    const sides = rectangleSides(shape.outer);
    const [width, depth] = [i18n.t('props.width'), i18n.t('props.depth')];
    const resize = (width: number, depth: number) =>
        onReshape({ ...shape, outer: resizeRectangle(shape.outer, width, depth) });
    return (
        <>
            {sides && (
                <>
                    <LengthCaption name={width} />
                    <dd>
                        <LengthInput
                            metres={sides[0]}
                            label={width}
                            onCommit={(width) => resize(width, sides[1])}
                        />
                    </dd>
                    <LengthCaption name={depth} />
                    <dd>
                        <LengthInput
                            metres={sides[1]}
                            label={depth}
                            onCommit={(depth) => resize(sides[0], depth)}
                        />
                    </dd>
                </>
            )}
            <dt>{i18n.t('props.area')}</dt>
            <dd>{formatArea(shapeArea(shape), units, i18n)}</dd>
        </>
    );
}

function OpeningProperties({
    editor,
    levelId,
    opening,
}: {
    editor: Editor;
    levelId: string;
    opening: Opening;
}) {
    const i18n = useI18n();
    return (
        <dl className="af-props">
            <dt>{i18n.t('props.opening')}</dt>
            <dd>
                <select
                    className="af-input"
                    value={opening.kind}
                    onChange={(e) =>
                        editor.exec({
                            type: 'opening.update',
                            levelId,
                            openingId: opening.id,
                            changes: { kind: e.target.value as Opening['kind'] },
                        })
                    }
                >
                    {(['door', 'entrance', 'passage', 'emergency-exit'] as const).map((k) => (
                        <option key={k} value={k}>
                            {i18n.t(`openingKind.${k}`)}
                        </option>
                    ))}
                </select>
            </dd>
            <LengthCaption name={i18n.t('props.width')} />
            <dd>
                <LengthInput
                    label={i18n.t('props.openingWidth')}
                    metres={opening.width}
                    onCommit={(width) =>
                        editor.exec({
                            type: 'opening.update',
                            levelId,
                            openingId: opening.id,
                            changes: { width },
                        })
                    }
                />
            </dd>
            {opening.kind === 'door' && (
                <>
                    <dt>{i18n.t('props.hinge')}</dt>
                    <dd>
                        <select
                            className="af-input"
                            aria-label={i18n.t('props.hinge')}
                            value={opening.hinge ?? 'start'}
                            onChange={(e) =>
                                editor.exec({
                                    type: 'opening.update',
                                    levelId,
                                    openingId: opening.id,
                                    changes: { hinge: e.target.value as 'start' | 'end' },
                                })
                            }
                        >
                            <option value="start">{i18n.t('props.hingeStart')}</option>
                            <option value="end">{i18n.t('props.hingeEnd')}</option>
                        </select>
                    </dd>
                    <dt>{i18n.t('props.swing')}</dt>
                    <dd>
                        <select
                            className="af-input"
                            aria-label={i18n.t('props.swing')}
                            value={opening.swing ?? 'left'}
                            onChange={(e) =>
                                editor.exec({
                                    type: 'opening.update',
                                    levelId,
                                    openingId: opening.id,
                                    changes: { swing: e.target.value as 'left' | 'right' },
                                })
                            }
                        >
                            <option value="left">{i18n.t('props.swingLeft')}</option>
                            <option value="right">{i18n.t('props.swingRight')}</option>
                        </select>
                    </dd>
                </>
            )}
        </dl>
    );
}
