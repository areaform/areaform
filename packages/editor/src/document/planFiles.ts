import type { AreaformDocument, LoadError } from '@areaform/core';

// A plan picked as files: `plan.json`, with the images its Underlays name next to it, as the MCP
// import writes a Draft folder (docs/product/mcp-import-design.md) and as a plan written by hand
// or by an AI names its tracing images. The playground and the hosted builder import both.

/** The plan and images picked together, e.g. a Draft folder. */
export interface DraftFiles {
    plan: File;
    /** By file name, the way a relative Underlay `src` names them. */
    images: Map<string, File>;
}

const PLAN_FILE = 'plan.json';
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * Finds the plan among the files: the only `.json`, or `plan.json` when there are several. A
 * picked folder brings its subfolders too; only the images next to the plan are its own.
 */
export function sortDraftFiles(files: File[]): DraftFiles | { error: string } {
    const plans = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
    const named = plans.filter((f) => f.name === PLAN_FILE);
    if (named.length > 1) {
        return {
            error: `several Drafts in the folder (${named.map(pathOf).join(', ')}); pick one`,
        };
    }
    const plan = plans.length === 1 ? plans[0] : named[0];
    if (!plan) {
        return {
            error:
                plans.length === 0
                    ? 'no plan (.json) among the files'
                    : `several plans among the files and none is called ${PLAN_FILE}`,
        };
    }
    const folder = folderOf(plan);
    const images = new Map(
        files.filter((f) => IMAGE.test(f.name) && folderOf(f) === folder).map((f) => [f.name, f]),
    );
    return { plan, images };
}

/** Where a file sits in a picked folder; just its name when picked on its own. */
const pathOf = (file: File) => file.webkitRelativePath || file.name;
const folderOf = (file: File) => pathOf(file).slice(0, -file.name.length);

/** Underlay `src`s that name a file next to the plan rather than a URL. */
export function relativeSources(doc: AreaformDocument): string[] {
    const sources = doc.levels.flatMap((l) => l.underlays.map((u) => u.src));
    return [
        ...new Set(
            sources.filter((src) => !/^[a-z][a-z\d+.-]*:/i.test(src) && !src.startsWith('/')),
        ),
    ];
}

/**
 * Why a plan file does not load, in one plain sentence, naming what is wrong by its id or its
 * place in the file, for whoever wrote it to find. In English, as the file's own field names are.
 */
export function describeLoadError(error: LoadError): string {
    switch (error.code) {
        case 'invalid-json':
            return 'The file is not valid JSON.';
        case 'not-a-document':
            return 'The file is not an Areaform plan: it has no `schemaVersion` and `levels`.';
        case 'newer-version':
            return `The file was saved by a newer version of Areaform (schema ${error.version}); it opens once this one is updated.`;
        case 'unsupported-version':
            return `The file's schema version, ${String(error.version)}, is not one Areaform knows.`;
        case 'malformed':
            return `\`${error.path}\` should be ${error.expected}.`;
        case 'duplicate-id':
            return `Two things in the plan share the id “${error.id}”; every id must be different.`;
        case 'unknown-level':
            return `Something refers to a Level “${error.levelId}” that the plan does not have.`;
        case 'unknown-element':
            return `Something refers to “${error.id}”, which the plan does not have.`;
        case 'dangling-reference':
            return `“${error.id}” refers to “${error.ref}”, which the plan does not have (a Wall's corner, or the Wall a door is in).`;
        case 'degenerate-wall':
            return `The Wall “${error.id}” starts and ends at the same point.`;
        case 'no-levels':
            return 'The plan has no Levels; it needs at least one.';
        case 'invalid-grid':
            return 'The grid step must be a number above 0.';
        case 'invalid-level':
            return `The Level “${error.id}” needs an elevation that is a number and a ceiling height above 0.`;
        case 'invalid-underlay':
            return `The image Underlay “${error.id}” has a position, scale or opacity that is not a usable number.`;
        case 'invalid-viewpoint':
            return `The Viewpoint “${error.id}” has a number out of range (a tilt from 0 to 90°, a distance above 0).`;
        case 'too-few-stops':
            return `The Connection “${error.id}” stops on fewer than two Levels.`;
        case 'duplicate-stop':
            return `The Connection “${error.id}” stops twice on the Level “${error.levelId}”.`;
        case 'invalid-shape':
            return `The shape of “${error.id}” crosses itself, has fewer than three corners, or has a corner that is not a number.`;
        case 'invalid-languages':
            return 'The list of Content Languages has a malformed tag or a language twice.';
        case 'unknown-language':
            return `A text is given in “${error.language}”, a language the plan does not list.`;
        case 'required-text':
            return `“${error.id}” has no name in the plan's default language.`;
    }
}

/**
 * The first errors of a plan that does not load, one sentence each, and how many more there are:
 * enough to start fixing the file without a wall of text.
 */
export function describeLoadErrors(errors: readonly LoadError[], shown = 3): string {
    if (errors.length === 0) return 'The file does not load, for a reason not given.';
    const sentences = errors.slice(0, shown).map(describeLoadError);
    const more = errors.length - shown;
    return more > 0 ? `${sentences.join(' ')} And ${more} more.` : sentences.join(' ');
}
