import type { AssetResolver } from '@areaform/render-2d';
import { createContext, useContext } from 'react';

/** Stores an image the user picked and returns the `src` to keep in the Document, e.g. an asset id. */
export type AssetUploader = (file: File) => Promise<string>;

export interface Assets {
    resolveAsset?: AssetResolver | undefined;
    uploadAsset?: AssetUploader | undefined;
    keepAsset?: AssetUploader | undefined;
}

/**
 * Thrown by an `uploadAsset` or `keepAsset` that refuses a file for a reason the user should read,
 * e.g. a storage limit: the Editor shows its message as is.
 */
export class AssetRefused extends Error {}

/** The host's asset functions, for the sidebar's Underlay controls. */
export const AssetsContext = createContext<Assets>({});

export const useAssets = () => useContext(AssetsContext);
