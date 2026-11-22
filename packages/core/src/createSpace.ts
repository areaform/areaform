import { newId } from './ids.ts';
import type { AreaformDocument } from './model.ts';
import { presetFor, type Preset } from './presets.ts';

export interface CreateSpaceOptions {
    name: string;
    kind: string;
    /** Width and depth of the starting rectangular Outline, in metres. */
    size: [number, number];
    gridStep?: number;
    /** The first Level's name; "Level 1" when absent. */
    levelName?: string;
    /**
     * The default Content Language, the one `name` and `levelName` are written in (a BCP 47
     * tag); the default is unknown when absent (ADR-0011).
     */
    language?: string;
    /** The Presets to pick from by `kind`; the built-in `defaultPresets` when absent. */
    presets?: Record<string, Preset>;
}

export function createSpace({
    name,
    kind,
    size,
    gridStep,
    levelName,
    language,
    presets,
}: CreateSpaceOptions): AreaformDocument {
    const preset = presetFor(kind, presets);
    const [width, depth] = size;

    return {
        schemaVersion: 1,
        id: newId(),
        name,
        kind,
        units: 'm',
        grid: { step: gridStep ?? preset.gridStep, snap: true },
        ...(language !== undefined && { languages: { default: language } }),
        levels: [
            {
                id: newId(),
                name: levelName ?? 'Level 1',
                ordinal: 0,
                elevation: 0,
                height: preset.levelHeight,
                outline: {
                    outer: [
                        [0, 0],
                        [width, 0],
                        [width, depth],
                        [0, depth],
                    ],
                },
                wallNodes: [],
                walls: [],
                openings: [],
                zones: [],
                obstacles: [],
                underlays: [],
            },
        ],
        connections: [],
    };
}
