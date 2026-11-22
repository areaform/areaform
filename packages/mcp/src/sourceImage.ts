import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Fetch } from './figma.ts';
import { DraftError } from './session.ts';
import { imageInfo, type ImageType } from './source.ts';

/** Larger downloads are refused: a Source image is a screenshot or a scan, not a photo archive. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface SourceImageFile {
    /** A local file: the one given, or where a download was saved. */
    file: string;
    type: ImageType;
    size: [number, number];
}

/**
 * The Source image as a local file, read from `path` or downloaded from an https `url` (such as
 * the Figma MCP's get_screenshot link, for agents with no shell to download it). A download goes to
 * a new temporary folder; the URL itself is not kept, as such links can grant access.
 */
export async function loadSourceImage(
    from: { path?: string | undefined; url?: string | undefined },
    fetcher: Fetch = fetch,
): Promise<SourceImageFile> {
    if ((from.path === undefined) === (from.url === undefined)) {
        throw new DraftError('Pass either path or url, not both or neither');
    }
    if (from.path !== undefined) {
        const file = resolve(from.path);
        let bytes: Uint8Array;
        try {
            bytes = readFileSync(file);
        } catch {
            throw new DraftError(`Cannot read ${file}`);
        }
        const image = imageInfo(bytes);
        if (!image) throw new DraftError(`${file} is not a PNG or JPEG image`);
        return { file, ...image };
    }

    let url: URL;
    try {
        url = new URL(from.url!);
    } catch {
        throw new DraftError(`Not a URL: ${from.url}`);
    }
    if (url.protocol !== 'https:') throw new DraftError('Only https URLs can be downloaded');
    let bytes: Uint8Array;
    try {
        const response = await fetcher(url.href, { headers: {} });
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
        throw new DraftError(`Could not download the image: ${(error as Error).message}`);
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
        throw new DraftError(`The image is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    const image = imageInfo(bytes);
    if (!image) throw new DraftError('The URL did not give a PNG or JPEG image');
    const file = join(
        mkdtempSync(join(tmpdir(), 'areaform-source-')),
        image.type === 'png' ? 'source.png' : 'source.jpg',
    );
    writeFileSync(file, bytes);
    return { file, ...image };
}
