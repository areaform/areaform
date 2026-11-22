import {
    createEditor,
    createSpace,
    diagnose,
    fromJSON,
    presetFor,
    type Command,
    type Diagnostic,
    type Id,
    type Editor,
    type AreaformDocument,
    type LoadError,
    type Preset,
    type Underlay,
    type Vec2,
} from '@areaform/core';
import { basename } from 'node:path';
import { findFlaggable, readImportMeta, updateImportMeta, type ImportFlag } from './importMeta.ts';
import {
    scaleFrom,
    sourceTopLeft,
    sourceToPlan,
    type Calibration,
    type ImageType,
} from './source.ts';

export interface DraftOptions {
    name: string;
    /** Space Kind; selects the Preset (Grid Step, Level height, Zone Categories). */
    kind: string;
    /** Width and depth of the placeholder Outline, in metres; the agent usually replaces it. */
    size?: [number, number];
}

/** Why a batch of Commands was rejected. */
export type CommandError =
    | LoadError
    /** The Command could not even be applied, e.g. a field of the wrong type. */
    | { code: 'bad-command'; message: string };

export type ApplyResult =
    | {
          ok: true;
          applied: number;
          diagnostics: Diagnostic[];
          /** Import Flags dropped because the Commands deleted what they were on. */
          droppedFlags?: ImportFlag[];
      }
    | {
          ok: false;
          /** Index of the first Command that fails when the batch is applied in order. */
          failedAt: number;
          errors: CommandError[];
      };

/** A tool used out of order or with unusable input; reported to the agent, never a crash. */
export class DraftError extends Error {}

export class NoDraftError extends DraftError {
    constructor() {
        super('No Draft yet: call create_draft or open_document first');
    }
}

export interface SourceImage {
    /** Absolute path of the image file; `save_document` copies it next to the plan. */
    path: string;
    type: ImageType;
    /** Width and height in pixels. */
    size: Vec2;
    /** The Figma frame the image shows, when the Source is a Figma file. */
    figmaUrl?: string;
}

/** Image and Source must agree in aspect ratio to within this share, or the image is the wrong one. */
const ASPECT_TOLERANCE = 0.01;
const SOURCE_OPACITY = 0.5;

/**
 * One Draft being built by an agent. Every batch of Commands goes through the core Editor, so it
 * meets the same Invariants as an edit by hand, and becomes one undo step.
 */
export interface DraftSession {
    /** Starts a new Draft, dropping the current one. */
    create(options: DraftOptions): AreaformDocument;
    /**
     * Continues with a Document saved earlier, dropping the current Draft. `sourcePath` is the
     * file of its Source Underlay, when there is one.
     */
    open(doc: AreaformDocument, sourcePath?: string): AreaformDocument;
    /** Applies the Commands in order as one; rejects them all if any is rejected. */
    apply(commands: Command[]): ApplyResult;
    document(): AreaformDocument;
    diagnostics(): Diagnostic[];
    preset(): Preset;
    /**
     * Sets how Source units map to metres: `p1` and `p2` are `distance` metres apart, and the
     * Source is `size` units large. Moves the Source Underlay along, if one is attached.
     */
    calibrate(p1: Vec2, p2: Vec2, distance: number, size: Vec2): Calibration;
    calibration(): Calibration | undefined;
    /** Converts Source points to plan metres. */
    toPlan(points: Vec2[]): Vec2[];
    /** Shows the Source image as a locked Underlay under the Draft, replacing any earlier one. */
    attachSource(image: SourceImage): Underlay;
    /** The Source image file, once attached. */
    sourceFile(): string | undefined;
    /**
     * Records that a person should check the Level (for its Outline) or Element with `id`. The
     * same reason on the same id is kept once. Returns every Import Flag.
     */
    flag(id: Id, reason: string, sourceRef?: string): ImportFlag[];
    flags(): ImportFlag[];
    /**
     * Where Elements about to be added came from (Element id → Figma node id). Each is recorded
     * in `meta.import.sourceRefs` once a batch adds that Element.
     */
    expectSourceRefs(refs: Record<Id, string>): void;
}

export interface DraftSessionOptions {
    /** The clock for `meta.import.importedAt`. */
    now?: () => Date;
}

const PLACEHOLDER_SIZE: [number, number] = [10, 10];

/** Throws unless the Source image and the calibrated Source agree in aspect ratio. */
function assertSameAspect(image: Vec2, source: Vec2): void {
    const aspect = image[0] / image[1] / (source[0] / source[1]);
    if (Math.abs(aspect - 1) > ASPECT_TOLERANCE) {
        throw new DraftError(
            `The image is ${image[0]}×${image[1]} px, which does not match the calibrated ` +
                `Source of ${source[0]}×${source[1]} in aspect ratio`,
        );
    }
}

export function createDraftSession({
    now = () => new Date(),
}: DraftSessionOptions = {}): DraftSession {
    let editor: Editor | undefined;
    let sourcePath: string | undefined;
    let expectedRefs: Record<Id, string> = {};

    const current = (): Editor => {
        if (!editor) throw new NoDraftError();
        return editor;
    };

    // Applies a batch to a dry run of the current Draft, reporting errors the Editor can't: a
    // Command that throws, or one that leaves the Document malformed but within the Invariants.
    const check = (commands: Command[]): CommandError[] => {
        const draft = current();
        const trial = draft.begin();
        try {
            const result = trial.exec({ type: 'batch', commands });
            if (!result.ok) return result.errors;
            const loaded = fromJSON(draft.getDocument());
            return loaded.ok ? [] : loaded.errors;
        } catch (error) {
            return [{ code: 'bad-command', message: String(error) }];
        } finally {
            trial.cancel();
        }
    };

    const apply = (commands: Command[]): ApplyResult => {
        const errors = check(commands);
        if (errors.length > 0) {
            // Find the culprit, so the agent knows which Command to fix: the one after which the
            // batch never becomes valid again. The Invariants hold only at the end of a batch, so a
            // Command may break one for a later Command to mend; such a Command is not to blame.
            // Searched from the end, as a mistake usually sits in the latest Commands.
            let failedAt = commands.length - 1;
            while (failedAt > 0 && check(commands.slice(0, failedAt)).length > 0) failedAt--;
            return { ok: false, failedAt, errors };
        }
        current().exec({ type: 'batch', commands });
        const droppedFlags = syncImportMeta();
        return {
            ok: true,
            applied: commands.length,
            diagnostics: diagnose(current().getDocument()),
            ...(droppedFlags.length > 0 && { droppedFlags }),
        };
    };

    const flags = (): ImportFlag[] => readImportMeta(current().getDocument())?.flags ?? [];

    // After a batch: flags and source refs of deleted Elements go (a flag on something deleted
    // can't be reviewed), and expected source refs of added Elements are recorded. That is a
    // separate undo step, but the Draft's history never reaches the reviewer: the Editor starts
    // afresh on load. Returns the dropped flags.
    const syncImportMeta = (): ImportFlag[] => {
        const doc = current().getDocument();
        const all = flags();
        const kept = all.filter((f) => findFlaggable(doc, f.ref.id)?.kind === f.ref.kind);
        const before = readImportMeta(doc)?.sourceRefs ?? {};
        const exists = (id: Id) => findFlaggable(doc, id) !== undefined;
        const sourceRefs = Object.fromEntries(
            [...Object.entries(before), ...Object.entries(expectedRefs)].filter(([id]) =>
                exists(id),
            ),
        );
        for (const id of Object.keys(expectedRefs)) if (exists(id)) delete expectedRefs[id];
        const refsChanged =
            JSON.stringify(Object.entries(sourceRefs).sort()) !==
            JSON.stringify(Object.entries(before).sort());
        if (kept.length === all.length && !refsChanged) return [];
        current().exec(
            updateImportMeta(doc, {
                flags: kept,
                ...(refsChanged && { sourceRefs }),
            }),
        );
        return all.filter((f) => !kept.includes(f));
    };

    // For Commands the session builds itself: a rejection is a bug here, not the agent's mistake.
    const applyOwn = (commands: Command[]) => {
        const result = apply(commands);
        if (!result.ok) throw new Error(`Rejected: ${JSON.stringify(result.errors)}`);
    };

    const calibration = (): Calibration | undefined => {
        const meta = readImportMeta(current().getDocument());
        return meta?.scale && meta.sourceSize
            ? { scale: meta.scale, size: meta.sourceSize }
            : undefined;
    };

    const requireCalibration = (): Calibration => {
        const result = calibration();
        if (!result) throw new DraftError('The Source is not calibrated yet: call calibrate first');
        return result;
    };

    const sourceUnderlay = (): Underlay | undefined => {
        const doc = current().getDocument();
        const id = readImportMeta(doc)?.underlayId;
        return doc.levels[0]!.underlays.find((u) => u.id === id);
    };

    /** The Underlay fields that place an image of `imageSize` pixels exactly over the Source. */
    const placement = (target: Calibration, imageSize: Vec2) => ({
        scale: (target.scale * target.size[0]) / imageSize[0],
        position: sourceTopLeft(target),
    });

    return {
        create({ name, kind, size = PLACEHOLDER_SIZE }) {
            const doc = createSpace({ name, kind, size });
            editor = createEditor({
                ...doc,
                meta: { import: { importedAt: now().toISOString() } },
            });
            sourcePath = undefined;
            expectedRefs = {};
            return editor.getDocument();
        },

        open(doc, path) {
            editor = createEditor(doc);
            sourcePath = path;
            expectedRefs = {};
            return editor.getDocument();
        },

        apply,
        document: () => current().getDocument(),
        diagnostics: () => diagnose(current().getDocument()),
        preset: () => presetFor(current().getDocument().kind),

        calibrate(p1, p2, distance, size) {
            const doc = current().getDocument();
            const scale = scaleFrom(p1, p2, distance);
            if (scale === undefined) {
                throw new DraftError(
                    'Calibration needs two distinct points and a positive distance',
                );
            }
            if (!(size[0] > 0 && size[1] > 0)) {
                throw new DraftError('The Source size must be positive');
            }
            const target: Calibration = { scale, size };
            const commands: Command[] = [updateImportMeta(doc, { scale, sourceSize: size })];
            const underlay = sourceUnderlay();
            if (underlay?.size) {
                assertSameAspect(underlay.size, size);
                commands.push({
                    type: 'underlay.update',
                    levelId: doc.levels[0]!.id,
                    underlayId: underlay.id,
                    changes: placement(target, underlay.size),
                });
            }
            applyOwn(commands);
            return target;
        },

        calibration,

        toPlan(points) {
            const target = requireCalibration();
            return points.map((point) => sourceToPlan(target, point));
        },

        attachSource({ path, type, size, figmaUrl }) {
            const target = requireCalibration();
            assertSameAspect(size, target.size);
            const doc = current().getDocument();
            const levelId = doc.levels[0]!.id;
            const previous = sourceUnderlay();
            const underlay: Underlay = {
                id: 'import-source',
                src: type === 'png' ? 'source.png' : 'source.jpg',
                ...placement(target, size),
                rotation: 0,
                opacity: SOURCE_OPACITY,
                locked: true,
                size,
            };
            const source = figmaUrl
                ? { kind: 'figma' as const, ref: figmaUrl }
                : { kind: 'image' as const, ref: basename(path) };
            applyOwn([
                ...(previous
                    ? [{ type: 'underlay.delete' as const, levelId, underlayId: previous.id }]
                    : []),
                { type: 'underlay.add', levelId, underlay },
                updateImportMeta(doc, { source, underlayId: underlay.id }),
            ]);
            sourcePath = path;
            return underlay;
        },

        sourceFile: () => sourcePath,

        flag(id, reason, sourceRef) {
            const doc = current().getDocument();
            const ref = findFlaggable(doc, id);
            if (!ref) throw new DraftError(`No Level or Element has the id ${id}`);
            if (!reason.trim()) throw new DraftError('An Import Flag needs a reason');
            const all = flags();
            if (all.some((f) => f.ref.id === id && f.reason === reason)) return all;
            const added: ImportFlag = { ref, reason, ...(sourceRef && { sourceRef }) };
            applyOwn([updateImportMeta(doc, { flags: [...all, added] })]);
            return flags();
        },

        flags,

        expectSourceRefs(refs) {
            expectedRefs = { ...expectedRefs, ...refs };
        },
    };
}
