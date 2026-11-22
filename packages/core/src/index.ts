export * from './model.ts';
export { createSpace, type CreateSpaceOptions } from './createSpace.ts';
export type * from './commands/index.ts';
export {
    defaultPresets,
    exclusiveCategories,
    genericPreset,
    presetFor,
    type Preset,
    type PresetCategory,
} from './presets.ts';
export {
    createEditor,
    type ChangeListener,
    type Editor,
    type ExecResult,
    type PreviewResult,
    type Transaction,
} from './editor.ts';
export { isViewpointTilt, type InvariantError } from './invariants.ts';
export { boundingBox, type Box } from './geometry.ts';
export {
    containsPoint,
    containsRing,
    holesOverlap,
    resolveOpening,
    underlayCorners,
    underlayToWorld,
    worldToUnderlay,
    viewpointSpot,
    zoneAt,
    type Placement,
} from './queries.ts';
export { wallOutlines } from './wallOutlines.ts';
export {
    toGeoJSON,
    type GeoFeature,
    type GeoFeatureCollection,
    type GeoFeatureType,
    type GeoGeometry,
    type GeoPosition,
} from './geojson.ts';
export { georeferenceAt, lngLatProjection, type LngLat } from './georeference.ts';
export type { ElementRef, LevelElementKind } from './elements.ts';
export {
    fromJSON,
    toJSON,
    DOCUMENT_SCHEMA_URL,
    type LoadError,
    type LoadOptions,
    type LoadResult,
    type Repair,
    type SaveOptions,
} from './serialization.ts';
export {
    CURRENT_SCHEMA_VERSION,
    MIGRATIONS,
    migrate,
    type DocumentData,
    type MigrateOptions,
    type Migration,
    type MigrationError,
    type MigrationResult,
    type Migrations,
} from './migrations.ts';
export {
    isLanguageTag,
    matchLanguage,
    missingTexts,
    offeredLanguages,
    offersLanguage,
    sameLanguage,
    textIn,
    translationIn,
} from './languages.ts';
export { diagnose, type DiagnoseOptions, type Diagnostic } from './diagnostics.ts';
export {
    diff,
    type DiffEntry,
    type DocumentDiff,
    type ElementListKey,
    type ElementValues,
    type LevelProps,
    type SpaceProps,
} from './diff.ts';
